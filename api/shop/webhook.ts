import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/db.js';
import { sendDiscordNotification } from '../_lib/discord.js';
import { queryParam, sendError } from '../_lib/http.js';
import { fetchPayment, verifyWebhookSignature } from '../_lib/mercadopago.js';

/**
 * POST /api/shop/webhook — Mercado Pago's server-to-server notification.
 * No session/CSRF here (Mercado Pago, not the browser, calls this); trust is
 * established entirely by the x-signature HMAC. The webhook body itself is
 * never trusted for status or amount — we always re-fetch the payment from
 * Mercado Pago's API before crediting anything.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(200).end(); // ack anything that isn't a notification so MP stops retrying
    return;
  }

  const dataId = queryParam(req, 'data.id') ?? queryParam(req, 'id');
  const type = queryParam(req, 'type');
  if (!dataId) {
    res.status(200).end();
    return;
  }

  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('MP_WEBHOOK_SECRET not configured');
    sendError(res, 500, 'internal');
    return;
  }
  const valid = verifyWebhookSignature({
    xSignature: req.headers['x-signature'],
    xRequestId: req.headers['x-request-id'],
    dataId,
    secret,
  });
  if (!valid) {
    sendError(res, 401, 'invalid_signature');
    return;
  }

  if (type !== 'order') {
    // This account's application is provisioned on the Orders API (see
    // api/_lib/mercadopago.ts) — Mercado Pago sends `type=order` for it,
    // not `type=payment`. Log anything unexpected instead of silently
    // dropping it, in case that assumption ever needs revisiting.
    if (type) console.log(`shop webhook: ignoring notification type "${type}"`);
    res.status(200).end();
    return;
  }

  try {
    const payment = await fetchPayment(dataId);
    const purchaseId = payment.externalReference;
    if (!purchaseId) {
      res.status(200).end();
      return;
    }

    // Confirmed by a real paid order: the Orders API's nested payment status
    // lands on "processed" (status_detail "accredited") for a completed Pix,
    // NOT "approved" like the classic Payments API. Accepting both in case
    // that varies by payment method.
    const rawMpStatus = payment.status;
    const status = rawMpStatus === 'approved' || rawMpStatus === 'processed'
      ? 'approved'
      : rawMpStatus === 'cancelled' || rawMpStatus === 'rejected'
        ? 'rejected'
        : null;
    if (!status) {
      res.status(200).end(); // still pending/in_process — nothing to credit yet
      return;
    }

    const client = await db().connect();
    try {
      await client.query('begin');
      if (status === 'approved') {
        // credited_at is the idempotency guard: a retried/duplicate webhook
        // delivery for a purchase that's already credited updates 0 rows.
        const credited = await client.query(
          `update purchases set status = 'approved', mp_payment_id = $2, credited_at = now()
           where id = $1 and credited_at is null
           returning coins, player_id, pack_id, amount_cents`,
          [purchaseId, dataId],
        );
        if (credited.rows.length > 0) {
          const row = credited.rows[0] as { coins: number; player_id: string; pack_id: string; amount_cents: number };
          await client.query('update saves set coins = coins + $2 where player_id = $1', [row.player_id, row.coins]);

          // Dispara notificação no Discord (fire-and-forget — não bloqueia o webhook)
          const player = await client.query(
            'select display_name, handle from players where id = $1',
            [row.player_id],
          );
          if (player.rows.length > 0) {
            sendDiscordNotification({
              type: 'approved',
              playerName: (player.rows[0] as { display_name: string; handle: string }).display_name,
              handle: (player.rows[0] as { display_name: string; handle: string }).handle,
              packId: row.pack_id,
              amountCents: row.amount_cents,
              coins: row.coins,
              purchaseId: purchaseId ?? '',
            }).catch((err) => console.error('discord notification failed', err));
          }
        }
      } else {
        const updated = await client.query(
          `update purchases set status = $2 where id = $1 and credited_at is null
           returning coins, player_id, pack_id, amount_cents`,
          [purchaseId, status],
        );
        if (updated.rows.length > 0) {
          const row = updated.rows[0] as { coins: number; player_id: string; pack_id: string; amount_cents: number };
          const player = await client.query(
            'select display_name, handle from players where id = $1',
            [row.player_id],
          );
          if (player.rows.length > 0) {
            sendDiscordNotification({
              type: rawMpStatus === 'cancelled' ? 'expired' : 'rejected',
              playerName: (player.rows[0] as { display_name: string; handle: string }).display_name,
              handle: (player.rows[0] as { display_name: string; handle: string }).handle,
              packId: row.pack_id,
              amountCents: row.amount_cents,
              coins: row.coins,
              purchaseId: purchaseId ?? '',
            }).catch((err) => console.error('discord notification failed', err));
          }
        }
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }

    res.status(200).end();
  } catch (e) {
    console.error('webhook failed', e);
    sendError(res, 500, 'internal');
  }
}
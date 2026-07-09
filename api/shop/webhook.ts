import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/db.js';
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

  if (type !== 'payment') {
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

    const status = payment.status === 'approved'
      ? 'approved'
      : payment.status === 'cancelled' || payment.status === 'rejected'
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
           returning coins, player_id`,
          [purchaseId, dataId],
        );
        if (credited.rows.length > 0) {
          const { coins, player_id } = credited.rows[0] as { coins: number; player_id: string };
          await client.query('update saves set coins = coins + $2 where player_id = $1', [player_id, coins]);
        }
      } else {
        await client.query(
          `update purchases set status = $2 where id = $1 and credited_at is null`,
          [purchaseId, status],
        );
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

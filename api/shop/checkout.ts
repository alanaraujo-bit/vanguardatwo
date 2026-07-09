import type { VercelRequest, VercelResponse } from '@vercel/node';
import { packById, totalCoins } from '../../src/game/store.js';
import type { CheckoutRequest, CheckoutResponse } from '../../src/net/protocol.js';
import { db } from '../_lib/db.js';
import { csrfOk, methodIs, sendError } from '../_lib/http.js';
import { createPixCharge } from '../_lib/mercadopago.js';
import { requireSession } from '../_lib/session.js';

/**
 * POST /api/shop/checkout — body { packId }: opens (or resumes) a Pix charge
 * for a coin pack. Coins are NOT credited here — only api/shop/webhook.ts
 * does that, once Mercado Pago confirms the payment actually landed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'POST')) return;
  if (!csrfOk(req, res)) return;
  const claims = await requireSession(req, res);
  if (!claims) return;

  const body = (req.body ?? {}) as Partial<CheckoutRequest>;
  const pack = typeof body.packId === 'string' ? packById(body.packId) : undefined;
  if (!pack) {
    sendError(res, 400, 'bad_request');
    return;
  }

  let purchaseId: string | null = null;
  try {
    // Reuse an in-flight charge instead of minting a new one on every tap —
    // also caps a player to one live QR code at a time.
    const existing = await db().query(
      `select id, qr_code, qr_code_base64, expires_at from purchases
       where player_id = $1 and status = 'pending' and expires_at > now()
       order by created_at desc limit 1`,
      [claims.playerId],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const response: CheckoutResponse = {
        purchaseId: row.id,
        qrCodeBase64: row.qr_code_base64,
        copyPaste: row.qr_code,
        expiresAt: new Date(row.expires_at).toISOString(),
      };
      res.status(200).json(response);
      return;
    }

    const recent = await db().query(
      `select count(*)::int as n from purchases where player_id = $1 and created_at > now() - interval '10 minutes'`,
      [claims.playerId],
    );
    if ((recent.rows[0]?.n ?? 0) >= 5) {
      sendError(res, 429, 'rate_limited');
      return;
    }

    const player = await db().query('select email from players where id = $1', [claims.playerId]);
    const email = player.rows[0]?.email as string | null | undefined;
    if (!email) {
      sendError(res, 422, 'no_email');
      return;
    }

    const inserted = await db().query(
      `insert into purchases (player_id, pack_id, coins, amount_cents)
       values ($1, $2, $3, $4) returning id`,
      [claims.playerId, pack.id, totalCoins(pack), pack.priceCents],
    );
    purchaseId = inserted.rows[0].id as string;

    const proto = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development' ? 'https' : 'http';
    const notificationUrl = `${proto}://${req.headers.host}/api/shop/webhook`;

    const charge = await createPixCharge({
      amountCents: pack.priceCents,
      description: `BALUARTE — ${pack.name}`,
      payerEmail: email,
      externalReference: purchaseId,
      notificationUrl,
      idempotencyKey: purchaseId,
    });

    await db().query(
      `update purchases set mp_payment_id = $2, qr_code = $3, qr_code_base64 = $4, expires_at = $5 where id = $1`,
      [purchaseId, charge.mpPaymentId, charge.qrCode, charge.qrCodeBase64, charge.expiresAt],
    );

    const response: CheckoutResponse = {
      purchaseId,
      qrCodeBase64: charge.qrCodeBase64,
      copyPaste: charge.qrCode,
      expiresAt: charge.expiresAt,
    };
    res.status(200).json(response);
  } catch (e) {
    console.error('checkout failed', e);
    if (purchaseId) {
      await db()
        .query(`update purchases set status = 'rejected' where id = $1 and mp_payment_id is null`, [purchaseId])
        .catch(() => undefined);
    }
    sendError(res, 502, 'payment_unavailable');
  }
}

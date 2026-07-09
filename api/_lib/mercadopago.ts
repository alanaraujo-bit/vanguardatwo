import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal Mercado Pago client: just the two calls the coin store needs.
 * Plain fetch against the REST API (no SDK) to stay consistent with the
 * rest of api/ — pg and jose are the only "heavy" deps here too.
 */

const MP_API = 'https://api.mercadopago.com';

function accessToken(): string {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error('MP_ACCESS_TOKEN not configured');
  return t;
}

export interface PixCharge {
  mpPaymentId: string;
  qrCode: string;
  qrCodeBase64: string;
  expiresAt: string;
}

/**
 * Creates a Pix payment via Mercado Pago's Payments API. `idempotencyKey`
 * should be the purchases.id row — a retry (e.g. a Vercel function retry)
 * reuses the same charge instead of billing twice.
 */
export async function createPixCharge(opts: {
  amountCents: number;
  description: string;
  payerEmail: string;
  externalReference: string;
  notificationUrl: string;
  idempotencyKey: string;
}): Promise<PixCharge> {
  const res = await fetch(`${MP_API}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': opts.idempotencyKey,
    },
    body: JSON.stringify({
      transaction_amount: Math.round(opts.amountCents) / 100,
      description: opts.description,
      payment_method_id: 'pix',
      payer: { email: opts.payerEmail },
      external_reference: opts.externalReference,
      notification_url: opts.notificationUrl,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mercadopago payment creation failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    id: number;
    date_of_expiration?: string;
    point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
  };
  const data = json.point_of_interaction?.transaction_data;
  if (!data?.qr_code || !data.qr_code_base64) {
    throw new Error('mercadopago response missing pix qr data');
  }
  return {
    mpPaymentId: String(json.id),
    qrCode: data.qr_code,
    qrCodeBase64: data.qr_code_base64,
    expiresAt: json.date_of_expiration ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

export interface MpPayment {
  status: string;
  externalReference: string | null;
}

/**
 * Re-fetches a payment straight from Mercado Pago — the webhook body itself
 * is never trusted for status/amount, only used to know which id to look up.
 */
export async function fetchPayment(mpPaymentId: string): Promise<MpPayment> {
  const res = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(mpPaymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mercadopago payment fetch failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { status: string; external_reference: string | null };
  return { status: json.status, externalReference: json.external_reference };
}

/**
 * Validates the `x-signature` header per Mercado Pago's documented scheme:
 * manifest = `id:{dataId};request-id:{xRequestId};ts:{ts};`, HMAC-SHA256'd
 * with the webhook secret. dataId must be lowercased first — Mercado Pago's
 * own docs call this out as the most common integration mistake.
 */
export function verifyWebhookSignature(opts: {
  xSignature: string | string[] | undefined;
  xRequestId: string | string[] | undefined;
  dataId: string;
  secret: string;
}): boolean {
  const xSignature = Array.isArray(opts.xSignature) ? opts.xSignature[0] : opts.xSignature;
  const xRequestId = Array.isArray(opts.xRequestId) ? opts.xRequestId[0] : opts.xRequestId;
  if (!xSignature || !xRequestId || !opts.dataId) return false;

  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of xSignature.split(',')) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  }
  if (!ts || !v1) return false;

  const manifest = `id:${opts.dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const expected = createHmac('sha256', opts.secret).update(manifest).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

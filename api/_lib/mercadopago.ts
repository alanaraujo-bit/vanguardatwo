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
  /** Order id (e.g. "ORDTST...") — NOT a classic /v1/payments id. Webhook
   * notifications for this account arrive keyed by this same id (type=order). */
  mpPaymentId: string;
  qrCode: string;
  qrCodeBase64: string;
  expiresAt: string;
}

interface MpOrderResponse {
  id: string;
  status: string;
  status_detail?: string;
  external_reference: string | null;
  transactions?: {
    payments?: Array<{
      status: string;
      status_detail?: string;
      date_of_expiration?: string;
      payment_method?: { qr_code?: string; qr_code_base64?: string };
    }>;
  };
}

/**
 * Creates a Pix charge via Mercado Pago's newer Orders API (`/v1/orders`).
 * This account's application is only authorized for the Orders API — the
 * classic `/v1/payments` endpoint returns 401 "Unauthorized use of live
 * credentials" for it regardless of credential, confirmed by testing both
 * production and test Access Tokens directly. `idempotencyKey` should be
 * the purchases.id row — a retry reuses the same charge instead of billing
 * twice. Notifications are NOT set per-request — the webhook URL is
 * configured once in the Mercado Pago dashboard.
 */
export async function createPixCharge(opts: {
  amountCents: number;
  description: string;
  itemTitle: string;
  itemDescription: string;
  payerEmail: string;
  payerFirstName?: string;
  payerLastName?: string;
  externalReference: string;
  idempotencyKey: string;
  /** window.MP_DEVICE_SESSION_ID from Mercado Pago's security.js — improves fraud scoring / approval rate. */
  deviceId?: string;
}): Promise<PixCharge> {
  const amount = (Math.round(opts.amountCents) / 100).toFixed(2);
  const res = await fetch(`${MP_API}/v1/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': opts.idempotencyKey,
      ...(opts.deviceId ? { 'X-meli-session-id': opts.deviceId } : {}),
    },
    body: JSON.stringify({
      type: 'online',
      total_amount: amount,
      external_reference: opts.externalReference,
      description: opts.description,
      payer: {
        email: opts.payerEmail,
        ...(opts.payerFirstName ? { first_name: opts.payerFirstName } : {}),
        ...(opts.payerLastName ? { last_name: opts.payerLastName } : {}),
      },
      items: [{
        title: opts.itemTitle,
        description: opts.itemDescription,
        quantity: 1,
        unit_price: amount,
        category_id: 'virtual_goods',
      }],
      transactions: {
        payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' } }],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mercadopago order creation failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as MpOrderResponse;
  const payment = json.transactions?.payments?.[0];
  const data = payment?.payment_method;
  if (!payment || !data?.qr_code || !data.qr_code_base64) {
    throw new Error('mercadopago response missing pix qr data');
  }
  return {
    mpPaymentId: json.id,
    qrCode: data.qr_code,
    qrCodeBase64: data.qr_code_base64,
    expiresAt: payment.date_of_expiration ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

export interface MpPayment {
  status: string;
  externalReference: string | null;
}

/**
 * Re-fetches an order straight from Mercado Pago — the webhook body itself
 * is never trusted for status/amount, only used to know which id to look
 * up. The order's own top-level `status` is a coarse lifecycle state
 * ("action_required" while waiting on the Pix transfer); the nested
 * transaction's payment status uses Mercado Pago's standard payment
 * vocabulary ("approved" | "rejected" | "cancelled" | ...) and is what
 * actually reflects whether the Pix landed, so that's what's returned here.
 */
export async function fetchPayment(mpOrderId: string): Promise<MpPayment> {
  const res = await fetch(`${MP_API}/v1/orders/${encodeURIComponent(mpOrderId)}`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mercadopago order fetch failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as MpOrderResponse;
  const paymentStatus = json.transactions?.payments?.[0]?.status ?? json.status;
  return { status: paymentStatus, externalReference: json.external_reference };
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

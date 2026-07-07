import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Small handler helpers: method guard, CSRF gate, JSON errors. */

export function sendError(res: VercelResponse, status: number, error: string, extra?: object): void {
  res.status(status).json({ error, ...extra });
}

export function methodIs(req: VercelRequest, res: VercelResponse, ...methods: string[]): boolean {
  if (methods.includes(req.method ?? '')) return true;
  res.setHeader('Allow', methods.join(', '));
  sendError(res, 405, 'method_not_allowed');
  return false;
}

/**
 * CSRF gate for cookie-authenticated mutations: the custom header cannot be
 * attached cross-origin without a CORS preflight (which we never grant), and
 * when browsers do send an Origin it must match the request host.
 */
export function csrfOk(req: VercelRequest, res: VercelResponse): boolean {
  if (req.headers['x-requested-with'] !== 'vanguarda') {
    sendError(res, 403, 'forbidden');
    return false;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    const host = req.headers.host ?? '';
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      // malformed Origin → reject below
    }
    if (originHost !== host) {
      sendError(res, 403, 'forbidden');
      return false;
    }
  }
  return true;
}

export function queryParam(req: VercelRequest, name: string): string | null {
  const v = req.query[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

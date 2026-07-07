import type { VercelRequest, VercelResponse } from '@vercel/node';
import { csrfOk, methodIs } from './_lib/http';
import { clearSessionCookie } from './_lib/session';

/** POST /api/logout — drop the session cookie. */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (!methodIs(req, res, 'POST')) return;
  if (!csrfOk(req, res)) return;
  clearSessionCookie(res);
  res.status(204).end();
}

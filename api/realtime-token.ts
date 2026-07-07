import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SignJWT } from 'jose';
import { methodIs } from './_lib/http.js';
import { requireSession } from './_lib/session.js';

/**
 * GET /api/realtime-token — exchanges the HttpOnly session cookie for a
 * short-lived JWT the client can hand to the game server's WebSocket
 * handshake. Needed because the cookie is scoped to this origin and never
 * travels to the (separate) realtime host. Guests skip this endpoint and
 * connect unauthenticated.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;
  const claims = await requireSession(req, res);
  if (!claims) return;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'server_misconfigured' });
    return;
  }

  const token = await new SignJWT({ hnd: claims.handle })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.playerId)
    .setAudience('rt')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ token });
}

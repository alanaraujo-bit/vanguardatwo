import type { VercelRequest, VercelResponse } from '@vercel/node';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Stateless sessions: an HS256 JWT in an HttpOnly cookie. 30-day expiry with
 * sliding refresh (api/me re-issues when the token is older than 7 days).
 */

const COOKIE = 'vg_session';
const MAX_AGE_S = 30 * 24 * 3600;
export const REFRESH_AFTER_S = 7 * 24 * 3600;

export interface SessionClaims {
  playerId: string;
  handle: string;
  issuedAt: number;
}

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return new TextEncoder().encode(s);
}

export async function signSession(playerId: string, handle: string): Promise<string> {
  return new SignJWT({ hnd: handle })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(playerId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

export async function readSession(req: VercelRequest): Promise<SessionClaims | null> {
  const cookies = req.headers.cookie ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], secret(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.hnd !== 'string') return null;
    return {
      playerId: payload.sub,
      handle: payload.hnd,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : 0,
    };
  } catch {
    return null;
  }
}

export async function requireSession(
  req: VercelRequest,
  res: VercelResponse,
): Promise<SessionClaims | null> {
  const claims = await readSession(req);
  if (!claims) res.status(401).json({ error: 'unauthorized' });
  return claims;
}

function cookieAttributes(maxAge: number): string {
  // `vercel dev` runs on plain http://localhost — Secure would drop the cookie.
  const secure = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development';
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function setSessionCookie(res: VercelResponse, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttributes(MAX_AGE_S)}`);
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttributes(0)}`);
}

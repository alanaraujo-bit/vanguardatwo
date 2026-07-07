import { jwtVerify } from 'jose';

/**
 * Verifies the short-lived realtime JWT minted by /api/realtime-token.
 * Same HS256 secret as the HTTP API (JWT_SECRET env, shared across deploys),
 * plus an audience pin so a stolen session cookie can't be replayed here.
 */

export interface RtClaims {
  playerId: string;
  handle: string;
}

export async function verifyRealtimeToken(token: string): Promise<RtClaims | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      audience: 'rt',
    });
    if (typeof payload.sub !== 'string' || typeof payload.hnd !== 'string') return null;
    return { playerId: payload.sub, handle: payload.hnd };
  } catch {
    return null;
  }
}

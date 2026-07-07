import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { MeResponse } from '../src/net/protocol';
import { cloudSaveFromRow, db, SAVE_COLS } from './_lib/db';
import { methodIs, sendError } from './_lib/http';
import {
  clearSessionCookie,
  readSession,
  REFRESH_AFTER_S,
  setSessionCookie,
  signSession,
} from './_lib/session';
import { playerInfo, PLAYER_COLS, type PlayerRow } from './_lib/players';

/** GET /api/me — restore the cookie session: who am I + my cloud save. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;

  const claims = await readSession(req);
  if (!claims) {
    sendError(res, 401, 'unauthorized');
    return;
  }

  try {
    const result = await db().query(
      `select ${PLAYER_COLS.split(', ').map((c) => `p.${c}`).join(', ')}, ${SAVE_COLS.split(', ').map((c) => `s.${c}`).join(', ')}
       from players p join saves s on s.player_id = p.id
       where p.id = $1`,
      [claims.playerId],
    );
    if (result.rows.length === 0) {
      clearSessionCookie(res);
      sendError(res, 401, 'unauthorized');
      return;
    }
    const row = result.rows[0];

    // Sliding refresh: re-issue the cookie when it is older than a week.
    const ageS = Math.floor(Date.now() / 1000) - claims.issuedAt;
    if (ageS > REFRESH_AFTER_S) {
      setSessionCookie(res, await signSession(row.id, row.handle));
    }

    void db().query('update players set last_seen_at = now() where id = $1', [claims.playerId])
      .catch(() => undefined);

    const response: MeResponse = {
      player: playerInfo(row as PlayerRow),
      save: cloudSaveFromRow(row),
    };
    res.status(200).json(response);
  } catch (e) {
    console.error('me failed', e);
    sendError(res, 500, 'internal');
  }
}

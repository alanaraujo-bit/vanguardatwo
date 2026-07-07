import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleFromName, nameError, sanitizeName } from '../src/net/names';
import type { MeResponse, ProfileResponse } from '../src/net/protocol';
import { cloudSaveFromRow, db, SAVE_COLS } from './_lib/db';
import { csrfOk, methodIs, queryParam, sendError } from './_lib/http';
import { allocateHandle, playerInfo, PLAYER_COLS, type PlayerRow } from './_lib/players';
import { requireSession, setSessionCookie, signSession } from './_lib/session';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'GET') {
    await getProfile(req, res);
    return;
  }
  if (req.method === 'PATCH') {
    await patchName(req, res);
    return;
  }
  methodIs(req, res, 'GET', 'PATCH');
}

/**
 * GET /api/profile?handle=x — public pilot profile. Records come from the
 * validated lb_* columns (same source as the ranking); aggregates from the
 * cloud save.
 */
async function getProfile(req: VercelRequest, res: VercelResponse): Promise<void> {
  const handle = (queryParam(req, 'handle') ?? '').toLowerCase();
  if (!handle) {
    sendError(res, 400, 'bad_request');
    return;
  }

  try {
    const result = await db().query(
      `select p.handle, p.display_name, p.created_at,
              s.lb_wave, s.lb_coins, s.lb_time, s.lb_score,
              s.lb_wave_at, s.lb_coins_at, s.lb_time_at,
              s.runs, s.total_kills, s.total_time
       from players p join saves s on s.player_id = p.id
       where p.handle = $1`,
      [handle],
    );
    if (result.rows.length === 0) {
      sendError(res, 404, 'not_found');
      return;
    }
    const row = result.rows[0];

    const rankOf = async (col: 'lb_wave' | 'lb_coins' | 'lb_time'): Promise<number | null> => {
      const value = Number(row[col]);
      if (value <= 0) return null;
      const ahead = await db().query(
        `select count(*)::int as n from saves
         where ${col} > $1 or (${col} = $1 and ${col}_at < $2)`,
        [value, row[`${col}_at`]],
      );
      return (ahead.rows[0]?.n ?? 0) + 1;
    };

    const response: ProfileResponse = {
      handle: row.handle,
      name: row.display_name,
      createdAt: new Date(row.created_at).toISOString(),
      stats: {
        bestWave: row.lb_wave,
        bestScore: Number(row.lb_score),
        bestTime: row.lb_time,
        bestCoins: row.lb_coins,
        runs: row.runs,
        totalKills: Number(row.total_kills),
        totalTime: row.total_time,
      },
      ranks: {
        wave: await rankOf('lb_wave'),
        coins: await rankOf('lb_coins'),
        time: await rankOf('lb_time'),
      },
    };
    res.status(200).json(response);
  } catch (e) {
    console.error('profile failed', e);
    sendError(res, 500, 'internal');
  }
}

/**
 * PATCH /api/profile — body { name }: change display name; the public handle
 * is re-derived (auto-suffixed on collision) and the session cookie renewed.
 */
async function patchName(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!csrfOk(req, res)) return;
  const claims = await requireSession(req, res);
  if (!claims) return;

  const body = (req.body ?? {}) as { name?: unknown };
  const name = sanitizeName(typeof body.name === 'string' ? body.name : '');
  if (nameError(name) !== null) {
    sendError(res, 422, 'invalid_name');
    return;
  }

  const client = await db().connect();
  try {
    await client.query('begin');
    const handle = await allocateHandle(client, handleFromName(name), claims.playerId);
    const updated = await client.query(
      `update players set display_name = $2, handle = $3 where id = $1 returning ${PLAYER_COLS}`,
      [claims.playerId, name, handle],
    );
    if (updated.rows.length === 0) {
      await client.query('rollback');
      sendError(res, 401, 'unauthorized');
      return;
    }
    const saveRow = await client.query(
      `select ${SAVE_COLS} from saves where player_id = $1`,
      [claims.playerId],
    );
    await client.query('commit');

    const player = updated.rows[0] as PlayerRow;
    setSessionCookie(res, await signSession(player.id, player.handle));
    const response: MeResponse = {
      player: playerInfo(player),
      save: cloudSaveFromRow(saveRow.rows[0]),
    };
    res.status(200).json(response);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    console.error('patch profile failed', e);
    sendError(res, 500, 'internal');
  } finally {
    client.release();
  }
}

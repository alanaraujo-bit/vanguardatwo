import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { BoardKind, LeaderboardEntry, LeaderboardResponse } from '../src/net/protocol';
import { db } from './_lib/db';
import { methodIs, queryParam, sendError } from './_lib/http';
import { readSession } from './_lib/session';

const TOP_N = 50;

/** Fixed column mapping — board input never reaches the SQL as text. */
const BOARDS: Record<BoardKind, { value: string; at: string }> = {
  wave: { value: 'lb_wave', at: 'lb_wave_at' },
  coins: { value: 'lb_coins', at: 'lb_coins_at' },
  time: { value: 'lb_time', at: 'lb_time_at' },
};

/** GET /api/leaderboard?board=wave|coins|time — top 50 + the caller's rank. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;

  const board = (queryParam(req, 'board') ?? 'wave') as BoardKind;
  const cols = BOARDS[board];
  if (!cols) {
    sendError(res, 400, 'bad_request');
    return;
  }

  try {
    const top = await db().query(
      `select p.handle, p.display_name, s.${cols.value} as value
       from saves s join players p on p.id = s.player_id
       where s.${cols.value} > 0
       order by s.${cols.value} desc, s.${cols.at} asc
       limit ${TOP_N}`,
    );
    const entries: LeaderboardEntry[] = top.rows.map((row, i) => ({
      rank: i + 1,
      handle: row.handle as string,
      name: row.display_name as string,
      value: Number(row.value),
    }));

    let me: LeaderboardResponse['me'] = null;
    const claims = await readSession(req);
    if (claims) {
      const mine = await db().query(
        `select ${cols.value} as value, ${cols.at} as at from saves where player_id = $1`,
        [claims.playerId],
      );
      const value = Number(mine.rows[0]?.value ?? 0);
      if (value > 0) {
        const ahead = await db().query(
          `select count(*)::int as n from saves
           where ${cols.value} > $1
              or (${cols.value} = $1 and ${cols.at} < $2)`,
          [value, mine.rows[0].at],
        );
        me = { rank: (ahead.rows[0]?.n ?? 0) + 1, value };
      }
    }

    const response: LeaderboardResponse = { board, entries, me };
    res.status(200).json(response);
  } catch (e) {
    console.error('leaderboard failed', e);
    sendError(res, 500, 'internal');
  }
}

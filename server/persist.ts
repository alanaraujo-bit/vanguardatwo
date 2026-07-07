import { randomUUID } from 'node:crypto';
import { db } from '../api/_lib/db.js';
import type { SimResult } from '../src/game/sim';

/**
 * End-of-match persistence, straight from the authoritative sim — no
 * plausibility checks needed, the server IS the source of truth.
 *
 * Deliberate scope: co-op results credit coins and append to the runs trail
 * (mode='coop'), but never touch the lb_* solo leaderboards or best_* solo
 * records — a duo run is easier than a solo run and would poison those
 * boards. A future co-op board can rank `runs where mode='coop'`.
 */
export async function persistCoopResults(
  players: { slot: number; playerId: string | null }[],
  results: SimResult[],
  partySize: number,
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>(players.map((p) => [p.slot, null]));
  if (!process.env.DATABASE_URL) return out;

  const authed = players.filter((p) => p.playerId !== null);
  if (authed.length === 0) return out;

  const client = await db().connect();
  try {
    for (const p of authed) {
      const r = results.find((x) => x.slot === p.slot);
      if (!r) continue;
      try {
        await client.query('begin');
        await client.query(
          `insert into runs (player_id, client_run_id, wave, score, kills, time, coins, mode, party_size)
           values ($1, $2, $3, $4, $5, $6, $7, 'coop', $8)
           on conflict (player_id, client_run_id) do nothing`,
          [p.playerId, randomUUID(), r.wave, r.score, r.kills, Math.round(r.time), r.coinsEarned, partySize],
        );
        const updated = await client.query(
          `update saves set
             coins = coins + $2,
             runs = runs + 1,
             total_kills = total_kills + $3,
             total_time = total_time + $4,
             updated_at = now()
           where player_id = $1
           returning coins`,
          [p.playerId, r.coinsEarned, r.kills, Math.round(r.time)],
        );
        await client.query('commit');
        const total = updated.rows[0]?.coins;
        if (total !== undefined) out.set(p.slot, Number(total));
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        console.error(`[persist] slot ${p.slot} falhou`, e);
      }
    }
  } finally {
    client.release();
  }
  return out;
}

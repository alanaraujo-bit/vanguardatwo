import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { RunResponse } from '../src/net/protocol';
import { db } from './_lib/db';
import { csrfOk, methodIs, sendError } from './_lib/http';
import { requireSession } from './_lib/session';
import { parseRun, runPlausible } from './_lib/validate';

/**
 * POST /api/runs — submit a finished run. This is the only writer of the
 * lb_* leaderboard columns: results must pass the plausibility rules, are
 * idempotent per runId (offline retry queue) and rate-limited.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'POST')) return;
  if (!csrfOk(req, res)) return;
  const claims = await requireSession(req, res);
  if (!claims) return;

  const run = parseRun(req.body);
  if (!run) {
    sendError(res, 400, 'bad_request');
    return;
  }
  if (!runPlausible(run)) {
    sendError(res, 422, 'implausible');
    return;
  }

  const client = await db().connect();
  try {
    const recent = await client.query(
      "select count(*)::int as n from runs where player_id = $1 and created_at > now() - interval '60 seconds'",
      [claims.playerId],
    );
    if ((recent.rows[0]?.n ?? 0) >= 6) {
      sendError(res, 429, 'rate_limited');
      return;
    }

    await client.query('begin');
    const inserted = await client.query(
      `insert into runs (player_id, client_run_id, wave, score, kills, time, coins)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (player_id, client_run_id) do nothing
       returning id`,
      [claims.playerId, run.runId, run.wave, run.score, run.kills, run.time, run.coins],
    );
    if (inserted.rows.length === 0) {
      // Duplicate retry of an already-accepted run.
      await client.query('commit');
      const dup: RunResponse = { accepted: true, records: { wave: false, coins: false, time: false } };
      res.status(200).json(dup);
      return;
    }

    const current = await client.query(
      'select lb_wave, lb_coins, lb_time from saves where player_id = $1 for update',
      [claims.playerId],
    );
    if (current.rows.length === 0) {
      await client.query('rollback');
      sendError(res, 401, 'unauthorized');
      return;
    }
    const prev = current.rows[0] as { lb_wave: number; lb_coins: number; lb_time: number };
    const records = {
      wave: run.wave > prev.lb_wave,
      coins: run.coins > prev.lb_coins,
      time: run.time > prev.lb_time,
    };
    await client.query(
      `update saves set
         lb_wave  = greatest(lb_wave, $2),
         lb_wave_at  = case when $2 > lb_wave  then now() else lb_wave_at  end,
         lb_coins = greatest(lb_coins, $3),
         lb_coins_at = case when $3 > lb_coins then now() else lb_coins_at end,
         lb_time  = greatest(lb_time, $4),
         lb_time_at  = case when $4 > lb_time  then now() else lb_time_at  end,
         lb_score = greatest(lb_score, $5),
         best_wave  = greatest(best_wave, $2),
         best_coins = greatest(best_coins, $3),
         best_time  = greatest(best_time, $4),
         best_score = greatest(best_score, $5),
         updated_at = now()
       where player_id = $1`,
      [claims.playerId, run.wave, run.coins, run.time, run.score],
    );
    await client.query('commit');

    const response: RunResponse = { accepted: true, records };
    res.status(200).json(response);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    console.error('runs failed', e);
    sendError(res, 500, 'internal');
  } finally {
    client.release();
  }
}

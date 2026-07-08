import { Pool } from 'pg';
import type { CloudSave } from '../../src/net/protocol.js';

/** Pool or transaction client — both expose query(). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const SAVE_COLS =
  'coins, meta, best_wave, best_score, best_time, best_coins, runs, total_kills, total_time, tutorial_done, settings, campaign_level';

/**
 * Shared pg pool, reused across invocations of a warm serverless instance.
 * Kept tiny (max 3) so a burst of cold starts doesn't exhaust the Railway
 * Postgres connection limit.
 */
let pool: Pool | null = null;

export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export interface SaveRow {
  coins: string | number;
  meta: Record<string, number>;
  best_wave: number;
  best_score: string | number;
  best_time: number;
  best_coins: number;
  runs: number;
  total_kills: string | number;
  total_time: number;
  tutorial_done: boolean;
  settings: CloudSave['settings'];
  campaign_level: number;
}

/** pg returns bigint columns as strings — normalize into the wire shape. */
export function cloudSaveFromRow(row: SaveRow): CloudSave {
  return {
    coins: Number(row.coins),
    meta: row.meta ?? {},
    bestWave: row.best_wave,
    bestScore: Number(row.best_score),
    bestTime: row.best_time,
    bestCoins: row.best_coins,
    runs: row.runs,
    totalKills: Number(row.total_kills),
    totalTime: row.total_time,
    tutorialDone: row.tutorial_done,
    settings: row.settings ?? null,
    campaignLevel: row.campaign_level,
  };
}

export async function writeCloudSave(q: Queryable, playerId: string, save: CloudSave): Promise<void> {
  await q.query(
    `update saves set
       coins = $2, meta = $3, best_wave = $4, best_score = $5, best_time = $6,
       best_coins = $7, runs = $8, total_kills = $9, total_time = $10,
       tutorial_done = $11, settings = $12, campaign_level = $13, updated_at = now()
     where player_id = $1`,
    [
      playerId, save.coins, JSON.stringify(save.meta), save.bestWave, save.bestScore,
      save.bestTime, save.bestCoins, save.runs, save.totalKills, save.totalTime,
      save.tutorialDone, save.settings ? JSON.stringify(save.settings) : null, save.campaignLevel,
    ],
  );
}

import { Pool } from 'pg';
import { clampSettings, type CloudSave } from '../../src/net/protocol.js';

/** Pool or transaction client — both expose query(). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Adding a field to CloudSave (src/net/protocol.ts)? It is NOT enough on its
 * own — this file has to grow in lockstep or every login/save round-trip
 * silently drops the new field, which then crashes the merge helpers in
 * protocol.ts (they spread arrays like `[...c.someList]`, which throws on
 * undefined). Three things to update together:
 *   1. SAVE_COLS below + the matching column(s) in db/schema.sql
 *   2. SaveRow's shape
 *   3. cloudSaveFromRow() and writeCloudSave()
 * This has broken production login twice already from a field being added
 * to CloudSave without a matching update here.
 */
export const SAVE_COLS =
  'coins, meta, best_wave, best_score, best_time, best_coins, runs, total_kills, total_time, tutorial_done, settings, campaign_level, campaign_stars, skin, owned_skins, joystick_skin, owned_joystick_skins, total_gems, bosses_killed, achievements';

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
  campaign_stars: Record<string, number>;
  skin: string;
  owned_skins: string[];
  joystick_skin: string;
  owned_joystick_skins: string[];
  total_gems: string | number;
  bosses_killed: string[];
  achievements: Record<string, number>;
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
    // Rows written before `graphics` existed have `settings` present but
    // missing that field — clamp on the way out so nothing downstream ever
    // sees an incomplete Settings object (see clampSettings' doc comment).
    settings: clampSettings(row.settings),
    campaignLevel: row.campaign_level,
    campaignStars: row.campaign_stars ?? {},
    skin: row.skin ?? 'aegis',
    ownedSkins: row.owned_skins ?? [],
    joystickSkin: row.joystick_skin ?? 'cibernetico',
    ownedJoystickSkins: row.owned_joystick_skins ?? [],
    totalGems: Number(row.total_gems ?? 0),
    bossesKilled: row.bosses_killed ?? [],
    achievements: row.achievements ?? {},
  };
}

export async function writeCloudSave(q: Queryable, playerId: string, save: CloudSave): Promise<void> {
  await q.query(
    `update saves set
       coins = $2, meta = $3, best_wave = $4, best_score = $5, best_time = $6,
       best_coins = $7, runs = $8, total_kills = $9, total_time = $10,
       tutorial_done = $11, settings = $12, campaign_level = $13, campaign_stars = $14,
       skin = $15, owned_skins = $16, joystick_skin = $17, owned_joystick_skins = $18,
       total_gems = $19, bosses_killed = $20, achievements = $21, updated_at = now()
     where player_id = $1`,
    [
      playerId, save.coins, JSON.stringify(save.meta), save.bestWave, save.bestScore,
      save.bestTime, save.bestCoins, save.runs, save.totalKills, save.totalTime,
      save.tutorialDone, save.settings ? JSON.stringify(save.settings) : null, save.campaignLevel,
      JSON.stringify(save.campaignStars), save.skin, JSON.stringify(save.ownedSkins),
      save.joystickSkin, JSON.stringify(save.ownedJoystickSkins),
      save.totalGems, JSON.stringify(save.bossesKilled), JSON.stringify(save.achievements),
    ],
  );
}

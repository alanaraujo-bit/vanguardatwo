import type { SaveData, Settings } from '../core/save.js';
import { META_DEFS } from '../game/meta.js';

/**
 * Wire types and pure merge/clamp logic shared verbatim by the browser
 * client and the Vercel serverless functions (api/). Nothing here may touch
 * the DOM or Node APIs.
 */

// ————— wire types —————

export interface CloudSave {
  coins: number;
  meta: Record<string, number>;
  bestWave: number;
  bestScore: number;
  bestTime: number;
  bestCoins: number;
  runs: number;
  totalKills: number;
  totalTime: number;
  tutorialDone: boolean;
  settings: Settings | null;
  campaignLevel: number;
}

export interface PlayerInfo {
  id: string;
  handle: string;
  name: string;
  createdAt: string;
}

export interface AuthRequest {
  credential: string;
  name?: string;
  localSave?: CloudSave;
}

export interface AuthResponse {
  player: PlayerInfo;
  save: CloudSave;
  isNew: boolean;
}

export interface MeResponse {
  player: PlayerInfo;
  save: CloudSave;
}

export interface SaveRequest {
  save: CloudSave;
}

export interface SaveResponse {
  save: CloudSave;
}

export interface RunSubmission {
  runId: string;
  wave: number;
  score: number;
  kills: number;
  time: number;
  coins: number;
}

export interface RunResponse {
  accepted: boolean;
  records: { wave: boolean; coins: boolean; time: boolean };
}

export type BoardKind = 'wave' | 'coins' | 'time';

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  name: string;
  value: number;
}

export interface LeaderboardResponse {
  board: BoardKind;
  entries: LeaderboardEntry[];
  me: { rank: number; value: number } | null;
}

export interface ProfileResponse {
  handle: string;
  name: string;
  createdAt: string;
  stats: {
    bestWave: number;
    bestScore: number;
    bestTime: number;
    bestCoins: number;
    runs: number;
    totalKills: number;
    totalTime: number;
  };
  ranks: {
    wave: number | null;
    coins: number | null;
    time: number | null;
  };
}

export interface NameRequest {
  name: string;
}

export interface ApiErrorBody {
  error: string;
  suggestion?: string;
}

// ————— sanity limits (anti-corruption / anti-cheat ceilings) —————

export const SAVE_LIMITS = {
  coins: 10_000_000,
  bestWave: 500,
  bestScore: 10_000_000,
  bestTime: 4 * 3600,
  bestCoins: 100_000,
  runs: 200_000,
  totalKills: 50_000_000,
  totalTime: 20_000 * 3600,
  campaignLevel: 11,
} as const;

function num(v: unknown, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.min(Math.max(0, n), max);
}

function int(v: unknown, max: number): number {
  return Math.floor(num(v, max));
}

/** Coerce an untrusted save into a well-formed one (never throws). */
export function clampCloudSave(raw: Partial<CloudSave> | null | undefined): CloudSave {
  const r = raw ?? {};
  const meta: Record<string, number> = {};
  if (r.meta && typeof r.meta === 'object') {
    for (const def of META_DEFS) {
      const lvl = int((r.meta as Record<string, unknown>)[def.id], def.max);
      if (lvl > 0) meta[def.id] = lvl;
    }
  }
  const s = r.settings;
  const settings: Settings | null =
    s && typeof s === 'object'
      ? { sfx: s.sfx !== false, music: s.music !== false, haptics: s.haptics !== false, lowFx: s.lowFx === true }
      : null;
  return {
    coins: int(r.coins, SAVE_LIMITS.coins),
    meta,
    bestWave: int(r.bestWave, SAVE_LIMITS.bestWave),
    bestScore: int(r.bestScore, SAVE_LIMITS.bestScore),
    bestTime: num(r.bestTime, SAVE_LIMITS.bestTime),
    bestCoins: int(r.bestCoins, SAVE_LIMITS.bestCoins),
    runs: int(r.runs, SAVE_LIMITS.runs),
    totalKills: int(r.totalKills, SAVE_LIMITS.totalKills),
    totalTime: num(r.totalTime, SAVE_LIMITS.totalTime),
    tutorialDone: r.tutorialDone === true,
    settings,
    campaignLevel: Math.max(1, int(r.campaignLevel, SAVE_LIMITS.campaignLevel)),
  };
}

/**
 * Merge two saves without ever losing progress: records, aggregates and
 * upgrade levels take the max of both sides. Coins are the one non-monotonic
 * field (purchases lower them) — `coinsFrom` picks the authoritative side:
 * 'max' on first-login merges (never lose grind), 'a' on regular pushes
 * (the client just spent or earned them).
 */
export function mergeCloudSaves(a: CloudSave, b: CloudSave, coinsFrom: 'max' | 'a'): CloudSave {
  const meta: Record<string, number> = { ...b.meta };
  for (const [id, lvl] of Object.entries(a.meta)) {
    meta[id] = Math.max(meta[id] ?? 0, lvl);
  }
  return {
    coins: coinsFrom === 'a' ? a.coins : Math.max(a.coins, b.coins),
    meta,
    bestWave: Math.max(a.bestWave, b.bestWave),
    bestScore: Math.max(a.bestScore, b.bestScore),
    bestTime: Math.max(a.bestTime, b.bestTime),
    bestCoins: Math.max(a.bestCoins, b.bestCoins),
    runs: Math.max(a.runs, b.runs),
    totalKills: Math.max(a.totalKills, b.totalKills),
    totalTime: Math.max(a.totalTime, b.totalTime),
    tutorialDone: a.tutorialDone || b.tutorialDone,
    settings: a.settings ?? b.settings,
    campaignLevel: Math.max(a.campaignLevel, b.campaignLevel),
  };
}

// ————— SaveData ⇄ CloudSave —————

export function cloudFromSave(d: SaveData): CloudSave {
  return clampCloudSave({
    coins: d.coins,
    meta: d.meta,
    bestWave: d.bestWave,
    bestScore: d.bestScore,
    bestTime: d.bestTime,
    bestCoins: d.bestCoins,
    runs: d.runs,
    totalKills: d.totalKills,
    totalTime: d.totalTime,
    tutorialDone: d.tutorialDone,
    settings: d.settings,
    campaignLevel: d.campaignLevel,
  });
}

/** Overwrite the syncable slice of a local save with cloud values (in place). */
export function applyCloudToSave(d: SaveData, c: CloudSave): void {
  d.coins = c.coins;
  d.meta = { ...c.meta };
  d.bestWave = c.bestWave;
  d.bestScore = c.bestScore;
  d.bestTime = c.bestTime;
  d.bestCoins = c.bestCoins;
  d.runs = c.runs;
  d.totalKills = c.totalKills;
  d.totalTime = c.totalTime;
  d.tutorialDone = d.tutorialDone || c.tutorialDone;
  if (c.settings) d.settings = { ...c.settings };
  d.campaignLevel = c.campaignLevel;
}

import { SPECS, type EnemyKind } from '../game/enemies';
import type { PickupKind } from '../game/pickups';

/**
 * Wire contract for the realtime co-op protocol, shared verbatim between the
 * browser client (src/) and the game server (server/) — the same role that
 * protocol.ts plays for the HTTP API. Keep this file free of DOM and Node
 * dependencies (type-only game imports are fine).
 *
 * Transport: WebSocket + JSON with permessage-deflate. Entity state travels
 * as flat number arrays (stride-indexed) to keep snapshots small and parsing
 * allocation-free; discrete happenings travel as SimEvents inside the snap.
 */

export const PROTO_VER = 1;
/** Server simulation rate (fixed-step ticks per second). */
export const SIM_RATE = 30;
export const SIM_DT = 1 / SIM_RATE;
/** Snapshot broadcast rate — one snap every SIM_RATE / SNAP_RATE ticks. */
export const SNAP_RATE = 15;
/** Remote-entity interpolation buffer (~2 snapshots). */
export const INTERP_MS = 133;
/** Co-op party size (versus reuses the same room plumbing later). */
export const MAX_PLAYERS = 2;

/** Room codes: 5 chars, ambiguous glyphs (O/I/0/1) excluded. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 5;

/**
 * Canonical enemy-kind order for wire encoding. Derived from SPECS so it can
 * never drift from the game data; both endpoints run this same module.
 */
export const ENEMY_KINDS = Object.keys(SPECS) as EnemyKind[];
export const PICKUP_KINDS: PickupKind[] = ['gem', 'coin', 'heart'];

/** Wire strides for the flat entity arrays in a Snap. */
export const STRIDE = {
  /** [id, kindIdx, x, y, rot100, flash01] */
  enemy: 6,
  /** [id, x, y, vx, vy] — velocity lets the client extrapolate between snaps */
  eshot: 5,
  /** [id, x, y, ang100, crit01, ownerSlot] */
  pshot: 6,
  /** [id, kindIdx, x, y] */
  pickup: 4,
} as const;

// ————————————————————— client → server —————————————————————

export type ClientMsg =
  /** First message on the socket. `token` from /api/realtime-token; absent = guest. */
  | { t: 'hello'; ver: number; name: string; token?: string; meta?: Record<string, number> }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'ready'; ready: boolean }
  /** Host only; starts the match for the whole room. */
  | { t: 'start' }
  /** Movement intent, quantized to 2 decimals. seq is per-connection monotonic. */
  | { t: 'input'; seq: number; mx: number; my: number }
  | { t: 'pick'; offerId: number; upgradeId: string }
  | { t: 'ping'; ts: number }
  | { t: 'leave' };

// ————————————————————— server → client —————————————————————

export interface RoomPlayer {
  slot: number;
  name: string;
  ready: boolean;
  connected: boolean;
}

export type ServerErr =
  | 'version'
  | 'bad_token'
  | 'room_not_found'
  | 'room_full'
  | 'not_in_room'
  | 'not_host'
  | 'bad_msg';

export type ServerMsg =
  | { t: 'welcome'; slot: number; guest: boolean }
  | { t: 'room'; code: string; hostSlot: number; players: RoomPlayer[] }
  | { t: 'start'; tick: number; seed: number }
  | { t: 'snap'; s: Snap }
  /** Level-up choices for one player; deadline enforced server-side (auto-pick). */
  | { t: 'offer'; offerId: number; slot: number; choices: string[]; deadlineTick: number }
  | { t: 'end'; results: EndResult[] }
  | { t: 'pong'; ts: number; tick: number }
  | { t: 'err'; code: ServerErr };

export interface PlayerSnap {
  slot: number;
  x: number; y: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  level: number; xp: number; xpNeed: number;
  coins: number;
  score: number;
  kills: number;
  dead: boolean;
  /** Remaining invulnerability, seconds (quantized). */
  ifr: number;
  /** Facing angle ×100 (rounded) — rendering only. */
  facing100: number;
  /** True while a level-up offer is open for this player. */
  choosing: boolean;
}

/** Full-state snapshot, broadcast at SNAP_RATE. `ack` is per-connection. */
export interface Snap {
  tick: number;
  /** Highest input seq from THIS client applied to the sim so far. */
  ack: number;
  wave: number;
  players: PlayerSnap[];
  enemies: number[];
  eshots: number[];
  pshots: number[];
  pickups: number[];
  boss: [hp: number, maxHp: number] | null;
  ev: SimEvent[];
}

/**
 * Discrete happenings since the previous snapshot. Sound travels exclusively
 * as 'sfx' events; the typed events drive visuals/UI only (never re-play
 * audio for them on the client — that would double up with 'sfx').
 */
export type SimEvent =
  | { e: 'wave'; n: number }
  | { e: 'sector'; n: number }
  | { e: 'bossWarn' }
  | { e: 'bossDown' }
  /** Enemy death visual: kind index + where. */
  | { e: 'kill'; x: number; y: number; k: number }
  /** Damage floater on an enemy. c=1 → crit. Capped per snap window. */
  | { e: 'dmg'; x: number; y: number; v: number; c: 0 | 1 }
  /** A player took damage (screen shake if it's the local slot). */
  | { e: 'hit'; slot: number; v: number }
  | { e: 'gem'; slot: number }
  | { e: 'coin'; slot: number; v: number }
  | { e: 'nova'; slot: number }
  | { e: 'levelup'; slot: number }
  | { e: 'death'; slot: number }
  | { e: 'revive'; slot: number }
  | { e: 'sfx'; s: string; p?: number };

export interface EndResult {
  slot: number;
  name: string;
  score: number;
  kills: number;
  wave: number;
  time: number;
  /** This player's half of the party's coin pot. */
  coinsEarned: number;
  /** Post-credit account total (server-authoritative); null for guests. */
  newCoinTotal: number | null;
}

// ————————————————————— helpers —————————————————————

export function q100(v: number): number {
  return Math.round(v * 100);
}

export function q1(v: number): number {
  return Math.round(v);
}

/** Parse a JSON wire message defensively; null on garbage. */
export function parseMsg<T extends { t: string }>(data: unknown): T | null {
  if (typeof data !== 'string') return null;
  try {
    const obj = JSON.parse(data) as T;
    return obj && typeof obj.t === 'string' ? obj : null;
  } catch {
    return null;
  }
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * Sala Personalizada — the shared room-rule bundle.
 *
 * The host configures these rules in the lobby; the game server clamps and
 * enforces them (the client is never trusted). Defaults reproduce classic
 * co-op exactly, so a default-config custom room plays like today's co-op.
 *
 * PURITY CONTRACT: this module is imported by src/net/protocol.ts, which is
 * compiled by api/tsconfig.json (lib ES2022, no DOM). It must not import
 * game-data modules — sectors.ts/upgrades.ts pull in canvas/DOM types.
 * Callers that own the real id lists pass them in for validation.
 */

export type ProgressionMode = 'random' | 'ordered' | 'single';

export interface RoomConfig {
  /** Opening sector id, or 'random' for the usual roll. */
  startSector: string;
  /** How the next sector is chosen at each boundary; 'single' never leaves. */
  progression: ProgressionMode;
  wavesPerSector: number;
  /** Boss encounter every N waves; 0 disables bosses entirely. */
  bossEvery: number;
  /** Applies to bosses too (stacks on the party bossHpMul). */
  enemyHpMul: number;
  enemyDmgMul: number;
  /** Scales both simultaneous-enemy and batch spawn budgets. */
  spawnMul: number;
  playerHpMul: number;
  playerDmgMul: number;
  xpMul: number;
  reviveEnabled: boolean;
  /** HP fraction restored on wave-boundary revives (when enabled). */
  reviveHpFrac: number;
  /** Upgrade ids removed from level-up offers. */
  bannedUpgrades: string[];
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  startSector: 'random',
  progression: 'random',
  wavesPerSector: 10,
  bossEvery: 5,
  enemyHpMul: 1,
  enemyDmgMul: 1,
  spawnMul: 1,
  playerHpMul: 1,
  playerDmgMul: 1,
  xpMul: 1,
  reviveEnabled: true,
  reviveHpFrac: 0.5,
  bannedUpgrades: [],
};

/** Slider ranges — single source for the config UI and the server clamp. */
export interface MulRange {
  min: number;
  max: number;
  step: number;
}

type MulField = 'enemyHpMul' | 'enemyDmgMul' | 'spawnMul' | 'playerHpMul' | 'playerDmgMul' | 'xpMul';

export const ROOM_MULS: Record<MulField, MulRange> = {
  enemyHpMul: { min: 0.5, max: 3, step: 0.1 },
  enemyDmgMul: { min: 0.5, max: 3, step: 0.1 },
  spawnMul: { min: 0.5, max: 2, step: 0.25 },
  playerHpMul: { min: 0.5, max: 3, step: 0.1 },
  playerDmgMul: { min: 0.5, max: 3, step: 0.1 },
  xpMul: { min: 0.5, max: 3, step: 0.25 },
};

export const WAVES_PER_SECTOR_OPTIONS: readonly number[] = [5, 10, 15, 20];
export const BOSS_EVERY_OPTIONS: readonly number[] = [0, 3, 5, 10];
export const REVIVE_HP_OPTIONS: readonly number[] = [0.25, 0.5, 0.75, 1];
/** At least 3 of the 13 upgrades must stay in the pool for offers to work. */
export const MAX_BANNED_UPGRADES = 10;
/** Ceiling for party spawn budget × spawnMul (mobile render perf). */
export const SPAWN_COMBINED_CAP = 3;

export const ROOM_PRESETS_MAX = 8;
export const PRESET_NAME_MAX = 20;
const PRESET_ID_MAX = 16;
const SECTOR_ID_MAX = 24;
const UPGRADE_ID_MAX = 24;

export interface RoomPreset {
  id: string;
  name: string;
  updatedAt: number;
  config: RoomConfig;
}

export interface RoomConfigIdLists {
  sectorIds?: readonly string[];
  upgradeIds?: readonly string[];
}

function finite(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

function oneOf<T>(v: unknown, options: readonly T[], def: T): T {
  return options.includes(v as T) ? (v as T) : def;
}

/**
 * Coerce an untrusted config into a valid one. Numbers clamp to range and
 * snap to their step; enums fall back to defaults. Sector/upgrade ids are
 * validated against the given lists when provided (the game server passes
 * them); without lists only their shape is checked (preset storage).
 */
export function clampRoomConfig(raw: unknown, ids?: RoomConfigIdLists): RoomConfig {
  const d = DEFAULT_ROOM_CONFIG;
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const mul = (key: MulField): number => {
    const { min, max, step } = ROOM_MULS[key];
    const v = Math.min(max, Math.max(min, finite(r[key], d[key])));
    return Math.round((Math.round(v / step) * step) * 100) / 100;
  };

  let startSector = d.startSector;
  if (typeof r.startSector === 'string' && r.startSector.length <= SECTOR_ID_MAX) {
    const ok = r.startSector === 'random'
      || (ids?.sectorIds ? ids.sectorIds.includes(r.startSector) : true);
    if (ok) startSector = r.startSector;
  }

  const seen = new Set<string>();
  const bannedUpgrades: string[] = [];
  if (Array.isArray(r.bannedUpgrades)) {
    for (const id of r.bannedUpgrades) {
      if (typeof id !== 'string' || id.length === 0 || id.length > UPGRADE_ID_MAX) continue;
      if (ids?.upgradeIds && !ids.upgradeIds.includes(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      bannedUpgrades.push(id);
      if (bannedUpgrades.length >= MAX_BANNED_UPGRADES) break;
    }
  }

  return {
    startSector,
    progression: oneOf<ProgressionMode>(r.progression, ['random', 'ordered', 'single'], d.progression),
    wavesPerSector: oneOf(r.wavesPerSector, WAVES_PER_SECTOR_OPTIONS, d.wavesPerSector),
    bossEvery: oneOf(r.bossEvery, BOSS_EVERY_OPTIONS, d.bossEvery),
    enemyHpMul: mul('enemyHpMul'),
    enemyDmgMul: mul('enemyDmgMul'),
    spawnMul: mul('spawnMul'),
    playerHpMul: mul('playerHpMul'),
    playerDmgMul: mul('playerDmgMul'),
    xpMul: mul('xpMul'),
    reviveEnabled: typeof r.reviveEnabled === 'boolean' ? r.reviveEnabled : d.reviveEnabled,
    reviveHpFrac: oneOf(r.reviveHpFrac, REVIVE_HP_OPTIONS, d.reviveHpFrac),
    bannedUpgrades,
  };
}

/** Coerce an untrusted preset list (localStorage / cloud rows / client pushes). */
export function clampRoomPresets(raw: unknown): RoomPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomPreset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    const id = typeof p.id === 'string' ? p.id.slice(0, PRESET_ID_MAX) : '';
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, PRESET_NAME_MAX) : '';
    if (id === '' || name === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      updatedAt: Math.max(0, Math.floor(finite(p.updatedAt, 0))),
      config: clampRoomConfig(p.config),
    });
    if (out.length >= ROOM_PRESETS_MAX) break;
  }
  return out;
}

/**
 * The CoopTuning fields a room config touches (structural mirror — sim.ts
 * can't be imported here, see the purity contract above).
 */
interface TuningLike {
  hpMul?: number;
  dmgMul?: number;
  bossHpMul?: number;
  maxAliveMul?: number;
  batchMul?: number;
  reviveHpFrac?: number;
  xpMul?: number;
  reviveEnabled?: boolean;
}

/** Layer a room config over a base party tuning (e.g. BAL.coop). */
export function applyRoomConfigToTuning<T extends TuningLike>(base: T, cfg: RoomConfig): T & Required<TuningLike> {
  const spawn = (m: number | undefined): number => Math.min((m ?? 1) * cfg.spawnMul, SPAWN_COMBINED_CAP);
  return {
    ...base,
    hpMul: (base.hpMul ?? 1) * cfg.enemyHpMul,
    dmgMul: (base.dmgMul ?? 1) * cfg.enemyDmgMul,
    bossHpMul: (base.bossHpMul ?? 1) * cfg.enemyHpMul,
    maxAliveMul: spawn(base.maxAliveMul),
    batchMul: spawn(base.batchMul),
    reviveHpFrac: cfg.reviveHpFrac,
    reviveEnabled: cfg.reviveEnabled,
    xpMul: cfg.xpMul,
  };
}

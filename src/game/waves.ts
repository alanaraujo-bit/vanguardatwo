import { BAL } from './balance';
import type { EnemyKind } from './enemies';
import { SECTORS, SECTOR_LEN, sectorForWave, sectorIndexForWave, sectorNumberForWave, rollRandomSector, type PoolEntry, type SectorDef } from './sectors';
import type { ProgressionMode } from './room-config';
import type { World } from './world';

export interface WaveEvents {
  onWave(wave: number): void;
  onBossWarn(sector: SectorDef): void;
  /** Fired when the run crosses into a new sector (never for the opening one). */
  onSector(sector: SectorDef, number: number): void;
}

/**
 * What GameScene needs from a wave source. The real run uses WaveDirector;
 * the guided tutorial swaps in a scripted TutorialDirector, and the campaign
 * swaps in a LevelDirector.
 */
export interface Director {
  wave: number;
  update(dt: number, world: World): void;
  /** True once this director's win condition is met (campaign only). */
  cleared?: boolean;
  /** The boss currently in play, for GameScene's HUD/defeat banner. Defaults
   * to Director's currentSector boss when absent. */
  bossInfo?(): SectorDef['boss'] | null;
  /** Current sector for this director (used for rendering environment) */
  currentSector?(): SectorDef;
  /** Graphics setting (entity density), client-only. Absent = TutorialDirector, unaffected. */
  densityMul?: number;
  /**
   * Enemies left before this wave clears (not-yet-spawned + still alive),
   * given the caller's current alive count. Null during a boss encounter,
   * where the boss HP bar tells that story instead. Absent = director has no
   * such concept (tutorial, campaign).
   */
  remaining?(aliveCount: number): number | null;
}

/**
 * Drives the run's pacing: each wave has a fixed enemy quota that trickles in
 * with a rising spawn budget, and clears only once every one of them is dead
 * (Zombies-style) — plus a boss encounter every few waves that must be
 * defeated to advance, and a sector change every SECTOR_LEN waves that swaps
 * the whole battlefield identity.
 */
export interface WaveBudget {
  /** Multiplies maxAlive (co-op spawns more simultaneous enemies). */
  maxAliveMul?: number;
  /** Multiplies the per-interval spawn batch size. */
  batchMul?: number;
  /** Waves per sector (custom rooms). Default SECTOR_LEN. */
  sectorLen?: number;
  /** Boss encounter every N waves; 0 disables bosses. Default BAL.wave.bossEvery. */
  bossEvery?: number;
  /** How the next sector is chosen at each boundary. Default 'random'. */
  progression?: ProgressionMode;
  /** Fixed opening sector id; absent or unknown = random roll. */
  startSectorId?: string;
}

export class WaveDirector implements Director {
  wave = 1;
  bossActive = false;
  /**
   * Player's graphics setting (entity density), client-only. The shared
   * WaveDirector used server-side by sim.ts never sets this, so it stays 1
   * there — co-op enemy counts are never affected by any one player's local
   * performance setting.
   */
  densityMul = 1;

  private spawnT = 1.1;
  private bossWarnT = 0;
  private bossPending = false;
  private trickleT = 0;
  /** Total enemies for the current wave, and how many have been spawned so far. */
  private quota: number;
  private spawned = 0;
  private readonly maxAliveMul: number;
  private readonly batchMul: number;
  private readonly sectorLen: number;
  private readonly bossEvery: number;
  private readonly progression: ProgressionMode;
  /** SECTORS index of the opening sector — anchors 'ordered' progression. */
  private readonly startIdx: number;

  private _currentSector: SectorDef;
  private _sectorCount = 1;

  constructor(private readonly events: WaveEvents, budget: WaveBudget = {}) {
    this.maxAliveMul = budget.maxAliveMul ?? 1;
    this.batchMul = budget.batchMul ?? 1;
    this.sectorLen = budget.sectorLen ?? SECTOR_LEN;
    this.bossEvery = budget.bossEvery ?? BAL.wave.bossEvery;
    this.progression = budget.progression ?? 'random';
    this.quota = BAL.wave.quota(this.wave);
    const fixed = budget.startSectorId !== undefined ? SECTORS.find((s) => s.id === budget.startSectorId) : undefined;
    this._currentSector = fixed ?? rollRandomSector();
    this.startIdx = SECTORS.indexOf(this._currentSector);
  }

  currentSector(): SectorDef {
    return this._currentSector;
  }

  bossInfo(): SectorDef['boss'] {
    return this._currentSector.boss;
  }

  remaining(aliveCount: number): number | null {
    if (this.bossPending || this.bossActive) return null;
    return Math.max(0, this.quota - this.spawned) + aliveCount;
  }

  update(dt: number, world: World): void {
    if (this.bossPending) {
      this.bossWarnT -= dt;
      if (this.bossWarnT <= 0) this.spawnBoss(world);
      return;
    }

    if (this.bossActive) {
      if (world.enemies.boss === null) {
        this.bossActive = false;
        this.advance();
      } else {
        // Light trickle keeps gem income alive during the fight.
        this.trickleT -= dt;
        if (this.trickleT <= 0 && world.enemies.list.length < 12) {
          this.trickleT = 2.6;
          this.spawnOne(world, this._currentSector.composition[0].kind);
        }
      }
      return;
    }

    if (this.spawned >= this.quota) {
      // Every enemy for this wave is out; wait for the board to actually
      // clear (covers splitter minis and other derived spawns too) before
      // moving on — Zombies-style, no next wave until the last one drops.
      if (world.enemies.list.length === 0) this.advance();
      return;
    }

    this.spawnT -= dt;
    if (this.spawnT <= 0 && world.enemies.list.length < BAL.wave.maxAlive(this.wave) * this.maxAliveMul * this.densityMul) {
      this.spawnT = BAL.wave.spawnInterval(this.wave);
      const batch = Math.min(
        Math.max(1, Math.round((1 + Math.floor(this.wave / 6)) * this.batchMul)),
        this.quota - this.spawned,
      );
      for (let i = 0; i < batch; i++) this.spawnOne(world);
    }
  }

  private advance(): void {
    const prev = this.wave;
    this.wave++;
    this.spawned = 0;
    this.quota = BAL.wave.quota(this.wave);
    // Short breather before the next wave's enemies start trickling in.
    this.spawnT = 1.5;
    if (this.progression !== 'single' && this.sectorIdx(this.wave) !== this.sectorIdx(prev)) {
      this._currentSector = this.nextSector();
      this._sectorCount++;
      // The sector banner owns the moment; the wave banner would fight it.
      this.events.onSector(this._currentSector, this._sectorCount);
    } else if (this.bossEvery > 0 && this.wave % this.bossEvery === 0) {
      this.bossPending = true;
      this.bossWarnT = 1.7;
      this.events.onBossWarn(this._currentSector);
    } else {
      this.events.onWave(this.wave);
    }
  }

  private spawnOne(world: World, forced?: EnemyKind): void {
    const kind = forced ?? this.rollKind();
    const [x, y] = world.randomSpawnPos();
    world.enemies.spawn(kind, x, y, BAL.wave.hpMul(this.wave), BAL.wave.dmgMul(this.wave));
    this.spawned++;
  }

  /** Sector ordinal for a wave under this room's sector length. */
  private sectorIdx(wave: number): number {
    return Math.floor((wave - 1) / this.sectorLen);
  }

  private nextSector(): SectorDef {
    if (this.progression === 'ordered') {
      return SECTORS[(this.startIdx + this._sectorCount) % SECTORS.length];
    }
    return rollRandomSector(this._currentSector.id);
  }

  private rollKind(): EnemyKind {
    const sector = this._currentSector;
    // Sector-relative wave, cycling on repeat visits (and in 'single' mode):
    // every pass through a sector ramps fodder → specialists again.
    const rel = this.wave - this.sectorIdx(this.wave) * this.sectorLen;
    const available = sector.composition.filter((c) => rel >= c.from);
    // Fodder slowly gives way to specialists as the sector progresses.
    const weightOf = (c: PoolEntry) =>
      c.decay ? Math.max(c.floor ?? 0, c.weight - rel * c.decay) : c.weight;
    const total = available.reduce((sum, c) => sum + weightOf(c), 0);
    let r = Math.random() * total;
    for (const c of available) {
      r -= weightOf(c);
      if (r <= 0) return c.kind;
    }
    return sector.composition[0].kind;
  }

  private spawnBoss(world: World): void {
    this.bossPending = false;
    this.bossActive = true;
    this.trickleT = 3;
    const [x, y] = world.randomSpawnPos();
    // bossHp is normalized against the Colosso's base HP, so heavier boss
    // kinds (higher base) naturally hit harder in later sectors.
    const hpMul = BAL.wave.bossHp(this.wave) / 520;
    world.enemies.spawn(this._currentSector.boss.kind, x, y, hpMul, BAL.wave.dmgMul(this.wave));
  }
}

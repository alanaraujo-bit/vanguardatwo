import { BAL } from './balance';
import type { EnemyKind } from './enemies';
import { SECTOR_LEN, sectorForWave, sectorIndexForWave, sectorNumberForWave, type PoolEntry, type SectorDef } from './sectors';
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
   * to WaveDirector's sector lookup when absent. */
  bossInfo?(): SectorDef['boss'] | null;
}

/**
 * Drives the run's pacing: timed waves with a rising spawn budget, a boss
 * encounter every few waves that must be defeated to advance, and a sector
 * change every SECTOR_LEN waves that swaps the whole battlefield identity.
 */
export interface WaveBudget {
  /** Multiplies maxAlive (co-op spawns more simultaneous enemies). */
  maxAliveMul?: number;
  /** Multiplies the per-interval spawn batch size. */
  batchMul?: number;
}

export class WaveDirector implements Director {
  wave = 1;
  bossActive = false;

  private waveT = 0;
  private spawnT = 1.1;
  private bossWarnT = 0;
  private bossPending = false;
  private trickleT = 0;
  private readonly maxAliveMul: number;
  private readonly batchMul: number;

  constructor(private readonly events: WaveEvents, budget: WaveBudget = {}) {
    this.maxAliveMul = budget.maxAliveMul ?? 1;
    this.batchMul = budget.batchMul ?? 1;
  }

  bossInfo(): SectorDef['boss'] {
    return sectorForWave(this.wave).boss;
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
          this.spawnOne(world, sectorForWave(this.wave).composition[0].kind);
        }
      }
      return;
    }

    this.waveT += dt;
    if (this.waveT >= BAL.wave.duration) {
      this.advance();
      return;
    }

    this.spawnT -= dt;
    if (this.spawnT <= 0 && world.enemies.list.length < BAL.wave.maxAlive(this.wave) * this.maxAliveMul) {
      this.spawnT = BAL.wave.spawnInterval(this.wave);
      const batch = Math.max(1, Math.round((1 + Math.floor(this.wave / 6)) * this.batchMul));
      for (let i = 0; i < batch; i++) this.spawnOne(world);
    }
  }

  private advance(): void {
    const prev = this.wave;
    this.wave++;
    this.waveT = 0;
    this.spawnT = 0.6;
    if (sectorIndexForWave(this.wave) !== sectorIndexForWave(prev)) {
      // The sector banner owns the moment; the wave banner would fight it.
      this.events.onSector(sectorForWave(this.wave), sectorNumberForWave(this.wave));
    } else if (this.wave % BAL.wave.bossEvery === 0) {
      this.bossPending = true;
      this.bossWarnT = 1.7;
      this.events.onBossWarn(sectorForWave(this.wave));
    } else {
      this.events.onWave(this.wave);
    }
  }

  private spawnOne(world: World, forced?: EnemyKind): void {
    const kind = forced ?? this.rollKind();
    const [x, y] = world.randomSpawnPos();
    world.enemies.spawn(kind, x, y, BAL.wave.hpMul(this.wave), BAL.wave.dmgMul(this.wave));
  }

  private rollKind(): EnemyKind {
    const sector = sectorForWave(this.wave);
    const rel = this.wave - sectorIndexForWave(this.wave) * SECTOR_LEN;
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
    world.enemies.spawn(sectorForWave(this.wave).boss.kind, x, y, hpMul, BAL.wave.dmgMul(this.wave));
  }
}

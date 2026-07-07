import { BAL } from './balance';
import type { EnemyKind } from './enemies';
import type { World } from './world';

export interface WaveEvents {
  onWave(wave: number): void;
  onBossWarn(): void;
}

/**
 * What GameScene needs from a wave source. The real run uses WaveDirector;
 * the guided tutorial swaps in a scripted TutorialDirector.
 */
export interface Director {
  wave: number;
  update(dt: number, world: World): void;
}

export interface PoolEntry { kind: EnemyKind; weight: number; from: number; }

/** Which wave each enemy kind starts appearing in — also drives the Codex's "surgimento" line. */
export const COMPOSITION: readonly PoolEntry[] = [
  { kind: 'drone', weight: 10, from: 1 },
  { kind: 'dart', weight: 6, from: 2 },
  { kind: 'splitter', weight: 4.5, from: 3 },
  { kind: 'wasp', weight: 4, from: 4 },
  { kind: 'tank', weight: 3, from: 6 },
];

/**
 * Drives the run's pacing: timed waves with a rising spawn budget, and a
 * boss encounter every few waves that must be defeated to advance.
 */
export class WaveDirector implements Director {
  wave = 1;
  bossActive = false;

  private waveT = 0;
  private spawnT = 1.1;
  private bossWarnT = 0;
  private bossPending = false;
  private trickleT = 0;

  constructor(private readonly events: WaveEvents) {}

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
          this.spawnOne(world, 'drone');
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
    if (this.spawnT <= 0 && world.enemies.list.length < BAL.wave.maxAlive(this.wave)) {
      this.spawnT = BAL.wave.spawnInterval(this.wave);
      const batch = 1 + Math.floor(this.wave / 6);
      for (let i = 0; i < batch; i++) this.spawnOne(world);
    }
  }

  private advance(): void {
    this.wave++;
    this.waveT = 0;
    this.spawnT = 0.6;
    if (this.wave % BAL.wave.bossEvery === 0) {
      this.bossPending = true;
      this.bossWarnT = 1.7;
      this.events.onBossWarn();
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
    const available = COMPOSITION.filter((c) => this.wave >= c.from);
    // Basic drones slowly give way to specialists.
    const weightOf = (c: PoolEntry) =>
      c.kind === 'drone' ? Math.max(4, c.weight - this.wave * 0.2) : c.weight;
    const total = available.reduce((sum, c) => sum + weightOf(c), 0);
    let r = Math.random() * total;
    for (const c of available) {
      r -= weightOf(c);
      if (r <= 0) return c.kind;
    }
    return 'drone';
  }

  private spawnBoss(world: World): void {
    this.bossPending = false;
    this.bossActive = true;
    this.trickleT = 3;
    const [x, y] = world.randomSpawnPos();
    const spec = BAL.wave.bossHp(this.wave);
    world.enemies.spawn('boss', x, y, spec / 520, BAL.wave.dmgMul(this.wave));
  }
}

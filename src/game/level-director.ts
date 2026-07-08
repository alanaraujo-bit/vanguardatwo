import type { AudioEngine } from '../audio/audio';
import type { UI } from '../ui/ui';
import type { EnemyKind } from './enemies';
import type { LevelDef } from './campaign';
import { SECTORS, type PoolEntry, type SectorDef } from './sectors';
import type { Director } from './waves';
import type { World } from './world';

interface LevelDirectorDeps {
  ui: UI;
  audio: AudioEngine;
}

type BossInfo = SectorDef['boss'];

const BOSS_WARN_SECONDS = 1.7;
const BASE_SPAWN_INTERVAL = 1.3;
const BASE_MAX_ALIVE = 14;

/**
 * Scripted director for one campaign level: spawns from a curated pool
 * (never BAL.wave's continuous formulas) and clears once the level's own
 * objective — survive/killTarget/boss/bossRush — is met. Modeled directly on
 * TutorialDirector's step machine (src/game/tutorial.ts).
 */
export class LevelDirector implements Director {
  wave: number;
  cleared = false;

  private t = 0;
  private spawnT = 1;
  private kills = 0;
  private bossIdx = 0;
  private bossPending = false;
  private bossWarned = false;
  private bossWarnT = 0;
  private bossActive = false;
  private trickleT = 0;

  private readonly pool: readonly PoolEntry[];
  private readonly poolWeight: number;

  constructor(private readonly level: LevelDef, index: number, private readonly deps: LevelDirectorDeps) {
    this.wave = index + 1;
    const pool = level.composition ?? level.sector.composition;
    this.pool = level.modifier?.eliteOnly ? pool.slice(-2) : pool;
    this.poolWeight = this.pool.reduce((sum, c) => sum + c.weight, 0);

    if (this.bossKinds().length > 0) {
      this.bossPending = true;
      this.bossWarnT = BOSS_WARN_SECONDS;
    }
  }

  /** The boss currently up (or about to warn/spawn), for GameScene's HUD/defeat banner. */
  bossInfo(): BossInfo | null {
    const kind = this.bossKinds()[this.bossIdx];
    return kind ? this.bossDefFor(kind) : null;
  }

  /** Forwarded by GameScene.onEnemyKilled, mirrors TutorialDirector.noteKill. */
  noteKill(): void {
    this.kills++;
  }

  update(dt: number, world: World): void {
    if (this.cleared) return;
    this.t += dt;

    if (this.bossPending) {
      if (!this.bossWarned) {
        this.bossWarned = true;
        this.announceBoss();
      }
      this.bossWarnT -= dt;
      if (this.bossWarnT <= 0) this.spawnCurrentBoss(world);
      return;
    }

    if (this.bossActive) {
      if (world.enemies.boss === null) {
        this.bossActive = false;
        this.bossIdx++;
        if (this.bossIdx >= this.bossKinds().length) {
          this.cleared = true;
        } else {
          this.bossPending = true;
          this.bossWarned = false;
          this.bossWarnT = BOSS_WARN_SECONDS;
        }
      } else {
        // Light trickle keeps gem income alive during the fight, same as WaveDirector.
        this.trickleT -= dt;
        if (this.trickleT <= 0 && world.enemies.list.length < 10) {
          this.trickleT = 2.6;
          this.spawnOne(world);
        }
      }
      return;
    }

    this.spawnLoop(dt, world);
    const obj = this.level.objective;
    if (obj.type === 'survive' && this.t >= obj.seconds) this.cleared = true;
    else if (obj.type === 'killTarget' && this.kills >= obj.count) this.cleared = true;
  }

  private bossKinds(): readonly EnemyKind[] {
    const obj = this.level.objective;
    if (obj.type === 'boss') return [obj.kind];
    if (obj.type === 'bossRush') return obj.kinds;
    return [];
  }

  /** Looks up a boss's own sector text so a bossRush shows each boss's real name/lines. */
  private bossDefFor(kind: EnemyKind): BossInfo {
    return SECTORS.find((s) => s.boss.kind === kind)?.boss ?? this.level.sector.boss;
  }

  private announceBoss(): void {
    const boss = this.bossDefFor(this.bossKinds()[this.bossIdx]);
    this.deps.ui.banner(boss.name.toUpperCase(), boss.warnSub, true);
    this.deps.audio.play('warn');
  }

  private spawnCurrentBoss(world: World): void {
    this.bossPending = false;
    this.bossActive = true;
    this.trickleT = 3;
    const [x, y] = world.randomSpawnPos();
    world.enemies.spawn(this.bossKinds()[this.bossIdx], x, y, this.level.hpMul, this.level.dmgMul);
  }

  private spawnLoop(dt: number, world: World): void {
    const maxAlive = Math.round(BASE_MAX_ALIVE * (this.level.modifier?.denseSwarm ?? 1));
    const interval = BASE_SPAWN_INTERVAL / (this.level.modifier?.relentless ?? 1);
    this.spawnT -= dt;
    if (this.spawnT <= 0 && world.enemies.list.length < maxAlive) {
      this.spawnT = interval;
      this.spawnOne(world);
    }
  }

  private spawnOne(world: World): void {
    const [x, y] = world.randomSpawnPos();
    world.enemies.spawn(this.rollKind(), x, y, this.level.hpMul, this.level.dmgMul);
  }

  private rollKind(): EnemyKind {
    let r = Math.random() * this.poolWeight;
    for (const c of this.pool) {
      r -= c.weight;
      if (r <= 0) return c.kind;
    }
    return this.pool[0].kind;
  }
}

import type { SfxName } from '../audio/audio';
import type { BurstOptions } from '../fx/particles';
import type { FloaterOptions } from '../fx/floaters';
import type { Sprite } from '../fx/sprites';
import type { Player } from './player';
import type { Enemies, Enemy } from './enemies';
import type { PlayerShots, EnemyShots } from './projectiles';
import type { Pickups } from './pickups';

/**
 * Presentation sinks: the slice of Particles/Floaters/AudioEngine that the
 * simulation may touch. Purely cosmetic — a headless world (the co-op game
 * server) plugs in no-op implementations and the sim never notices.
 */
export interface ParticleSink {
  spawn(
    sprite: Sprite,
    x: number, y: number,
    vx: number, vy: number,
    life: number, size0: number, size1: number, drag?: number,
  ): void;
  burst(sprite: Sprite, x: number, y: number, o?: BurstOptions): void;
  ring(x: number, y: number, color: string, radius0?: number, speed?: number, life?: number, width?: number): void;
}

export interface FloaterSink {
  spawn(x: number, y: number, text: string, o?: FloaterOptions): void;
}

export interface AudioSink {
  play(name: SfxName, pitch?: number): void;
}

/**
 * The run's shared context. Every gameplay system receives this instead of
 * importing concrete siblings, which keeps the dependency graph a star
 * (the scene at the center) instead of a web.
 */
export interface World {
  time: number;
  runTime: number;
  /** Every pilot in the run, indexed by slot. Solo play has exactly one. */
  players: Player[];
  enemies: Enemies;
  playerShots: PlayerShots;
  enemyShots: EnemyShots;
  pickups: Pickups;
  particles: ParticleSink;
  floaters: FloaterSink;
  audio: AudioSink;

  /** Nearest living player, or null once the whole squad is down. */
  nearestPlayer(x: number, y: number): Player | null;
  /** A random point just outside the visible screen, in world coordinates. */
  randomSpawnPos(): [number, number];
  shake(amount: number): void;
  hitStop(seconds: number, scale?: number): void;
  onEnemyKilled(e: Enemy, killer: Player | null): void;
  onBossDefeated(e: Enemy): void;
  onGemCollected(value: number, collector: Player): void;
  onCoinCollected(value: number, collector: Player): void;
  onPlayerDeath(p: Player): void;
}

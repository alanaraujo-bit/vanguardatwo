import { isVisible } from '../core/culling';
import { Pool, swapRemove } from '../core/pool';
import { chance, clamp, damp, dist2, len, rand, randInt, TAU } from '../core/utils';
import {
  drawSprite, glowDot, shapeSprite,
  ARCHIVIST_POINTS, DART_POINTS, GLYPH_POINTS, MINE_POINTS, NEEDLE_POINTS, QUEEN_POINTS, STINGER_POINTS,
  SHARD_POINTS, FLAKE_POINTS, GEYSER_POINTS, GLACIER_POINTS, ZERO_POINTS,
  FUME_POINTS, MIASMA_POINTS,
  type ShapePoints, type Sprite,
} from '../fx/sprites';
import { BAL } from './balance';
import type { Player } from './player';
import type { World } from './world';

export type EnemyKind =
  | 'drone' | 'dart' | 'splitter' | 'mini' | 'wasp' | 'tank' | 'boss'
  | 'larva' | 'spore' | 'stinger' | 'weaver' | 'beetle' | 'queen'
  | 'glyph' | 'needle' | 'pylon' | 'mine' | 'monolith' | 'archivist'
  | 'crystal' | 'shard' | 'flake' | 'geyser' | 'glacier' | 'zero'
  | 'blight' | 'vile' | 'ooze' | 'mite' | 'fume' | 'crawler' | 'miasma';

/** Boss-class units: fill the boss HP bar, gate wave progression, drop boss loot. */
export function isBossKind(kind: EnemyKind): boolean {
  return kind === 'boss' || kind === 'queen' || kind === 'archivist' || kind === 'zero' || kind === 'miasma';
}

export interface Spec {
  hp: number;
  speed: number;
  dmg: number;
  radius: number;
  xp: number;
  score: number;
  color: string;
}

/** Base per-kind stats, scaled at spawn time by the wave's hp/dmg multipliers. */
export const SPECS: Record<EnemyKind, Spec> = {
  drone:    { hp: 18,  speed: 64,  dmg: 8,  radius: 12, xp: 1, score: 10,  color: '#ff4d6d' },
  dart:     { hp: 9,   speed: 132, dmg: 6,  radius: 9,  xp: 1, score: 15,  color: '#ff9f43' },
  splitter: { hp: 36,  speed: 46,  dmg: 10, radius: 15, xp: 2, score: 25,  color: '#c56cf0' },
  mini:     { hp: 8,   speed: 100, dmg: 5,  radius: 8,  xp: 1, score: 8,   color: '#c56cf0' },
  wasp:     { hp: 26,  speed: 74,  dmg: 8,  radius: 11, xp: 2, score: 30,  color: '#f368e0' },
  tank:     { hp: 115, speed: 30,  dmg: 18, radius: 22, xp: 4, score: 50,  color: '#ff3838' },
  boss:     { hp: 520, speed: 58,  dmg: 24, radius: 42, xp: 25, score: 500, color: '#ff2e63' },
  // — Setor 2: A Colmeia —
  larva:    { hp: 12,  speed: 112, dmg: 6,  radius: 8,  xp: 1, score: 12,  color: '#c8ff4d' },
  spore:    { hp: 24,  speed: 40,  dmg: 9,  radius: 13, xp: 2, score: 22,  color: '#7dff62' },
  stinger:  { hp: 17,  speed: 96,  dmg: 10, radius: 10, xp: 2, score: 28,  color: '#ffb02e' },
  weaver:   { hp: 32,  speed: 72,  dmg: 8,  radius: 12, xp: 2, score: 34,  color: '#3dffc4' },
  beetle:   { hp: 135, speed: 27,  dmg: 20, radius: 23, xp: 5, score: 60,  color: '#ff6b35' },
  queen:    { hp: 640, speed: 52,  dmg: 26, radius: 46, xp: 30, score: 750, color: '#e84dff' },
  // — Setor 3: O Arquivo Magnético —
  glyph:     { hp: 16,  speed: 94,  dmg: 7,  radius: 10, xp: 1, score: 16,  color: '#5ee7ff' },
  needle:    { hp: 22,  speed: 84,  dmg: 9,  radius: 11, xp: 2, score: 32,  color: '#ffd166' },
  pylon:     { hp: 44,  speed: 34,  dmg: 11, radius: 15, xp: 3, score: 42,  color: '#8affc1' },
  mine:      { hp: 26,  speed: 50,  dmg: 13, radius: 13, xp: 2, score: 36,  color: '#ff4fb8' },
  monolith:  { hp: 155, speed: 24,  dmg: 23, radius: 24, xp: 5, score: 70,  color: '#a991ff' },  archivist: { hp: 700, speed: 46, dmg: 28, radius: 48, xp: 34, score: 900, color: '#35f0ff' },
  // — Setor 4: Estação Gélida —
  crystal:  { hp: 20,  speed: 70,  dmg: 8,  radius: 12, xp: 1, score: 14,  color: '#a8e8ff' },
  shard:    { hp: 11,  speed: 140, dmg: 7,  radius: 9,  xp: 2, score: 26,  color: '#5ee7ff' },
  flake:    { hp: 28,  speed: 42,  dmg: 9,  radius: 14, xp: 2, score: 30,  color: '#e0f7ff' },
  geyser:   { hp: 38,  speed: 18,  dmg: 12, radius: 16, xp: 3, score: 40,  color: '#6dd5ff' },
  glacier:  { hp: 140, speed: 26,  dmg: 22, radius: 24, xp: 5, score: 65,  color: '#4fc3f7' },
  zero:     { hp: 760, speed: 50,  dmg: 30, radius: 50, xp: 36, score: 1000, color: '#b3e5fc' },
  // — Setor 5: Zona Tóxica —
  blight:   { hp: 15,  speed: 108, dmg: 6,  radius: 9,  xp: 1, score: 14,  color: '#9eff4d' },
  vile:     { hp: 24,  speed: 45,  dmg: 9,  radius: 12, xp: 2, score: 22,  color: '#d4ff22' },
  ooze:     { hp: 38,  speed: 38,  dmg: 10, radius: 15, xp: 2, score: 26,  color: '#7dff62' },
  mite:     { hp: 9,   speed: 100, dmg: 6,  radius: 8,  xp: 1, score: 10,  color: '#7dff62' },
  fume:     { hp: 26,  speed: 34,  dmg: 7,  radius: 12, xp: 2, score: 30,  color: '#b8ff50' },
  crawler:  { hp: 135, speed: 24,  dmg: 22, radius: 23, xp: 5, score: 55,  color: '#ff6b35' },
  miasma:   { hp: 700, speed: 45,  dmg: 28, radius: 48, xp: 34, score: 900, color: '#4dff4d' },
};

interface ShapeOpts { sides?: number; points?: ShapePoints; rotate?: number; innerDetail?: boolean; }

/** Outline geometry per kind, shared with the Codex so its icons match the arena exactly. */
export const ENEMY_SHAPE_OPTS: Record<EnemyKind, ShapeOpts> = {
  drone: { sides: 3 },
  dart: { points: DART_POINTS },
  splitter: { sides: 4, rotate: Math.PI / 4, innerDetail: true },
  mini: { sides: 3 },
  wasp: { sides: 4 },
  tank: { sides: 6, innerDetail: true },
  boss: { sides: 8, innerDetail: true },
  larva: { sides: 3 },
  spore: { sides: 9, innerDetail: true },
  stinger: { points: STINGER_POINTS },
  weaver: { sides: 5, innerDetail: true },
  beetle: { sides: 7, rotate: Math.PI / 7, innerDetail: true },
  queen: { points: QUEEN_POINTS, innerDetail: true },
  glyph: { points: GLYPH_POINTS },
  needle: { points: NEEDLE_POINTS },
  pylon: { sides: 4, innerDetail: true },
  mine: { points: MINE_POINTS, innerDetail: true },
  monolith: { sides: 6, rotate: Math.PI / 6, innerDetail: true },
  archivist: { points: ARCHIVIST_POINTS, innerDetail: true },
  crystal:  { sides: 6, innerDetail: true },
  shard:    { points: SHARD_POINTS },
  flake:    { points: FLAKE_POINTS, innerDetail: true },
  geyser:   { points: GEYSER_POINTS, innerDetail: true },
  glacier:  { points: GLACIER_POINTS, innerDetail: true },
  zero:     { points: ZERO_POINTS, innerDetail: true },
  // — Setor 5: Zona Tóxica —
  blight:   { sides: 5, innerDetail: true },
  vile:     { sides: 8, innerDetail: true },
  ooze:     { sides: 7, innerDetail: true },
  mite:     { sides: 5 },
  fume:     { points: FUME_POINTS, innerDetail: true },
  crawler:  { sides: 6, innerDetail: true },
  miasma:   { points: MIASMA_POINTS, innerDetail: true },
};

// Colosso phases
const P_CHASE = 0;
const P_VOLLEY = 1;
const P_TELEGRAPH = 2;
const P_DASH = 3;

// Rainha phases (deliberately no overlap with the Colosso's kit)
const Q_CHASE = 0;
const Q_SPIRAL = 1;
const Q_RING = 2;
const Q_SUMMON = 3;

// Stinger lunge sub-states (stored in `phase`)
const ST_SEEK = 0;
const ST_WINDUP = 1;
const ST_LUNGE = 2;

// Arquivista phases: orbital control, lattice fire, focused stream, mine indexing.
const A_ORBIT = 0;
const A_LATTICE = 1;
const A_BEAM = 2;
const A_INDEX = 3;

// Estilhaço phases: approach, wind-up flash, and the dash itself.
const SH_SEEK = 0;
const SH_WINDUP = 1;
const SH_DASH = 2;

// Zero Absoluto phases: orbit + fire, ice geysers, freezing beam.
const Z_CHASE = 0;
const Z_GEYSER = 1;
const Z_BEAM = 2;

// Miasma phases: orbit + acid globs, root + gas vent.
const M_ORBIT = 0;
const M_VENT = 1;

export class Enemy {
  /** Network identity for snapshot interpolation; inert in solo play. */
  id = 0;
  kind: EnemyKind = 'drone';
  x = 0; y = 0;
  vx = 0; vy = 0;
  /** Knockback velocity, decays independently of steering. */
  kvx = 0; kvy = 0;
  hp = 1; maxHp = 1;
  radius = 10;
  dmg = 5;
  speed = 50;
  xp = 1;
  score = 10;
  rot = 0;
  t = 0;
  flash = 0;
  bladeCd = 0;
  fireT = 0;
  seed = 0;
  phase = P_CHASE;
  phaseT = 0;
  volleys = 0;
  dead = false;
}

/**
 * Uniform grid with wrap-around hashing and lazily-cleared stamped buckets:
 * zero per-frame allocation. False positives from wrapping are filtered by
 * the exact distance checks all callers already do.
 */
class SpatialHash {
  private readonly cell = 72;
  private readonly buckets: Enemy[][] = [];
  private readonly stamps = new Int32Array(4096);
  private frame = 0;

  constructor() {
    for (let i = 0; i < 4096; i++) this.buckets.push([]);
  }

  begin(): void {
    this.frame++;
  }

  insert(e: Enemy): void {
    const i = this.index(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
    if (this.stamps[i] !== this.frame) {
      this.stamps[i] = this.frame;
      this.buckets[i].length = 0;
    }
    this.buckets[i].push(e);
  }

  query(x: number, y: number, r: number, cb: (e: Enemy) => void): void {
    const pad = r + 48; // max enemy radius, since entities are inserted by center
    const x0 = Math.floor((x - pad) / this.cell);
    const x1 = Math.floor((x + pad) / this.cell);
    const y0 = Math.floor((y - pad) / this.cell);
    const y1 = Math.floor((y + pad) / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = this.index(cx, cy);
        if (this.stamps[i] !== this.frame) continue;
        const bucket = this.buckets[i];
        for (let k = 0; k < bucket.length; k++) cb(bucket[k]);
      }
    }
  }

  private index(cx: number, cy: number): number {
    return ((cx & 63) << 6) | (cy & 63);
  }
}

interface AoeEvent { x: number; y: number; r: number; dmg: number; owner: Player | null; }
interface SpawnEvent { kind: EnemyKind; x: number; y: number; hpMul: number; dmgMul: number; }

export class Enemies {
  readonly list: Enemy[] = [];
  readonly hash = new SpatialHash();
  boss: Enemy | null = null;

  private readonly pool = new Pool<Enemy>(() => new Enemy());
  // Sprites bake lazily on first render so this class can run headless.
  private readonly sprites = new Map<EnemyKind, Sprite>();
  private readonly flashes = new Map<EnemyKind, Sprite>();
  private readonly debris = new Map<EnemyKind, Sprite>();
  private readonly pendingAoe: AoeEvent[] = [];
  private readonly pendingSpawn: SpawnEvent[] = [];

  private ensureSprites(): void {
    if (this.sprites.size > 0) return;
    (Object.keys(ENEMY_SHAPE_OPTS) as EnemyKind[]).forEach((kind) => {
      const [normal, flash] = this.bake(kind, ENEMY_SHAPE_OPTS[kind]);
      this.sprites.set(kind, normal);
      this.flashes.set(kind, flash);
      this.debris.set(kind, glowDot(5, SPECS[kind].color));
    });
  }

  private bake(kind: EnemyKind, opts: ShapeOpts): [Sprite, Sprite] {
    const spec = SPECS[kind];
    const base = { radius: spec.radius * 1.25, ...opts };
    return [
      shapeSprite({ ...base, color: spec.color }),
      shapeSprite({ ...base, color: '#ffffff', fillAlpha: 0.6 }),
    ];
  }

  private nextId = 1;

  spawn(kind: EnemyKind, x: number, y: number, hpMul: number, dmgMul: number): Enemy {
    const spec = SPECS[kind];
    const e = this.pool.obtain();
    e.id = this.nextId++;
    e.kind = kind;
    e.x = x; e.y = y;
    e.vx = 0; e.vy = 0;
    e.kvx = 0; e.kvy = 0;
    e.maxHp = e.hp = spec.hp * hpMul;
    e.radius = spec.radius;
    e.dmg = spec.dmg * dmgMul;
    e.speed = spec.speed * rand(0.9, 1.1);
    e.xp = spec.xp;
    e.score = spec.score;
    e.rot = rand(0, TAU);
    e.t = 0;
    e.flash = 0;
    e.bladeCd = 0;
    e.fireT = rand(1, 2.5);
    e.seed = rand(0, TAU);
    e.phase = P_CHASE;
    e.phaseT = 0;
    e.volleys = 0;
    e.dead = false;
    this.list.push(e);
    if (isBossKind(kind)) this.boss = e;
    return e;
  }

  nearest(x: number, y: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.list) {
      if (e.dead) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  update(dt: number, world: World): void {
    // Rebuild the spatial index (also consumed by shots/blades this frame).
    this.hash.begin();
    for (const e of this.list) {
      if (!e.dead) this.hash.insert(e);
    }

    for (const e of this.list) {
      if (e.dead) continue;
      e.t += dt;
      e.flash -= dt;
      e.bladeCd -= dt;
      this.steer(e, dt, world);

      // Knockback decays fast; movement adds steering + knockback.
      const kd = 1 - Math.min(1, 7 * dt);
      e.kvx *= kd;
      e.kvy *= kd;
      e.x += (e.vx + e.kvx) * dt;
      e.y += (e.vy + e.kvy) * dt;

      // Soft separation against neighbors.
      this.hash.query(e.x, e.y, e.radius, (other) => {
        if (other === e || other.dead) return;
        const min = e.radius + other.radius;
        const d2 = dist2(e.x, e.y, other.x, other.y);
        if (d2 >= min * min || d2 === 0) return;
        const d = Math.sqrt(d2);
        const push = ((min - d) / min) * 34 * dt;
        e.x += ((e.x - other.x) / d) * push;
        e.y += ((e.y - other.y) / d) * push;
      });

      // Contact damage, against every living player.
      for (const player of world.players) {
        if (player.dead || player.iframes > 0) continue;
        const r = e.radius + player.radius;
        if (dist2(e.x, e.y, player.x, player.y) < r * r) {
          player.takeDamage(e.dmg, world);
          const a = Math.atan2(e.y - player.y, e.x - player.x);
          e.kvx += Math.cos(a) * 160;
          e.kvy += Math.sin(a) * 160;
        }
      }
    }

    // Sweep the dead.
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].dead) {
        this.pool.free(swapRemove(this.list, i));
      }
    }

    // Deferred fragmentation chains and splitter births.
    let guard = 0;
    while (this.pendingAoe.length > 0 && guard++ < 60) {
      const aoe = this.pendingAoe.shift()!;
      const r2 = aoe.r * aoe.r;
      // Blast radius grows with Fragmentação's level, so the ring must too —
      // otherwise the upgrade has no visible tell beyond the first pick.
      world.particles.ring(aoe.x, aoe.y, '#ff9f43', 8, aoe.r * 2.6, 0.4, 4);
      world.audio.play('burst', 0.8);
      for (const e of this.list) {
        if (e.dead) continue;
        if (dist2(aoe.x, aoe.y, e.x, e.y) > r2) continue;
        const a = Math.atan2(e.y - aoe.y, e.x - aoe.x);
        this.damage(e, aoe.dmg, false, Math.cos(a) * 180, Math.sin(a) * 180, world, aoe.owner);
      }
    }
    this.pendingAoe.length = 0;
    for (const s of this.pendingSpawn) {
      const e = this.spawn(s.kind, s.x, s.y, s.hpMul, s.dmgMul);
      e.kvx = rand(-140, 140);
      e.kvy = rand(-140, 140);
    }
    this.pendingSpawn.length = 0;
  }

  private steer(e: Enemy, dt: number, world: World): void {
    // Each enemy hunts whichever living player is closest; when the whole
    // squad is down there is nothing left to chase.
    const p = world.nearestPlayer(e.x, e.y);
    if (!p) return;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    const k = damp(4, dt);

    switch (e.kind) {
      case 'drone':
      case 'mini':
      case 'larva':
      case 'glyph': {
        const slip = Math.sin(e.t * 4.8 + e.seed) * (e.kind === 'glyph' ? 58 : 0);
        e.vx += (nx * e.speed - e.vx) * k;
        e.vy += (ny * e.speed - e.vy) * k;
        if (e.kind === 'glyph') {
          e.vx += (-ny * slip - e.vx) * damp(2.4, dt);
          e.vy += (nx * slip - e.vy) * damp(2.4, dt);
        }
        e.rot = Math.atan2(e.vy, e.vx) + Math.PI / 2;
        break;
      }
      case 'dart': {
        const weave = Math.sin(e.t * 5 + e.seed) * 70;
        e.vx += ((nx * e.speed - ny * weave) - e.vx) * damp(6, dt);
        e.vy += ((ny * e.speed + nx * weave) - e.vy) * damp(6, dt);
        e.rot = Math.atan2(e.vy, e.vx);
        break;
      }
      case 'splitter':
        e.vx += (nx * e.speed - e.vx) * k;
        e.vy += (ny * e.speed - e.vy) * k;
        e.rot += dt * 2.4;
        break;
      case 'tank':
        e.vx += (nx * e.speed - e.vx) * damp(2, dt);
        e.vy += (ny * e.speed - e.vy) * damp(2, dt);
        e.rot += dt * 0.5;
        break;
      case 'wasp': {
        const strafe = Math.sin(e.seed) >= 0 ? 1 : -1;
        let tx = 0;
        let ty = 0;
        if (d > 210) {
          tx = nx * e.speed;
          ty = ny * e.speed;
        } else if (d < 145) {
          tx = -nx * e.speed;
          ty = -ny * e.speed;
        }
        tx += -ny * strafe * 46;
        ty += nx * strafe * 46;
        e.vx += (tx - e.vx) * damp(5, dt);
        e.vy += (ty - e.vy) * damp(5, dt);
        e.rot = Math.atan2(dy, dx) + Math.PI / 2;
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 320) {
          e.fireT = rand(2.1, 2.9);
          world.enemyShots.spawn(e.x, e.y, Math.atan2(dy, dx), 165, e.dmg * 0.85);
          world.audio.play('shotE');
        }
        break;
      }
      case 'spore': {
        // Slow drifting pod, bobbing sideways — the threat is its death burst.
        const bob = Math.sin(e.t * 2.2 + e.seed) * 26;
        e.vx += ((nx * e.speed - ny * bob) - e.vx) * damp(2.2, dt);
        e.vy += ((ny * e.speed + nx * bob) - e.vy) * damp(2.2, dt);
        e.rot += dt * (0.8 + Math.sin(e.seed) * 0.4);
        break;
      }
      case 'stinger':
        // Approach, freeze for a telegraphed beat, then lunge like a hornet.
        switch (e.phase) {
          case ST_SEEK:
            e.vx += (nx * e.speed - e.vx) * damp(5, dt);
            e.vy += (ny * e.speed - e.vy) * damp(5, dt);
            e.rot = Math.atan2(dy, dx);
            e.fireT -= dt;
            if (e.fireT <= 0 && d < 300) {
              e.phase = ST_WINDUP;
              e.phaseT = 0;
            }
            break;
          case ST_WINDUP:
            e.vx *= 1 - Math.min(1, 8 * dt);
            e.vy *= 1 - Math.min(1, 8 * dt);
            e.rot = Math.atan2(dy, dx);
            e.flash = 0.05; // warning shimmer
            if (e.phaseT > 0.42) {
              e.phase = ST_LUNGE;
              e.phaseT = 0;
              e.vx = nx * 520;
              e.vy = ny * 520;
              world.audio.play('lunge');
            }
            break;
          case ST_LUNGE:
            if (e.phaseT > 0.34) {
              e.phase = ST_SEEK;
              e.fireT = rand(2.3, 3.3);
            }
            break;
        }
        e.phaseT += dt;
        break;
      case 'weaver': {
        // Orbits at mid range weaving a slow circle, spitting 3-shot fans.
        const spin = Math.sin(e.seed) >= 0 ? 1 : -1;
        let tx = -ny * spin * e.speed;
        let ty = nx * spin * e.speed;
        if (d > 250) {
          tx += nx * e.speed * 0.9;
          ty += ny * e.speed * 0.9;
        } else if (d < 170) {
          tx -= nx * e.speed * 0.9;
          ty -= ny * e.speed * 0.9;
        }
        e.vx += (tx - e.vx) * damp(4, dt);
        e.vy += (ty - e.vy) * damp(4, dt);
        e.rot += dt * 1.6 * spin;
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 360) {
          e.fireT = rand(2.6, 3.4);
          const aim = Math.atan2(dy, dx);
          for (let i = -1; i <= 1; i++) {
            world.enemyShots.spawn(e.x, e.y, aim + i * 0.26, 175, e.dmg * 0.7);
          }
          world.audio.play('spit');
        }
        break;
      }
      case 'beetle':
      case 'monolith':
        e.vx += (nx * e.speed - e.vx) * damp(1.8, dt);
        e.vy += (ny * e.speed - e.vy) * damp(1.8, dt);
        e.rot -= dt * 0.4;
        if (e.kind === 'monolith') {
          e.fireT -= dt;
          if (e.fireT <= 0 && d < 260) {
            e.fireT = rand(2.7, 3.5);
            for (const player of world.players) {
              if (player.dead) continue;
              const px = e.x - player.x;
              const py = e.y - player.y;
              const pd = len(px, py) || 1;
              if (pd < 280) {
                player.vx += (px / pd) * 90;
                player.vy += (py / pd) * 90;
              }
            }
            world.particles.ring(e.x, e.y, SPECS.monolith.color, 14, 280, 0.35, 3);
            world.audio.play('lattice');
          }
        }
        break;
      case 'needle': {
        let tx = 0;
        let ty = 0;
        if (d > 300) {
          tx = nx * e.speed;
          ty = ny * e.speed;
        } else if (d < 210) {
          tx = -nx * e.speed;
          ty = -ny * e.speed;
        }
        const side = Math.sin(e.seed) >= 0 ? 1 : -1;
        tx += -ny * side * 60;
        ty += nx * side * 60;
        e.vx += (tx - e.vx) * damp(4.4, dt);
        e.vy += (ty - e.vy) * damp(4.4, dt);
        e.rot = Math.atan2(dy, dx);
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 430) {
          e.fireT = rand(2.2, 3);
          world.enemyShots.spawn(e.x, e.y, Math.atan2(dy, dx), 240, e.dmg * 0.82);
          world.audio.play('zap');
        }
        break;
      }
      case 'pylon': {
        const orbit = Math.sin(e.t * 1.7 + e.seed) * 22;
        e.vx += ((nx * e.speed - ny * orbit) - e.vx) * damp(1.7, dt);
        e.vy += ((ny * e.speed + nx * orbit) - e.vy) * damp(1.7, dt);
        e.rot += dt * 0.9;
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 390) {
          e.fireT = rand(2.4, 3.2);
          const base = Math.atan2(dy, dx);
          for (let i = 0; i < 4; i++) {
            const a = base + (i / 4) * TAU;
            world.enemyShots.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 150, e.dmg * 0.62);
          }
          world.audio.play('lattice');
        }
        break;
      }
      case 'mine': {
        const bob = Math.sin(e.t * 3 + e.seed) * 34;
        e.vx += ((nx * e.speed * 0.75 - ny * bob) - e.vx) * damp(2, dt);
        e.vy += ((ny * e.speed * 0.75 + nx * bob) - e.vy) * damp(2, dt);
        e.rot += dt * 1.8;
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 95) {
          this.kill(e, world, null);
        }
        break;
      }
      case 'boss':
        this.steerBoss(e, dt, world, nx, ny, d);
        break;
      case 'queen':
        this.steerQueen(e, dt, world, nx, ny);
        break;
      case 'archivist':
        this.steerArchivist(e, dt, world, nx, ny, d);
        break;
      case 'crystal':
        this.steerCrystal(e, dt, world, nx, ny);
        break;
      case 'shard':
        this.steerShard(e, dt, world, nx, ny, d);
        break;
      case 'flake':
        this.steerFlake(e, dt, world, nx, ny, d);
        break;
      case 'geyser':
        this.steerGeyser(e, dt, world, nx, ny);
        break;
      case 'glacier':
        this.steerGlacier(e, dt, world, nx, ny, d);
        break;
      case 'zero':
        this.steerZero(e, dt, world, nx, ny, d);
        break;
      // — Setor 5: Zona Tóxica —
      case 'blight':
        this.steerBlight(e, dt, world, nx, ny);
        break;
      case 'vile':
        this.steerVile(e, dt, world, nx, ny, d);
        break;
      case 'ooze':
        e.vx += (nx * e.speed - e.vx) * damp(1.8, dt);
        e.vy += (ny * e.speed - e.vy) * damp(1.8, dt);
        e.rot += dt * 1.2;
        break;
      case 'mite':
        this.steerMite(e, dt, world, nx, ny);
        break;
      case 'fume':
        this.steerFume(e, dt, world, nx, ny, d);
        break;
      case 'crawler':
        this.steerCrawler(e, dt, world, nx, ny);
        break;
      case 'miasma':
        this.steerMiasma(e, dt, world, nx, ny, d);
        break;
    }
  }

  private steerBoss(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    e.rot += dt * 0.7;
    e.phaseT += dt;
    const enrage = e.hp < e.maxHp * 0.35 ? 0.72 : 1;

    switch (e.phase) {
      case P_CHASE:
        e.vx += (nx * e.speed - e.vx) * damp(2.5, dt);
        e.vy += (ny * e.speed - e.vy) * damp(2.5, dt);
        if (e.phaseT > 2.6 * enrage) {
          e.phase = P_VOLLEY;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      case P_VOLLEY: {
        e.vx *= 1 - Math.min(1, 4 * dt);
        e.vy *= 1 - Math.min(1, 4 * dt);
        const interval = 0.55 * enrage;
        if (e.phaseT > interval) {
          e.phaseT = 0;
          e.volleys++;
          const count = 10;
          const offset = e.rot;
          for (let i = 0; i < count; i++) {
            const a = offset + (i / count) * TAU;
            world.enemyShots.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 130, e.dmg * 0.6);
          }
          world.audio.play('shotE');
          if (e.volleys >= 3) {
            e.phase = P_TELEGRAPH;
            e.phaseT = 0;
          }
        }
        break;
      }
      case P_TELEGRAPH:
        e.vx *= 1 - Math.min(1, 6 * dt);
        e.vy *= 1 - Math.min(1, 6 * dt);
        e.flash = 0.05; // steady warning shimmer
        if (e.phaseT > 0.7 * enrage) {
          e.phase = P_DASH;
          e.phaseT = 0;
          e.vx = nx * 660;
          e.vy = ny * 660;
          world.audio.play('warn');
        }
        break;
      case P_DASH:
        if (e.phaseT > 0.5) {
          e.phase = P_CHASE;
          e.phaseT = 0;
        }
        break;
    }
  }

  /**
   * Hive Queen: never dashes. She cycles pursuit → rotating spiral streams →
   * expanding orb rings → summoning her brood, accelerating when enraged.
   */
  private steerQueen(e: Enemy, dt: number, world: World, nx: number, ny: number): void {
    e.rot += dt * 0.45;
    e.phaseT += dt;
    const enrage = e.hp < e.maxHp * 0.35 ? 0.72 : 1;

    switch (e.phase) {
      case Q_CHASE:
        e.vx += (nx * e.speed - e.vx) * damp(2.2, dt);
        e.vy += (ny * e.speed - e.vy) * damp(2.2, dt);
        if (e.phaseT > 3 * enrage) {
          e.phase = Q_SPIRAL;
          e.phaseT = 0;
          e.fireT = 0;
        }
        break;
      case Q_SPIRAL: {
        e.vx *= 1 - Math.min(1, 4 * dt);
        e.vy *= 1 - Math.min(1, 4 * dt);
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = 0.085;
          const arms = enrage < 1 ? 3 : 2;
          const base = e.seed + e.phaseT * 3.4;
          for (let i = 0; i < arms; i++) {
            const a = base + (i / arms) * TAU;
            world.enemyShots.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 120, e.dmg * 0.5);
          }
          world.audio.play('shotE');
        }
        if (e.phaseT > 2.4) {
          e.phase = Q_RING;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      }
      case Q_RING: {
        e.vx *= 1 - Math.min(1, 5 * dt);
        e.vy *= 1 - Math.min(1, 5 * dt);
        const due = e.volleys === 0 ? 0.4 : 1.1;
        if (e.volleys < 2 && e.phaseT > due) {
          e.volleys++;
          const count = 14;
          const offset = rand(0, TAU);
          for (let i = 0; i < count; i++) {
            const a = offset + (i / count) * TAU;
            world.enemyShots.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 95, e.dmg * 0.55);
          }
          world.audio.play('spit');
        }
        if (e.phaseT > 1.6 * enrage) {
          e.phase = Q_SUMMON;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      }
      case Q_SUMMON:
        e.vx *= 1 - Math.min(1, 5 * dt);
        e.vy *= 1 - Math.min(1, 5 * dt);
        if (e.volleys === 0 && e.phaseT > 0.5) {
          e.volleys = 1;
          const hpMul = e.maxHp / SPECS.queen.hp;
          const dmgMul = e.dmg / SPECS.queen.dmg;
          for (let i = 0; i < 3; i++) {
            const a = rand(0, TAU);
            this.pendingSpawn.push({ kind: 'larva', x: e.x + Math.cos(a) * e.radius, y: e.y + Math.sin(a) * e.radius, hpMul, dmgMul });
          }
          const sa = rand(0, TAU);
          this.pendingSpawn.push({ kind: 'spore', x: e.x + Math.cos(sa) * e.radius, y: e.y + Math.sin(sa) * e.radius, hpMul, dmgMul });
          world.particles.ring(e.x, e.y, SPECS.queen.color, 10, 320, 0.45, 4);
          world.audio.play('summon');
        }
        if (e.phaseT > 1.3 * enrage) {
          e.phase = Q_CHASE;
          e.phaseT = 0;
        }
        break;
    }
  }

  private steerCrystal(e: Enemy, dt: number, world: World, nx: number, ny: number): void {
    // Direct chase with periodic crystal blink — a short burst forward.
    e.vx += (nx * e.speed - e.vx) * damp(4, dt);
    e.vy += (ny * e.speed - e.vy) * damp(4, dt);
    e.rot += dt * 1.6;
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT = rand(1.8, 2.8);
      e.vx += nx * 160;
      e.vy += ny * 160;
      world.audio.play('crack');
    }
  }

  private steerShard(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    // Approach, flash windup, then a fast linear dash.
    switch (e.phase) {
      case SH_SEEK:
        e.vx += (nx * e.speed - e.vx) * damp(5, dt);
        e.vy += (ny * e.speed - e.vy) * damp(5, dt);
        e.rot = Math.atan2(ny, nx);
        e.fireT -= dt;
        if (e.fireT <= 0 && d < 320) {
          e.phase = SH_WINDUP;
          e.phaseT = 0;
        }
        break;
      case SH_WINDUP:
        e.vx *= 1 - Math.min(1, 8 * dt);
        e.vy *= 1 - Math.min(1, 8 * dt);
        e.rot = Math.atan2(ny, nx);
        e.flash = 0.05;
        if (e.phaseT > 0.4) {
          e.phase = SH_DASH;
          e.phaseT = 0;
          e.vx = nx * 560;
          e.vy = ny * 560;
          world.audio.play('crack');
        }
        break;
      case SH_DASH:
        if (e.phaseT > 0.3) {
          e.phase = SH_SEEK;
          e.fireT = rand(1.3, 2.1);
        }
        break;
    }
    e.phaseT += dt;
  }

  private steerFlake(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    // Slow drifting snowflake, rotates lazily, fires freezing orbs.
    const slip = Math.sin(e.t * 2.4 + e.seed) * 20;
    e.vx += ((nx * e.speed - ny * slip) - e.vx) * damp(2, dt);
    e.vy += ((ny * e.speed + nx * slip) - e.vy) * damp(2, dt);
    e.rot += dt * 1.2;
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 350) {
      e.fireT = rand(2.5, 3.5);
      const aim = Math.atan2(ny, nx);
      world.enemyShots.spawnIce(e.x, e.y, aim + rand(-0.15, 0.15), 170, e.dmg * 0.7, 0.8);
      world.audio.play('freeze');
    }
  }

  private steerGeyser(e: Enemy, dt: number, world: World, nx: number, ny: number): void {
    // Nearly stationary crystal spire that spawns ice patches.
    e.vx += (nx * e.speed - e.vx) * damp(1.2, dt);
    e.vy += (ny * e.speed - e.vy) * damp(1.2, dt);
    e.rot += dt * 0.5;
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT = rand(3, 4.5);
      world.enemyShots.spawnPatch(e.x + rand(-10, 10), e.y + rand(-10, 10), e.dmg * 0.75, 3);
      world.particles.ring(e.x, e.y, SPECS.geyser.color, 6, 30, 0.4, 3);
      world.audio.play('crack');
    }
  }

  private steerGlacier(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    // Heavy, slow ice block — emits freezing shockwaves.
    e.vx += (nx * e.speed - e.vx) * damp(1.6, dt);
    e.vy += (ny * e.speed - e.vy) * damp(1.6, dt);
    e.rot -= dt * 0.3;
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 300) {
      e.fireT = rand(3.5, 5);
      const count = 12;
      const offset = rand(0, TAU);
      for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * TAU;
        world.enemyShots.spawnIce(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 110, e.dmg * 0.4, 0.5);
      }
      world.particles.ring(e.x, e.y, SPECS.glacier.color, 14, 300, 0.5, 4);
      world.audio.play('shatter');
    }
  }

  private steerArchivist(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    e.rot -= dt * 0.36;
    e.phaseT += dt;
    const enrage = e.hp < e.maxHp * 0.35 ? 0.68 : 1;

    switch (e.phase) {
      case A_ORBIT: {
        const side = Math.sin(e.seed) >= 0 ? 1 : -1;
        let tx = -ny * side * e.speed;
        let ty = nx * side * e.speed;
        if (d > 260) {
          tx += nx * e.speed;
          ty += ny * e.speed;
        } else if (d < 180) {
          tx -= nx * e.speed;
          ty -= ny * e.speed;
        }
        e.vx += (tx - e.vx) * damp(2.4, dt);
        e.vy += (ty - e.vy) * damp(2.4, dt);
        if (e.phaseT > 3.1 * enrage) {
          e.phase = A_LATTICE;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      }
      case A_LATTICE: {
        e.vx *= 1 - Math.min(1, 4.5 * dt);
        e.vy *= 1 - Math.min(1, 4.5 * dt);
        if (e.phaseT > 0.42 * enrage) {
          e.phaseT = 0;
          e.volleys++;
          const count = e.hp < e.maxHp * 0.35 ? 6 : 5;
          const base = e.seed + e.volleys * 0.27;
          for (let i = 0; i < count; i++) {
            const a = base + (i / count) * TAU;
            world.enemyShots.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 150, e.dmg * 0.48);
          }
          world.audio.play('lattice');
          if (e.volleys >= 4) {
            e.phase = A_BEAM;
            e.phaseT = 0;
            e.fireT = 0.34;
          }
        }
        break;
      }
      case A_BEAM: {
        e.vx *= 1 - Math.min(1, 5 * dt);
        e.vy *= 1 - Math.min(1, 5 * dt);
        e.flash = 0.05;
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = 0.16 * enrage;
          const p = world.nearestPlayer(e.x, e.y);
          const a = p ? Math.atan2(p.y - e.y, p.x - e.x) : Math.atan2(ny, nx);
          for (let i = -1; i <= 1; i++) {
            world.enemyShots.spawn(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a + i * 0.08, 260, e.dmg * 0.38);
          }
          world.audio.play('zap');
        }
        if (e.phaseT > 1.25 * enrage) {
          e.phase = A_INDEX;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      }
      case A_INDEX:
        e.vx *= 1 - Math.min(1, 4 * dt);
        e.vy *= 1 - Math.min(1, 4 * dt);
        if (e.volleys === 0 && e.phaseT > 0.45) {
          e.volleys = 1;
          const hpMul = e.maxHp / SPECS.archivist.hp;
          const dmgMul = e.dmg / SPECS.archivist.dmg;
          const count = e.hp < e.maxHp * 0.35 ? 4 : 3;
          for (let i = 0; i < count; i++) {
            const a = e.seed + (i / count) * TAU + rand(-0.25, 0.25);
            this.pendingSpawn.push({ kind: 'mine', x: e.x + Math.cos(a) * (e.radius + 18), y: e.y + Math.sin(a) * (e.radius + 18), hpMul, dmgMul });
          }
          world.particles.ring(e.x, e.y, SPECS.archivist.color, 12, 330, 0.45, 4);
          world.audio.play('mine');
        }
        if (e.phaseT > 1.35 * enrage) {
          e.phase = A_ORBIT;
          e.phaseT = 0;
        }
        break;
    }
  }

  // ——— Setor 5: Zona Tóxica ———

  private steerBlight(e: Enemy, dt: number, world: World, nx: number, ny: number): void {
    // Erratic skitter: fast zigzag with sharp direction changes.
    const weaveAmp = 60 + Math.sin(e.t * 1.7 + e.seed) * 30;
    const weaveFreq = 6 + Math.sin(e.seed) * 2;
    const weave = Math.sin(e.t * weaveFreq + e.seed * 2) * weaveAmp;
    // Random jolts to feel insect-like.
    const joltX = Math.sin(e.t * 11 + e.seed * 3) > 0.85 ? Math.cos(e.seed) * 120 : 0;
    const joltY = Math.sin(e.t * 13 + e.seed * 5) > 0.85 ? Math.sin(e.seed) * 120 : 0;
    e.vx += ((nx * e.speed + joltX - ny * weave) - e.vx) * damp(7, dt);
    e.vy += ((ny * e.speed + joltY + nx * weave) - e.vy) * damp(7, dt);
    e.rot = Math.atan2(e.vy, e.vx);
  }

  private steerVile(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    // Slow, keeps distance. Fires acid orbs that create pools on landing.
    let tx = 0;
    let ty = 0;
    if (d > 260) {
      tx = nx * e.speed;
      ty = ny * e.speed;
    } else if (d < 180) {
      tx = -nx * e.speed;
      ty = -ny * e.speed;
    }
    e.vx += (tx - e.vx) * damp(2.2, dt);
    e.vy += (ty - e.vy) * damp(2.2, dt);
    e.rot += dt * 0.6;
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 350) {
      e.fireT = rand(2.5, 3.3);
      const aim = Math.atan2(ny, nx);
      // Acid orb — slower, visible arc, leaves a patch when it expires.
      world.enemyShots.spawnAcid(e.x, e.y, aim + rand(-0.12, 0.12), 130, e.dmg * 0.7, 2.5);
      world.audio.play('drip');
    }
  }

  private steerMite(e: Enemy, dt: number, world: World, nx: number, ny: number): void {
    // Fast mini ooze — similar to mini but with wobble.
    const wob = Math.sin(e.t * 4 + e.seed) * 30;
    e.vx += ((nx * e.speed - ny * wob) - e.vx) * damp(6, dt);
    e.vy += ((ny * e.speed + nx * wob) - e.vy) * damp(6, dt);
    e.rot += dt * 2.8;
  }

  private steerFume(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    // Slow drift with bobbing. Doesn't chase aggressively.
    // Periodically emits a gas pulse ring that damages nearby players.
    const bob = Math.sin(e.t * 1.8 + e.seed) * 16;
    let tx = -ny * Math.sin(e.seed) * e.speed * 0.4;
    let ty = nx * Math.sin(e.seed) * e.speed * 0.4;
    if (d > 350) {
      tx += nx * e.speed * 0.5;
      ty += ny * e.speed * 0.5;
    } else if (d < 150) {
      tx -= nx * e.speed * 0.5;
      ty -= ny * e.speed * 0.5;
    }
    e.vx += ((tx + -ny * bob) - e.vx) * damp(1.6, dt);
    e.vy += ((ty + nx * bob) - e.vy) * damp(1.6, dt);
    e.rot += dt * 0.7;

    // Passive toxic aura: damages any player within 60px.
    for (const p of world.players) {
      if (p.dead) continue;
      const pd = len(p.x - e.x, p.y - e.y);
      if (pd < 60) {
        p.takeDamage(e.dmg * 0.15 * dt, world);
      }
    }

    // Pulse attack: ring of gas.
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT = rand(3, 4.5);
      // Damage all players within radius.
      for (const p of world.players) {
        if (p.dead) continue;
        const pd = len(p.x - e.x, p.y - e.y);
        if (pd < 180) {
          p.takeDamage(e.dmg * 0.7, world);
        }
      }
      world.particles.ring(e.x, e.y, SPECS.fume.color, 14, 180, 0.5, 4);
      world.audio.play('hiss');
    }
  }

  private steerCrawler(e: Enemy, dt: number, world: World, nx: number, ny: number): void {
    // Very slow heavy. Leaves acid trail behind.
    e.vx += (nx * e.speed - e.vx) * damp(1.6, dt);
    e.vy += (ny * e.speed - e.vy) * damp(1.6, dt);
    e.rot -= dt * 0.3;
    e.fireT -= dt;
    // Leave acid trail every ~1.5s of movement.
    const moving = len(e.vx, e.vy) > 5;
    if (e.fireT <= 0 && moving) {
      e.fireT = rand(1.2, 1.8);
      world.enemyShots.spawnPatch(e.x + rand(-5, 5), e.y + rand(-5, 5), e.dmg * 0.3, 3);
    }
  }

  private steerMiasma(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    e.rot += dt * 0.25;
    e.phaseT += dt;
    const enrage = e.hp < e.maxHp * 0.35 ? 0.6 : 1;

    switch (e.phase) {
      // — Phase 1: Saturation — orbit + fire acid globs —
      case M_ORBIT: {
        const side = Math.sin(e.seed) >= 0 ? 1 : -1;
        let tx = -ny * side * e.speed * 0.85;
        let ty = nx * side * e.speed * 0.85;
        if (d > 300) {
          tx += nx * e.speed;
          ty += ny * e.speed;
        } else if (d < 200) {
          tx -= nx * e.speed;
          ty -= ny * e.speed;
        }
        e.vx += (tx - e.vx) * damp(2.2, dt);
        e.vy += (ty - e.vy) * damp(2.2, dt);
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = rand(0.8, 1.2) * enrage;
          const aim = Math.atan2(ny, nx);
          const count = enrage < 1 ? 6 : 4;
          for (let i = 0; i < count; i++) {
            const spread = (i - (count - 1) / 2) * 0.15;
            world.enemyShots.spawnAcid(e.x + Math.cos(aim) * e.radius, e.y + Math.sin(aim) * e.radius, aim + spread + rand(-0.05, 0.05), 140, e.dmg * 0.38, 2);
          }
          world.audio.play('drip');
        }
        if (e.phaseT > 3.5 * enrage) {
          e.phase = M_VENT;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      }
      // — Phase 2: Vácuo Tóxico — root + vent gas in rotating cones —
      case M_VENT: {
        e.vx *= 1 - Math.min(1, 5 * dt);
        e.vy *= 1 - Math.min(1, 5 * dt);
        e.flash = 0.05;
        if (e.phaseT > 0.5 * enrage && e.volleys < 4) {
          e.phaseT = 0;
          e.volleys++;
          const coneAngle = enrage < 1 ? Math.PI : Math.PI * 0.67; // 180° enraged, 120° normal
          const coneDir = e.seed + e.volleys * 1.57; // rotate ~90° each pulse
          const count = 6;
          for (let i = 0; i < count; i++) {
            const a = coneDir - coneAngle / 2 + (i / (count - 1)) * coneAngle;
            world.enemyShots.spawnAcid(e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, 150, e.dmg * 0.32, 1.8);
          }
          world.particles.ring(e.x, e.y, SPECS.miasma.color, 16, 220, 0.55, 5);
          world.audio.play('hiss');
        }
        if (e.volleys >= 4 && e.phaseT > 0.8 * enrage) {
          e.phase = M_ORBIT;
          e.phaseT = 0;
          e.fireT = 0;
        }
        break;
      }
    }
  }

  damage(e: Enemy, amount: number, crit: boolean, kx: number, ky: number, world: World, killer: Player | null = null): void {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.09;
    // Heavy units and bosses resist knockback.
    const resist = e.kind === 'tank' || e.kind === 'beetle' || e.kind === 'monolith' || e.kind === 'crawler' ? 0.35 : isBossKind(e.kind) ? 0.08 : 1;
    e.kvx += kx * resist;
    e.kvy += ky * resist;
    world.floaters.spawn(e.x, e.y - e.radius - 4, String(Math.round(amount)), {
      color: crit ? '#ffc857' : '#ffffff',
      size: crit ? 17 : 12,
      bold: crit,
    });
    world.audio.play('hit', crit ? 0.8 : 1.1);
    if (e.hp <= 0) this.kill(e, world, killer);
  }

  private steerZero(e: Enemy, dt: number, world: World, nx: number, ny: number, d: number): void {
    e.rot += dt * 0.3;
    e.phaseT += dt;
    const enrage = e.hp < e.maxHp * 0.35 ? 0.65 : 1;

    switch (e.phase) {
      case Z_CHASE: {
        // Orbit at mid-range, firing ice orbs.
        const side = Math.sin(e.seed) >= 0 ? 1 : -1;
        let tx = -ny * side * e.speed * 0.9;
        let ty = nx * side * e.speed * 0.9;
        if (d > 280) {
          tx += nx * e.speed;
          ty += ny * e.speed;
        } else if (d < 190) {
          tx -= nx * e.speed;
          ty -= ny * e.speed;
        }
        e.vx += (tx - e.vx) * damp(2.2, dt);
        e.vy += (ty - e.vy) * damp(2.2, dt);
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = rand(0.6, 1) * enrage;
          const aim = Math.atan2(ny, nx);
          world.enemyShots.spawnIce(e.x + Math.cos(aim) * e.radius, e.y + Math.sin(aim) * e.radius, aim + rand(-0.2, 0.2), 160, e.dmg * 0.45, 1);
          world.audio.play('freeze');
        }
        // Enrage: also summon shards.
        if (enrage < 1) {
          e.bladeCd -= dt;
          if (e.bladeCd <= 0) {
            e.bladeCd = 3.5;
            const hpMul = e.maxHp / SPECS.zero.hp;
            const dmgMul = e.dmg / SPECS.zero.dmg;
            for (let i = 0; i < 3; i++) {
              const a = rand(0, TAU);
              this.pendingSpawn.push({ kind: 'shard', x: e.x + Math.cos(a) * e.radius, y: e.y + Math.sin(a) * e.radius, hpMul, dmgMul });
            }
            world.particles.ring(e.x, e.y, SPECS.zero.color, 10, 280, 0.4, 4);
            world.audio.play('shatter');
          }
        }
        if (e.phaseT > 3.5 * enrage) {
          e.phase = Z_GEYSER;
          e.phaseT = 0;
          e.volleys = 0;
        }
        break;
      }
      case Z_GEYSER: {
        // Plant ice geysers around the arena.
        e.vx *= 1 - Math.min(1, 4 * dt);
        e.vy *= 1 - Math.min(1, 4 * dt);
        if (e.volleys < 4 && e.phaseT > 0.6 * enrage) {
          e.phaseT = 0;
          e.volleys++;
          const a = rand(0, TAU);
          const dist = rand(100, 220);
          const gx = e.x + Math.cos(a) * dist;
          const gy = e.y + Math.sin(a) * dist;
          world.enemyShots.spawnPatch(gx, gy, e.dmg * 0.5, 4);
          world.particles.ring(gx, gy, SPECS.geyser.color, 8, 40, 0.5, 3);
          world.audio.play('crack');
        }
        if (e.phaseT > 2.8 * enrage) {
          e.phase = Z_BEAM;
          e.phaseT = 0;
          e.fireT = 0;
        }
        break;
      }
      case Z_BEAM: {
        // Freezing beam: rapid narrow fan of ice orbs.
        e.vx *= 1 - Math.min(1, 5 * dt);
        e.vy *= 1 - Math.min(1, 5 * dt);
        e.flash = 0.05;
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = 0.18 * enrage;
          const p = world.nearestPlayer(e.x, e.y);
          const aim = p ? Math.atan2(p.y - e.y, p.x - e.x) : Math.atan2(ny, nx);
          for (let i = -2; i <= 2; i++) {
            world.enemyShots.spawnIce(e.x + Math.cos(aim) * e.radius, e.y + Math.sin(aim) * e.radius, aim + i * 0.1, 220, e.dmg * 0.28, 0.6);
          }
          world.audio.play('freeze');
        }
        if (e.phaseT > 1.4 * enrage) {
          e.phase = Z_CHASE;
          e.phaseT = 0;
          e.fireT = 0.5;
        }
        break;
      }
    }
  }

  private kill(e: Enemy, world: World, killer: Player | null): void {
    e.dead = true;
    const debris = this.debris.get(e.kind);
    const big = e.radius >= 18;
    if (debris) {
      world.particles.burst(debris, e.x, e.y, {
        count: big ? 18 : 9,
        speed: big ? 210 : 150,
        size: big ? 1.6 : 1.1,
        life: big ? 0.55 : 0.4,
      });
    }
    if (big) world.particles.ring(e.x, e.y, SPECS[e.kind].color, 10, 380, 0.4, 4);
    world.audio.play(big ? 'dieBig' : 'die');
    if (big) world.shake(8);

    // Loot
    const heavy = e.kind === 'tank' || e.kind === 'beetle' || e.kind === 'monolith' || e.kind === 'glacier' || e.kind === 'crawler';
    world.pickups.spawnGems(e.x, e.y, e.xp);
    if (isBossKind(e.kind)) {
      world.pickups.spawnCoins(e.x, e.y, randInt(BAL.drops.bossCoins[0], BAL.drops.bossCoins[1]));
      world.pickups.spawnHeart(e.x, e.y);
    } else {
      if (chance(BAL.drops.coinChance)) world.pickups.spawnCoins(e.x, e.y, heavy ? 3 : 1);
      if (heavy && chance(BAL.drops.heartChanceTank)) world.pickups.spawnHeart(e.x, e.y);
    }

    // Spores retaliate: a radial burst of slow orbs punishes point-blank kills.
    if (e.kind === 'spore') {
      const offset = rand(0, TAU);
      for (let i = 0; i < 6; i++) {
        const a = offset + (i / 6) * TAU;
        world.enemyShots.spawn(e.x, e.y, a, 140, e.dmg * 0.7);
      }
      world.audio.play('burst');
    }

    if (e.kind === 'mine') {
      const offset = rand(0, TAU);
      for (let i = 0; i < 8; i++) {
        const a = offset + (i / 8) * TAU;
        world.enemyShots.spawn(e.x, e.y, a, 185, e.dmg * 0.68);
      }
      world.audio.play('mine');
    }

    if (e.kind === 'blight') {
      // Leaves a small acid pool on death.
      world.enemyShots.spawnPatch(e.x, e.y, e.dmg * 0.4, 2.5);
      world.audio.play('drip');
    }

    if (e.kind === 'mite') {
      // Leaves a small acid pool on death.
      world.enemyShots.spawnPatch(e.x, e.y, e.dmg * 0.35, 2);
    }

    if (e.kind === 'vile') {
      // Erupts into 3 acid pools in a fan.
      for (let i = -1; i <= 1; i++) {
        const a = Math.atan2(e.vy, e.vx) + i * 0.4;
        world.enemyShots.spawnPatch(e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12, e.dmg * 0.45, 3.5);
      }
      world.particles.ring(e.x, e.y, SPECS.vile.color, 8, 60, 0.5, 3);
      world.audio.play('hiss');
    }

    if (e.kind === 'ooze') {
      // Divides into 2 Mites (mini oozes).
      this.pendingSpawn.push(
        { kind: 'mite', x: e.x - 10, y: e.y, hpMul: e.maxHp / SPECS.ooze.hp, dmgMul: e.dmg / SPECS.ooze.dmg },
        { kind: 'mite', x: e.x + 10, y: e.y, hpMul: e.maxHp / SPECS.ooze.hp, dmgMul: e.dmg / SPECS.ooze.dmg },
      );
    }

    if (e.kind === 'splitter') {
      this.pendingSpawn.push(
        { kind: 'mini', x: e.x - 10, y: e.y, hpMul: e.maxHp / SPECS.splitter.hp, dmgMul: e.dmg / SPECS.splitter.dmg },
        { kind: 'mini', x: e.x + 10, y: e.y, hpMul: e.maxHp / SPECS.splitter.hp, dmgMul: e.dmg / SPECS.splitter.dmg },
      );
    }

    if (e.kind === 'shard') {
      const offset = rand(0, TAU);
      for (let i = 0; i < 3; i++) {
        const a = offset + (i / 3) * TAU + rand(-0.2, 0.2);
        world.enemyShots.spawn(e.x, e.y, a, 200, e.dmg * 0.4);
      }
      world.audio.play('shatter');
    }

    if (e === this.boss) {
      this.boss = null;
      world.onBossDefeated(e);
    }
    world.onEnemyKilled(e, killer);
  }

  queueAoe(x: number, y: number, r: number, dmg: number, owner: Player | null = null): void {
    this.pendingAoe.push({ x, y, r, dmg, owner });
  }

  render(ctx: CanvasRenderingContext2D, time: number, camX: number, camY: number, vpW: number, vpH: number): void {
    this.ensureSprites();
    for (const e of this.list) {
      if (e.dead || !isVisible(e.x, e.y, camX, camY, vpW, vpH)) continue;
      const sprite = this.sprites.get(e.kind)!;
      const scale = isBossKind(e.kind) ? 1 + Math.sin(time * 4) * 0.04 : 1;
      drawSprite(ctx, sprite, e.x, e.y, e.rot, scale);
      if (e.flash > 0) {
        drawSprite(ctx, this.flashes.get(e.kind)!, e.x, e.y, e.rot, scale, clamp(e.flash / 0.09, 0, 1));
      }
    }
  }

  clear(): void {
    for (const e of this.list) this.pool.free(e);
    this.list.length = 0;
    this.boss = null;
    this.pendingAoe.length = 0;
    this.pendingSpawn.length = 0;
  }
}

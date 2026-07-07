import { Pool, swapRemove } from '../core/pool';
import { chance, dist2, len, rand, TAU } from '../core/utils';
import { drawSprite, glowDot, shapeSprite, GEM_POINTS, type ShapeOptions, type Sprite } from '../fx/sprites';
import type { World } from './world';

export type PickupKind = 'gem' | 'coin' | 'heart';

/** Shared with the Codex so its pickup icons match the arena exactly. */
export const GEM_SHAPE: ShapeOptions = { radius: 7, color: '#52ffa8', points: GEM_POINTS, fillAlpha: 0.4 };
export const COIN_SHAPE: ShapeOptions = { radius: 6.5, color: '#ffc857', sides: 6, fillAlpha: 0.5, rotate: Math.PI / 6 };

interface Pickup {
  kind: PickupKind;
  x: number; y: number;
  vx: number; vy: number;
  t: number;
  value: number;
  /** Flies to the player regardless of distance (gem-cap overflow, boss loot). */
  vacuum: boolean;
}

export const MAX_GEMS = 130;
const COLLECT_DIST = 20;
const MAGNET_ACCEL = 1500;
const MAX_PULL_SPEED = 620;

export function heartSprite(): Sprite {
  const size = 44;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return { img: c, half: size / 2 };
  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = '#ff5d73';
  ctx.fillStyle = 'rgba(255,93,115,0.35)';
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.shadowColor = '#ff5d73';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(0, 9);
  ctx.bezierCurveTo(-13, -1, -8, -11, 0, -4);
  ctx.bezierCurveTo(8, -11, 13, -1, 0, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  return { img: c, half: size / 2 };
}

export class Pickups {
  private readonly pool = new Pool<Pickup>(() => ({
    kind: 'gem', x: 0, y: 0, vx: 0, vy: 0, t: 0, value: 1, vacuum: false,
  }));
  private readonly active: Pickup[] = [];
  private readonly gem: Sprite;
  private readonly coin: Sprite;
  private readonly heart: Sprite;
  private readonly sparkle: Sprite;
  private gemCount = 0;

  constructor() {
    this.gem = shapeSprite(GEM_SHAPE);
    this.coin = shapeSprite(COIN_SHAPE);
    this.heart = heartSprite();
    this.sparkle = glowDot(4, '#c5ffe2');
  }

  spawnGems(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) this.spawn('gem', x, y, 1);
  }

  spawnCoins(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) this.spawn('coin', x, y, 1);
  }

  spawnHeart(x: number, y: number): void {
    this.spawn('heart', x, y, 1);
  }

  private spawn(kind: PickupKind, x: number, y: number, value: number): void {
    if (kind === 'gem') {
      if (this.gemCount >= MAX_GEMS) {
        // Auto-deliver the oldest gem so nothing is ever lost to the cap.
        const oldest = this.active.find((p) => p.kind === 'gem' && !p.vacuum);
        if (oldest) oldest.vacuum = true;
      }
      this.gemCount++;
    }
    const p = this.pool.obtain();
    p.kind = kind;
    const a = rand(0, TAU);
    const d = rand(2, 18);
    p.x = x + Math.cos(a) * d;
    p.y = y + Math.sin(a) * d;
    p.vx = Math.cos(a) * rand(40, 130);
    p.vy = Math.sin(a) * rand(40, 130);
    p.t = rand(0, TAU);
    p.value = value;
    p.vacuum = false;
    this.active.push(p);
  }

  update(dt: number, world: World): void {
    const player = world.player;
    const magnet = world.stats.magnet;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.t += dt;
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      const d = len(dx, dy);

      if (!player.dead && (p.vacuum || d < magnet)) {
        const pull = p.vacuum ? MAGNET_ACCEL * 1.6 : MAGNET_ACCEL;
        p.vx += (dx / (d || 1)) * pull * dt;
        p.vy += (dy / (d || 1)) * pull * dt;
        const speed = len(p.vx, p.vy);
        const cap = p.vacuum ? MAX_PULL_SPEED * 1.5 : MAX_PULL_SPEED;
        if (speed > cap) {
          p.vx = (p.vx / speed) * cap;
          p.vy = (p.vy / speed) * cap;
        }
      } else {
        const drag = 1 - Math.min(1, 5 * dt);
        p.vx *= drag;
        p.vy *= drag;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (!player.dead && d < COLLECT_DIST) {
        this.collect(p, world);
        this.pool.free(swapRemove(this.active, i));
      }
    }
  }

  private collect(p: Pickup, world: World): void {
    switch (p.kind) {
      case 'gem':
        this.gemCount--;
        world.onGemCollected(p.value);
        world.particles.spawn(this.sparkle, p.x, p.y, 0, -30, 0.25, 1.2, 0.2);
        break;
      case 'coin':
        world.onCoinCollected(p.value);
        break;
      case 'heart':
        world.player.heal(world.stats.maxHp * 0.25, world);
        world.audio.play('heart');
        world.particles.burst(this.sparkle, p.x, p.y, { count: 8, speed: 100, life: 0.4 });
        break;
    }
  }

  /** Position of the nearest pickup of a kind (tutorial highlights). */
  nearestOfKind(kind: PickupKind, x: number, y: number): [number, number] | null {
    let best: Pickup | null = null;
    let bestD = Infinity;
    for (const p of this.active) {
      if (p.kind !== kind) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? [best.x, best.y] : null;
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    for (const p of this.active) {
      const bob = Math.sin(time * 3.4 + p.t) * 2.5;
      const pulse = 1 + Math.sin(time * 5 + p.t) * 0.1;
      const sprite = p.kind === 'gem' ? this.gem : p.kind === 'coin' ? this.coin : this.heart;
      drawSprite(ctx, sprite, p.x, p.y + bob, 0, p.kind === 'heart' ? pulse * 1.15 : pulse);
    }
  }

  clear(): void {
    for (const p of this.active) this.pool.free(p);
    this.active.length = 0;
    this.gemCount = 0;
  }
}

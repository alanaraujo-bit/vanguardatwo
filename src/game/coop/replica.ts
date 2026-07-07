import { clamp, TAU } from '../../core/utils';
import { drawSprite, glowDot, shapeSprite, BOLT_POINTS, type Sprite } from '../../fx/sprites';
import { ENEMY_KINDS, PICKUP_KINDS, STRIDE, type Snap } from '../../net/realtime';
import { ENEMY_SHAPE_OPTS, SPECS, isBossKind, type EnemyKind } from '../enemies';
import { COIN_SHAPE, GEM_SHAPE, heartSprite } from '../pickups';

/**
 * Render-only mirrors of the server's entities. State comes exclusively from
 * snapshots: each entity is drawn interpolated between the two most recent
 * snaps by id. No gameplay logic lives here — an entity that leaves the snap
 * simply stops being drawn (death visuals ride on 'kill' events).
 */

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/** Indexes one snap's flat arrays by entity id for O(1) pairing. */
class SnapIndex {
  readonly enemies = new Map<number, number>();
  readonly eshots = new Map<number, number>();
  readonly pshots = new Map<number, number>();
  readonly pickups = new Map<number, number>();

  constructor(readonly snap: Snap) {
    for (let i = 0; i < snap.enemies.length; i += STRIDE.enemy) this.enemies.set(snap.enemies[i], i);
    for (let i = 0; i < snap.eshots.length; i += STRIDE.eshot) this.eshots.set(snap.eshots[i], i);
    for (let i = 0; i < snap.pshots.length; i += STRIDE.pshot) this.pshots.set(snap.pshots[i], i);
    for (let i = 0; i < snap.pickups.length; i += STRIDE.pickup) this.pickups.set(snap.pickups[i], i);
  }
}

export function enemyColor(kindIdx: number): string {
  const kind = ENEMY_KINDS[kindIdx] as EnemyKind | undefined;
  return kind ? SPECS[kind].color : '#ffffff';
}

export function enemyRadius(kindIdx: number): number {
  const kind = ENEMY_KINDS[kindIdx] as EnemyKind | undefined;
  return kind ? SPECS[kind].radius : 10;
}

export class ReplicaView {
  private a: SnapIndex | null = null;
  private b: SnapIndex | null = null;

  // Lazy-baked sprite tables (same look as the sim classes).
  private readonly sprites = new Map<EnemyKind, Sprite>();
  private readonly flashes = new Map<EnemyKind, Sprite>();
  private bolt: Sprite | null = null;
  private boltCrit: Sprite | null = null;
  private orb: Sprite | null = null;
  private gem: Sprite | null = null;
  private coin: Sprite | null = null;
  private heart: Sprite | null = null;

  push(snap: Snap): void {
    this.a = this.b;
    this.b = new SnapIndex(snap);
  }

  get latest(): Snap | null {
    return this.b?.snap ?? null;
  }

  /** Nearest enemy to a point in the newest snap (local auto-aim facing). */
  nearestEnemy(x: number, y: number, maxDist: number): { x: number; y: number } | null {
    const b = this.b;
    if (!b) return null;
    const arr = b.snap.enemies;
    let best: { x: number; y: number } | null = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < arr.length; i += STRIDE.enemy) {
      const dx = arr[i + 2] - x;
      const dy = arr[i + 3] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { x: arr[i + 2], y: arr[i + 3] };
      }
    }
    return best;
  }

  renderPickups(ctx: CanvasRenderingContext2D, alpha: number, time: number): void {
    const b = this.b;
    if (!b) return;
    this.ensurePickupSprites();
    const arr = b.snap.pickups;
    for (let i = 0; i < arr.length; i += STRIDE.pickup) {
      const [x, y] = this.pairPos(arr, i, 2, this.a?.pickups, this.a?.snap.pickups, STRIDE.pickup, alpha);
      const kind = PICKUP_KINDS[arr[i + 1]];
      const id = arr[i];
      const bob = Math.sin(time * 3.4 + id) * 2.5;
      const pulse = 1 + Math.sin(time * 5 + id) * 0.1;
      const sprite = kind === 'gem' ? this.gem! : kind === 'coin' ? this.coin! : this.heart!;
      drawSprite(ctx, sprite, x, y + bob, 0, kind === 'heart' ? pulse * 1.15 : pulse);
    }
  }

  renderEnemyShots(ctx: CanvasRenderingContext2D, alpha: number, time: number): void {
    const b = this.b;
    if (!b) return;
    if (!this.orb) this.orb = glowDot(7, '#ff4ecd');
    const arr = b.snap.eshots;
    for (let i = 0; i < arr.length; i += STRIDE.eshot) {
      const [x, y] = this.pairPos(arr, i, 1, this.a?.eshots, this.a?.snap.eshots, STRIDE.eshot, alpha);
      const pulse = 1 + Math.sin(time * 12 + x) * 0.15;
      drawSprite(ctx, this.orb, x, y, 0, pulse);
    }
  }

  renderEnemies(ctx: CanvasRenderingContext2D, alpha: number, time: number): void {
    const b = this.b;
    if (!b) return;
    this.ensureEnemySprites();
    const arr = b.snap.enemies;
    for (let i = 0; i < arr.length; i += STRIDE.enemy) {
      const id = arr[i];
      const kind = ENEMY_KINDS[arr[i + 1]] as EnemyKind;
      let x = arr[i + 2];
      let y = arr[i + 3];
      let rot = arr[i + 4] / 100;
      const prevI = this.a?.enemies.get(id);
      if (prevI !== undefined && this.a) {
        const p = this.a.snap.enemies;
        x = p[prevI + 2] + (x - p[prevI + 2]) * alpha;
        y = p[prevI + 3] + (y - p[prevI + 3]) * alpha;
        rot = lerpAngle(p[prevI + 4] / 100, rot, alpha);
      }
      const sprite = this.sprites.get(kind)!;
      const scale = isBossKind(kind) ? 1 + Math.sin(time * 4) * 0.04 : 1;
      drawSprite(ctx, sprite, x, y, rot, scale);
      if (arr[i + 5] > 0) {
        drawSprite(ctx, this.flashes.get(kind)!, x, y, rot, scale, 0.8);
      }
    }
  }

  renderPlayerShots(ctx: CanvasRenderingContext2D, alpha: number): void {
    const b = this.b;
    if (!b) return;
    if (!this.bolt) {
      this.bolt = shapeSprite({ radius: 7, color: '#35f0ff', points: BOLT_POINTS, fillAlpha: 0.5 });
      this.boltCrit = shapeSprite({ radius: 9, color: '#ffc857', points: BOLT_POINTS, fillAlpha: 0.55 });
    }
    const arr = b.snap.pshots;
    for (let i = 0; i < arr.length; i += STRIDE.pshot) {
      const [x, y] = this.pairPos(arr, i, 1, this.a?.pshots, this.a?.snap.pshots, STRIDE.pshot, alpha);
      const ang = arr[i + 3] / 100;
      drawSprite(ctx, arr[i + 4] === 1 ? this.boltCrit! : this.bolt!, x, y, ang);
    }
  }

  /** Interpolated position of entity at index i (x at offset xOff). */
  private pairPos(
    arr: number[], i: number, xOff: number,
    prevMap: Map<number, number> | undefined, prevArr: number[] | undefined,
    stride: number, alpha: number,
  ): [number, number] {
    void stride;
    let x = arr[i + xOff];
    let y = arr[i + xOff + 1];
    const prevI = prevMap?.get(arr[i]);
    if (prevI !== undefined && prevArr) {
      x = prevArr[prevI + xOff] + (x - prevArr[prevI + xOff]) * alpha;
      y = prevArr[prevI + xOff + 1] + (y - prevArr[prevI + xOff + 1]) * alpha;
    }
    return [x, y];
  }

  private ensureEnemySprites(): void {
    if (this.sprites.size > 0) return;
    for (const kind of ENEMY_KINDS) {
      const spec = SPECS[kind];
      const base = { radius: spec.radius * 1.25, ...ENEMY_SHAPE_OPTS[kind] };
      this.sprites.set(kind, shapeSprite({ ...base, color: spec.color }));
      this.flashes.set(kind, shapeSprite({ ...base, color: '#ffffff', fillAlpha: 0.6 }));
    }
  }

  private ensurePickupSprites(): void {
    if (this.gem) return;
    this.gem = shapeSprite(GEM_SHAPE);
    this.coin = shapeSprite(COIN_SHAPE);
    this.heart = heartSprite();
  }
}

export function bossBarRatio(snap: Snap | null): number {
  if (!snap?.boss) return 0;
  return clamp(snap.boss[0] / snap.boss[1], 0, 1);
}

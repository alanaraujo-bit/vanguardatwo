import { isVisible } from '../core/culling';
import { Pool, swapRemove } from '../core/pool';
import { chance, dist2, TAU } from '../core/utils';
import { drawSprite, glowDot, shapeSprite, BOLT_POINTS, type Sprite } from '../fx/sprites';
import { BAL } from './balance';
import type { Enemy } from './enemies';
import type { Player } from './player';
import { SKINS, type SkinDef } from './skins';
import type { World } from './world';

export interface Shot {
  /** Network identity for snapshot interpolation; inert in solo play. */
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  dmg: number;
  crit: boolean;
  pierce: number;
  bounce: number;
  life: number;
  /** Slot of the player who fired — kill credit and co-op attribution. */
  owner: number;
  /** Speed frozen at spawn so later stat changes don't bend live shots. */
  projSpeed: number;
  hits: Enemy[];
}

const RICOCHET_RANGE = 250;

export class PlayerShots {
  private readonly pool = new Pool<Shot>(() => ({
    id: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, dmg: 0, crit: false,
    pierce: 0, bounce: 0, life: 0, owner: 0, projSpeed: BAL.player.projSpeed, hits: [],
  }));
  readonly active: Shot[] = [];
  private nextId = 1;
  // Sprites bake lazily on first render so this class can run headless.
  private bolt: Sprite | null = null;
  private boltCrit: Sprite | null = null;
  private spark: Sprite | null = null;
  private muzzle: Sprite | null = null;

  private skin: SkinDef | null = null;

  /** Update bullet sprites when the player's skin changes (called once per run start). */
  setSkin(sd: SkinDef): void {
    this.skin = sd;
    this.bolt = null;
    this.boltCrit = null;
    this.spark = null;
    this.muzzle = null;
  }

  spawnVolley(owner: Player, angle: number, world: World): void {
    const s = owner.stats;
    const n = s.projectiles;
    const step = 0.11;
    const start = angle - ((n - 1) / 2) * step;
    for (let i = 0; i < n; i++) {
      const a = start + i * step;
      const crit = chance(s.critChance);
      const shot = this.pool.obtain();
      shot.id = this.nextId++;
      shot.x = owner.x + Math.cos(a) * 16;
      shot.y = owner.y + Math.sin(a) * 16;
      shot.angle = a;
      shot.vx = Math.cos(a) * s.projSpeed;
      shot.vy = Math.sin(a) * s.projSpeed;
      shot.dmg = s.damage * (crit ? s.critMult : 1);
      shot.crit = crit;
      shot.pierce = s.pierce;
      shot.bounce = s.bounce;
      shot.life = BAL.player.projLife;
      shot.owner = owner.slot;
      shot.projSpeed = s.projSpeed;
      shot.hits.length = 0;
      this.active.push(shot);
    }
    if (this.muzzle) {
      world.particles.spawn(this.muzzle, owner.x + Math.cos(angle) * 18, owner.y + Math.sin(angle) * 18, 0, 0, 0.12, 1.4, 0.2);
    }
    world.audio.play('shoot');
  }

  update(dt: number, world: World): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const shot = this.active[i];
      shot.life -= dt;
      if (shot.life <= 0) {
        this.pool.free(swapRemove(this.active, i));
        continue;
      }
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;

      if (this.spark && Math.random() < dt * 20) {
        world.particles.spawn(this.spark, shot.x, shot.y, 0, 0, 0.18, 0.8, 0.1);
      }

      let dead = false;
      world.enemies.hash.query(shot.x, shot.y, 30, (e) => {
        if (dead || e.dead || shot.hits.includes(e)) return;
        const r = e.radius + 6;
        if (dist2(shot.x, shot.y, e.x, e.y) > r * r) return;
        shot.hits.push(e);
        const knock = 130 + shot.dmg * 2;
        const killer = world.players[shot.owner] ?? null;
        world.enemies.damage(e, shot.dmg, shot.crit, (shot.vx / shot.projSpeed) * knock, (shot.vy / shot.projSpeed) * knock, world, killer);

        if (shot.bounce > 0) {
          const next = this.findRicochetTarget(shot, world);
          if (next) {
            shot.bounce--;
            const a = Math.atan2(next.y - shot.y, next.x - shot.x);
            shot.angle = a;
            shot.vx = Math.cos(a) * shot.projSpeed;
            shot.vy = Math.sin(a) * shot.projSpeed;
            shot.life = BAL.player.projLife * 0.7;
            return;
          }
        }
        if (shot.pierce > 0) {
          shot.pierce--;
          return;
        }
        dead = true;
      });

      if (dead) {
        if (this.spark) {
          world.particles.burst(this.spark, shot.x, shot.y, { count: 3, speed: 90, life: 0.22, size: 1 });
        }
        this.pool.free(swapRemove(this.active, i));
      }
    }
  }

  private findRicochetTarget(shot: Shot, world: World): Enemy | null {
    let best: Enemy | null = null;
    let bestD = RICOCHET_RANGE * RICOCHET_RANGE;
    world.enemies.hash.query(shot.x, shot.y, RICOCHET_RANGE, (e) => {
      if (e.dead || shot.hits.includes(e)) return;
      const d = dist2(shot.x, shot.y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    });
    return best;
  }

  private ensureSprites(): void {
    if (this.bolt) return;
    const sd = this.skin ?? SKINS[0];
    this.bolt = shapeSprite({ radius: 7, color: sd.bulletColor, points: BOLT_POINTS, fillAlpha: 0.5 });
    this.boltCrit = shapeSprite({ radius: 9, color: sd.bulletCritColor, points: BOLT_POINTS, fillAlpha: 0.55 });
    this.spark = glowDot(4, sd.sparkColor);
    this.muzzle = glowDot(7, sd.muzzleColor);
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, vpW: number, vpH: number): void {
    this.ensureSprites();
    for (const shot of this.active) {
      if (!isVisible(shot.x, shot.y, camX, camY, vpW, vpH)) continue;
      drawSprite(ctx, shot.crit ? this.boltCrit! : this.bolt!, shot.x, shot.y, shot.angle);
    }
  }

  clear(): void {
    for (const s of this.active) this.pool.free(s);
    this.active.length = 0;
  }
}

export type OrbVisual = 'default' | 'ice' | 'patch' | 'acid';

export interface Orb {
  /** Network identity for snapshot interpolation; inert in solo play. */
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  dmg: number;
  life: number;
  /** Visual variant for rendering. */
  visual: OrbVisual;
  /** Slow duration on hit (0 = no slow). */
  freeze: number;
}

export class EnemyShots {
  private readonly pool = new Pool<Orb>(() => ({ id: 0, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, life: 0, visual: 'default', freeze: 0 }));
  readonly active: Orb[] = [];
  private nextId = 1;
  private orb: Sprite | null = null;
  private iceOrb: Sprite | null = null;
  private patchOrb: Sprite | null = null;
  private acidOrb: Sprite | null = null;

  spawn(x: number, y: number, angle: number, speed: number, dmg: number): void {
    const o = this.pool.obtain();
    o.id = this.nextId++;
    o.x = x;
    o.y = y;
    o.vx = Math.cos(angle) * speed;
    o.vy = Math.sin(angle) * speed;
    o.dmg = dmg;
    o.life = 4.5;
    o.visual = 'default';
    o.freeze = 0;
    this.active.push(o);
  }

  /** Spawn an ice orb that slows the player on hit. */
  spawnIce(x: number, y: number, angle: number, speed: number, dmg: number, freezeDur = 0.8): void {
    const o = this.pool.obtain();
    o.id = this.nextId++;
    o.x = x;
    o.y = y;
    o.vx = Math.cos(angle) * speed;
    o.vy = Math.sin(angle) * speed;
    o.dmg = dmg;
    o.life = 4.5;
    o.visual = 'ice';
    o.freeze = freezeDur;
    this.active.push(o);
  }

  /** Spawn an acid orb that leaves a patch when it expires. */
  spawnAcid(x: number, y: number, angle: number, speed: number, dmg: number, life = 2.5): void {
    const o = this.pool.obtain();
    o.id = this.nextId++;
    o.x = x;
    o.y = y;
    o.vx = Math.cos(angle) * speed;
    o.vy = Math.sin(angle) * speed;
    o.dmg = dmg;
    o.life = life;
    o.visual = 'acid';
    o.freeze = 0;
    this.active.push(o);
  }

  /** Number of acid pools planted by acid orbs this frame (capped per frame). */
  private acidPoolsThisFrame = 0;

  /** Spawn a stationary hazard (acid pool / ice patch). */
  spawnPatch(x: number, y: number, dmg: number, life = 3): void {
    const o = this.pool.obtain();
    o.id = this.nextId++;
    o.x = x;
    o.y = y;
    o.vx = 0;
    o.vy = 0;
    o.dmg = dmg;
    o.life = life;
    o.visual = 'patch';
    o.freeze = 0;
    this.active.push(o);
  }

  update(dt: number, world: World): void {
    this.acidPoolsThisFrame = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      o.life -= dt;
      if (o.life <= 0) {
        if (o.visual === 'acid' && this.acidPoolsThisFrame < 6) {
          this.acidPoolsThisFrame++;
          world.enemyShots.spawnPatch(o.x, o.y, o.dmg * 0.6, 4);
        }
        this.pool.free(swapRemove(this.active, i));
        continue;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      for (const p of world.players) {
        if (p.dead) continue;
        const r = p.radius + 7;
        if (dist2(o.x, o.y, p.x, p.y) < r * r) {
          p.takeDamage(o.dmg, world);
          if (o.freeze > 0) p.slow(o.freeze);
          const hitSpr = o.visual === 'patch' ? this.patchOrb : o.visual === 'ice' ? this.iceOrb : o.visual === 'acid' ? this.acidOrb : this.orb;
          if (hitSpr) {
            world.particles.burst(hitSpr, o.x, o.y, { count: 5, speed: 110, life: 0.25 });
          }
          if (o.visual === 'patch') {
            // Ice patches persist after the first hit (area denial).
            continue;
          }
          this.pool.free(swapRemove(this.active, i));
          break;
        }
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, time: number, camX: number, camY: number, vpW: number, vpH: number): void {
    if (!this.orb) this.orb = glowDot(7, '#ff4ecd');
    if (!this.iceOrb) this.iceOrb = glowDot(8, '#8af0ff');
    if (!this.patchOrb) this.patchOrb = glowDot(14, 'rgba(160, 230, 255, 0.6)');
    if (!this.acidOrb) this.acidOrb = glowDot(9, '#9eff4d');
    for (const o of this.active) {
      if (!isVisible(o.x, o.y, camX, camY, vpW, vpH)) continue;
      const pulse = 1 + Math.sin(time * 12 + o.x) * 0.15;
      const spr = o.visual === 'patch' ? this.patchOrb!
        : o.visual === 'ice' ? this.iceOrb!
        : o.visual === 'acid' ? this.acidOrb!
        : this.orb!;
      const alpha = o.visual === 'patch' ? 0.5 + Math.sin(time * 3 + o.id) * 0.15 : 1;
      drawSprite(ctx, spr, o.x, o.y, 0, pulse, alpha);
    }
  }

  clear(): void {
    for (const o of this.active) this.pool.free(o);
    this.active.length = 0;
  }
}

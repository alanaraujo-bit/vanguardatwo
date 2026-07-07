import { clamp, damp, len, TAU } from '../core/utils';
import { drawSprite, glowDot, shapeSprite, SHIP_POINTS, type ShapeOptions, type Sprite } from '../fx/sprites';
import { BAL } from './balance';
import type { Stats } from './upgrades';
import type { World } from './world';

/** Shared with the Codex so its ship icon matches the arena exactly. */
export const SHIP_SHAPE: ShapeOptions = { radius: 17, color: '#35f0ff', points: SHIP_POINTS, fillAlpha: 0.3 };

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export class Player {
  /** Position in the run's players[] — doubles as the network slot in co-op. */
  slot = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  hp: number;
  radius = BAL.player.radius;

  level = 1;
  xp = 0;
  xpNeed = BAL.xpNeed(1);
  pendingLevels = 0;

  aimAngle = -Math.PI / 2;
  facing = -Math.PI / 2;
  iframes = 0;
  dead = false;

  /**
   * Movement intent for this sim tick, already normalized/quantized. Fed from
   * the local joystick in solo play and from the network in co-op — the sim
   * itself never reads input devices.
   */
  readonly intent = { mx: 0, my: 0 };

  /** Hull tint override (co-op paints the partner's ship differently). */
  shipColor: string | null = null;

  private fireTimer = 0.3;
  private recoil = 0;
  // Sprites bake lazily on first render so this class can run headless.
  private ship: Sprite | null = null;
  private shipFlash: Sprite | null = null;
  private thrust: Sprite | null = null;
  private hurtDot: Sprite | null = null;

  constructor(public stats: Stats) {
    this.hp = stats.maxHp;
  }

  get intentMag(): number {
    return clamp(len(this.intent.mx, this.intent.my), 0, 1);
  }

  /** Swap in recomputed stats, granting any max-HP increase as current HP. */
  applyStats(next: Stats): void {
    this.hp += Math.max(0, next.maxHp - this.stats.maxHp);
    this.stats = next;
    this.hp = clamp(this.hp, 0, next.maxHp);
  }

  addXp(value: number): void {
    this.xp += value;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = BAL.xpNeed(this.level);
      this.pendingLevels++;
    }
  }

  heal(amount: number, world: World): void {
    if (this.dead || amount <= 0) return;
    const before = this.hp;
    this.hp = clamp(this.hp + amount, 0, this.stats.maxHp);
    const gained = Math.round(this.hp - before);
    if (gained > 0) {
      world.floaters.spawn(this.x, this.y - 20, `+${gained}`, { color: '#52ffa8', size: 15, bold: true });
    }
  }

  takeDamage(amount: number, world: World): void {
    if (this.dead || this.iframes > 0) return;
    this.hp -= amount;
    this.iframes = BAL.player.iframes;
    world.shake(16);
    world.hitStop(0.08, 0.12);
    world.audio.play('hurt');
    if (this.hurtDot) {
      world.particles.burst(this.hurtDot, this.x, this.y, { count: 10, speed: 160, size: 1.2, life: 0.4 });
    }
    world.floaters.spawn(this.x, this.y - 22, `-${Math.round(amount)}`, { color: '#ff5d73', size: 16, bold: true });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      world.onPlayerDeath(this);
    }
  }

  /**
   * Movement physics only: springy velocity toward the intent vector, with
   * asymmetric response — releasing the stick brakes hard and pushing against
   * the current motion flips even harder, so stops and dodges feel precise.
   * Split out from update() because co-op prediction/replay re-runs exactly
   * this piece on the client.
   */
  applyMovement(dt: number): void {
    const s = this.stats;
    const mag = this.intentMag;
    const mv = BAL.player.move;
    const tx = this.intent.mx * s.speed;
    const ty = this.intent.my * s.speed;
    let rate: number = mv.accel;
    if (mag < 0.01) rate = mv.brake;
    else if (tx * this.vx + ty * this.vy < 0) rate = mv.flip;
    const k = damp(rate, dt);
    this.vx += (tx - this.vx) * k;
    this.vy += (ty - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  update(dt: number, world: World): void {
    if (this.dead) return;
    const s = this.stats;
    this.iframes -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (s.regen > 0) this.hp = clamp(this.hp + s.regen * dt, 0, s.maxHp);

    this.applyMovement(dt);
    const mag = this.intentMag;

    // Aim at the nearest threat; otherwise face travel direction.
    const target = world.enemies.nearest(this.x, this.y, BAL.player.aimRange);
    if (target) {
      this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
      this.facing = angleLerp(this.facing, this.aimAngle, damp(18, dt));
    } else if (mag > 0.15) {
      this.facing = angleLerp(this.facing, Math.atan2(this.vy, this.vx), damp(8, dt));
    }

    // Auto-fire.
    this.fireTimer -= dt;
    if (target && this.fireTimer <= 0) {
      this.fireTimer = s.fireInterval;
      world.playerShots.spawnVolley(this, this.aimAngle, world);
      this.recoil = 1;
    }

    // Thruster trail.
    const speed2 = this.vx * this.vx + this.vy * this.vy;
    if (this.thrust && speed2 > 900 && Math.random() < dt * 40) {
      const back = Math.atan2(this.vy, this.vx) + Math.PI;
      world.particles.spawn(
        this.thrust,
        this.x + Math.cos(back) * 14, this.y + Math.sin(back) * 14,
        Math.cos(back) * 60, Math.sin(back) * 60,
        0.35, 0.9, 0.1, 2,
      );
    }
  }

  private ensureSprites(): void {
    if (this.ship) return;
    this.ship = shapeSprite(this.shipColor ? { ...SHIP_SHAPE, color: this.shipColor } : SHIP_SHAPE);
    this.shipFlash = shapeSprite({ radius: 17, color: '#ffffff', points: SHIP_POINTS, fillAlpha: 0.6 });
    this.thrust = glowDot(5, this.shipColor ?? '#35d5ff');
    this.hurtDot = glowDot(6, '#ff3b5c');
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.dead) return;
    this.ensureSprites();
    const blink = this.iframes > 0 && Math.sin(time * 34) > 0;
    const alpha = blink ? 0.3 : 1;
    const kick = this.recoil * this.recoil * 3.5;
    const x = this.x - Math.cos(this.aimAngle) * kick;
    const y = this.y - Math.sin(this.aimAngle) * kick;
    const breathe = 1 + Math.sin(time * 3.1) * 0.02;
    drawSprite(ctx, this.ship!, x, y, this.facing, breathe, alpha);
    if (this.iframes > BAL.player.iframes - 0.18) {
      drawSprite(ctx, this.shipFlash!, x, y, this.facing, breathe * 1.05, 0.7);
    }
  }
}

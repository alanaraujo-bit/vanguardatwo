import { clamp, damp, TAU } from '../core/utils';
import { drawSprite, glowDot, shapeSprite, SHIP_POINTS, type Sprite } from '../fx/sprites';
import { BAL } from './balance';
import type { Stats } from './upgrades';
import type { World } from './world';

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export class Player {
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

  private fireTimer = 0.3;
  private recoil = 0;
  private readonly ship: Sprite;
  private readonly shipFlash: Sprite;
  private readonly thrust: Sprite;
  private readonly hurtDot: Sprite;

  constructor(public stats: Stats) {
    this.hp = stats.maxHp;
    this.ship = shapeSprite({ radius: 17, color: '#35f0ff', points: SHIP_POINTS, fillAlpha: 0.3 });
    this.shipFlash = shapeSprite({ radius: 17, color: '#ffffff', points: SHIP_POINTS, fillAlpha: 0.6 });
    this.thrust = glowDot(5, '#35d5ff');
    this.hurtDot = glowDot(6, '#ff3b5c');
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
    world.particles.burst(this.hurtDot, this.x, this.y, { count: 10, speed: 160, size: 1.2, life: 0.4 });
    world.floaters.spawn(this.x, this.y - 22, `-${Math.round(amount)}`, { color: '#ff5d73', size: 16, bold: true });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      world.onPlayerDeath();
    }
  }

  update(dt: number, world: World): void {
    if (this.dead) return;
    const s = this.stats;
    this.iframes -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (s.regen > 0) this.hp = clamp(this.hp + s.regen * dt, 0, s.maxHp);

    // Movement: springy velocity toward the joystick vector, with asymmetric
    // response — releasing the stick brakes hard and pushing against the
    // current motion flips even harder, so stops and dodges feel precise.
    const input = world.input;
    const mv = BAL.player.move;
    const tx = input.moveX * s.speed;
    const ty = input.moveY * s.speed;
    let rate: number = mv.accel;
    if (input.magnitude < 0.01) rate = mv.brake;
    else if (tx * this.vx + ty * this.vy < 0) rate = mv.flip;
    const k = damp(rate, dt);
    this.vx += (tx - this.vx) * k;
    this.vy += (ty - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Aim at the nearest threat; otherwise face travel direction.
    const target = world.enemies.nearest(this.x, this.y, BAL.player.aimRange);
    if (target) {
      this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
      this.facing = angleLerp(this.facing, this.aimAngle, damp(18, dt));
    } else if (input.magnitude > 0.15) {
      this.facing = angleLerp(this.facing, Math.atan2(this.vy, this.vx), damp(8, dt));
    }

    // Auto-fire.
    this.fireTimer -= dt;
    if (target && this.fireTimer <= 0) {
      this.fireTimer = s.fireInterval;
      world.playerShots.spawnVolley(this.x, this.y, this.aimAngle, world);
      this.recoil = 1;
    }

    // Thruster trail.
    const speed2 = this.vx * this.vx + this.vy * this.vy;
    if (speed2 > 900 && Math.random() < dt * 40) {
      const back = Math.atan2(this.vy, this.vx) + Math.PI;
      world.particles.spawn(
        this.thrust,
        this.x + Math.cos(back) * 14, this.y + Math.sin(back) * 14,
        Math.cos(back) * 60, Math.sin(back) * 60,
        0.35, 0.9, 0.1, 2,
      );
    }
  }

  render(ctx: CanvasRenderingContext2D, time: number): void {
    if (this.dead) return;
    const blink = this.iframes > 0 && Math.sin(time * 34) > 0;
    const alpha = blink ? 0.3 : 1;
    const kick = this.recoil * this.recoil * 3.5;
    const x = this.x - Math.cos(this.aimAngle) * kick;
    const y = this.y - Math.sin(this.aimAngle) * kick;
    const breathe = 1 + Math.sin(time * 3.1) * 0.02;
    drawSprite(ctx, this.ship, x, y, this.facing, breathe, alpha);
    if (this.iframes > BAL.player.iframes - 0.18) {
      drawSprite(ctx, this.shipFlash, x, y, this.facing, breathe * 1.05, 0.7);
    }
  }
}

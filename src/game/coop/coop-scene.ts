import type { SfxName, AudioEngine } from '../../audio/audio';
import type { Music } from '../../audio/music';
import type { Game, Scene } from '../../core/game';
import type { SaveSystem } from '../../core/save';
import { clamp, damp } from '../../core/utils';
import { Background } from '../../fx/background';
import { Floaters } from '../../fx/floaters';
import { Particles } from '../../fx/particles';
import { glowDot, type Sprite } from '../../fx/sprites';
import { S } from '../../i18n/strings';
import {
  INTERP_MS, SIM_RATE, SNAP_RATE,
  type EndResult, type PlayerSnap, type ServerMsg, type SimEvent, type Snap,
} from '../../net/realtime';
import type { CoopSocket } from '../../net/ws';
import { Hud, type HudView } from '../hud';
import { Player } from '../player';
import { SECTORS, sectorForWave, sectorIndexForWave, sectorNumberForWave } from '../sectors';
import { computeStats, UPGRADE_DEFS } from '../upgrades';
import type { UI } from '../../ui/ui';
import { enemyColor, enemyRadius, ReplicaView } from './replica';

export interface CoopSceneDeps {
  game: Game;
  save: SaveSystem;
  ui: UI;
  audio: AudioEngine;
  music: Music;
  socket: CoopSocket;
  localSlot: number;
  /** Display names by slot. */
  names: string[];
  /** Match finished (server verdict) — caller swaps to the results screen. */
  onEnd(results: EndResult[]): void;
  /** Socket dropped mid-match — caller returns to the menu. */
  onDisconnect(): void;
}

const AIM_RANGE = 500;

/**
 * Client presentation of a co-op match. The server simulates; this scene
 * predicts the local ship's movement for zero-latency feel, interpolates
 * everything else between snapshots, and turns SimEvents into juice
 * (banners, sfx, particles). It deliberately implements none of World —
 * there is no local simulation to feed.
 */
export class CoopScene implements Scene {
  private readonly replica = new ReplicaView();
  readonly particles = new Particles();
  private readonly floaters = new Floaters();
  private readonly hud = new Hud();
  private readonly bg = new Background();
  private readonly local: Player;
  private readonly remote: Player;
  private readonly upgLevels = new Map<string, number>();
  private readonly debris = new Map<number, Sprite>();
  private readonly deathDot: Sprite;

  private prevSnap: Snap | null = null;
  private currSnap: Snap | null = null;
  private snapArrivedAt = 0;
  private snapIntervalMs = 1000 / SNAP_RATE;

  private seq = 0;
  private sendT = 0;
  /** Inputs sent but not yet acked — replayed on top of each server state. */
  private readonly pending: { seq: number; mx: number; my: number }[] = [];
  private bgSender: ReturnType<typeof setInterval> | null = null;
  private camX = 0;
  private camY = 0;
  private trauma = 0;
  private sectorFlash = 0;
  private sectorFlashColor = '#ffffff';
  private ended = false;
  private lastLocalHp = -1;
  /** Último tick do snapshot em que houve um abate — usado pra seta de inimigo perdido. */
  private lastKillTick = 0;
  private arrowSoundPlayed = false;
  /** Timer de transição de setor após bossDown (breather de 2s). */
  private sectorTransitionTimer = 0;
  private pendingSector: { sector: import('../sectors.js').SectorDef; number: number } | null = null;

  private readonly hudView: HudView = {
    hp: 0, maxHp: 1, level: 1, xp: 0, xpNeed: 1,
    wave: 1, runTime: 0, coins: 0, combo: 0, boss: null,
  };

  constructor(private readonly deps: CoopSceneDeps) {
    const lv = (id: string): number => this.upgLevels.get(id) ?? 0;
    this.local = new Player(computeStats(deps.save.data, lv));
    this.local.slot = deps.localSlot;
    this.local.x = deps.localSlot === 0 ? -60 : 60;
    this.remote = new Player(computeStats(deps.save.data, () => 0));
    this.remote.slot = deps.localSlot === 0 ? 1 : 0;
    this.remote.shipColor = '#b45cff';
    this.deathDot = glowDot(10, '#9ff2ff');
    this.particles.quality = deps.save.data.settings.graphics.particleQuality;
    this.floaters.setDensity(deps.save.data.settings.graphics.entityDensity);

    deps.socket.onMessage = (msg) => this.onMessage(msg);
    deps.socket.onClose = (code, reason) => {
      console.error(`[coop] socket fechado durante a partida (code=${code} reason="${reason}")`);
      if (!this.ended) this.deps.onDisconnect();
    };
  }

  enter(): void {
    this.deps.music.setMode('game');
    this.deps.music.intensity = 0;
    this.deps.music.setTheme(SECTORS[0].music);
    this.bg.setTheme(SECTORS[0].background);
    this.deps.ui.banner('ONDA 1');
    // Hidden tabs freeze rAF; this keeps the intent stream (and the socket)
    // alive so the server never sees a phantom idle player.
    this.bgSender = setInterval(() => {
      if (document.hidden && this.deps.socket.open && !this.ended) {
        this.sendInput(this.local.intent.mx, this.local.intent.my);
      }
    }, 100);
  }

  exit(): void {
    if (this.bgSender) clearInterval(this.bgSender);
    this.bgSender = null;
    this.particles.clear();
    this.floaters.clear();
  }

  private sendInput(mx: number, my: number): void {
    const seq = ++this.seq;
    this.pending.push({ seq, mx, my });
    if (this.pending.length > 120) this.pending.splice(0, this.pending.length - 120);
    this.deps.socket.send({ t: 'input', seq, mx, my });
  }

  quit(): void {
    this.ended = true;
    this.deps.socket.send({ t: 'leave' });
    this.deps.socket.close();
  }

  /** Pause is impossible online; the button becomes a leave-match confirm. */
  pause(): void {
    this.deps.ui.confirm(S.coopLeaveConfirm, () => {
      this.quit();
      this.deps.onDisconnect();
    }, S.coopLeaveYes);
  }

  // ————— network in —————

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'snap':
        this.onSnap(msg.s);
        break;
      case 'offer': {
        if (msg.slot !== this.deps.localSlot) return;
        const defs = msg.choices
          .map((id) => UPGRADE_DEFS.find((d) => d.id === id))
          .filter((d): d is NonNullable<typeof d> => d !== undefined);
        const lv = (id: string): number => this.upgLevels.get(id) ?? 0;
        const secondsLeft = Math.max(1, (msg.deadlineTick - (this.currSnap?.tick ?? 0)) / SIM_RATE);
        this.deps.ui.showLevelUpCoop(defs, lv, secondsLeft, (def) => {
          this.deps.socket.send({ t: 'pick', offerId: msg.offerId, upgradeId: def.id });
          this.upgLevels.set(def.id, lv(def.id) + 1);
          // Mirror the stat change locally so movement prediction (speed)
          // stays in step; the server remains the authority on everything.
          this.local.applyStats(computeStats(this.deps.save.data, lv));
          this.deps.audio.play('confirm');
        });
        break;
      }
      case 'end':
        this.ended = true;
        this.deps.ui.hideLevelUpCoop();
        this.deps.onEnd(msg.results);
        break;
      case 'err':
        // Mid-match errors are non-fatal; log for diagnosis.
        console.warn('[coop]', msg.code);
        break;
      default:
        break;
    }
  }

  private onSnap(snap: Snap): void {
    const now = performance.now();
    if (this.snapArrivedAt > 0) {
      const gap = now - this.snapArrivedAt;
      // Smoothed measured cadence keeps interpolation right even if the
      // server ever changes SNAP_RATE.
      this.snapIntervalMs = clamp(this.snapIntervalMs * 0.9 + gap * 0.1, 40, 140);
    }
    this.snapArrivedAt = now;
    this.prevSnap = this.currSnap;
    this.currSnap = snap;
    this.replica.push(snap);
    this.applyEvents(snap.ev);

    const me = snap.players.find((p) => p.slot === this.deps.localSlot);
    if (me) {
      if (this.lastLocalHp >= 0 && me.hp < this.lastLocalHp && !me.dead) {
        this.shake(16);
        this.floaters.spawn(this.local.x, this.local.y - 22, `-${Math.round(this.lastLocalHp - me.hp)}`, {
          color: '#ff5d73', size: 16, bold: true,
        });
      }
      this.lastLocalHp = me.hp;
      this.local.dead = me.dead;
      this.local.iframes = me.ifr;
      this.local.hp = me.hp;
    }
  }

  private applyEvents(evs: SimEvent[]): void {
    for (const ev of evs) {
      switch (ev.e) {
        case 'sfx':
          this.deps.audio.play(ev.s as SfxName, ev.p);
          break;
        case 'wave':
          this.deps.ui.banner(`ONDA ${ev.n}`);
          this.deps.music.intensity = Math.min(1, ev.n / 12);
          break;
        case 'sector': {
          const sector = SECTORS[(ev.n - 1) % SECTORS.length];
          // Se um boss acabou de morrer e a transição está agendada, não executa agora.
          if (this.sectorTransitionTimer > 0) break;
          this.commitSector(sector, ev.n);
          break;
        }
        case 'bossWarn': {
          const sector = sectorForWave(this.currSnap?.wave ?? 1);
          this.deps.ui.banner(sector.boss.name.toUpperCase(), sector.boss.warnSub, true);
          this.deps.music.setTheme(sector.music.bossMusic ?? sector.music);
          this.deps.music.intensity = 1;
          break;
        }
        case 'bossDown': {
          const sector = sectorForWave(this.currSnap?.wave ?? 1);
          this.deps.ui.banner(sector.boss.defeatTitle, sector.boss.defeatSub);
          this.shake(42);
          // Se a próxima onda for um novo setor, agenda a transição com 2s de respiro.
          const nextWave = (this.currSnap?.wave ?? 1) + 1;
          if (sectorIndexForWave(nextWave) !== sectorIndexForWave(this.currSnap?.wave ?? 1)) {
            this.sectorTransitionTimer = 2.0;
            this.pendingSector = { sector: sectorForWave(nextWave), number: sectorNumberForWave(nextWave) };
          } else {
            this.deps.music.setTheme(sector.music);
            this.deps.music.intensity = Math.min(1, (this.currSnap?.wave ?? 1) / 12);
          }
          break;
        }
        case 'kill': {
          this.lastKillTick = this.currSnap?.tick ?? 0;
          this.arrowSoundPlayed = false;
          const debris = this.debrisFor(ev.k);
          const big = enemyRadius(ev.k) >= 18;
          this.particles.burst(debris, ev.x, ev.y, {
            count: big ? 18 : 9,
            speed: big ? 210 : 150,
            size: big ? 1.6 : 1.1,
            life: big ? 0.55 : 0.4,
          });
          if (big) {
            this.particles.ring(ev.x, ev.y, enemyColor(ev.k), 10, 380, 0.4, 4);
            this.shake(8);
          }
          break;
        }
        case 'dmg':
          this.floaters.spawn(ev.x, ev.y - 10, String(ev.v), {
            color: ev.c === 1 ? '#ffc857' : '#ffffff',
            size: ev.c === 1 ? 17 : 12,
            bold: ev.c === 1,
          });
          break;
        case 'coin':
          if (ev.slot === this.deps.localSlot) {
            this.floaters.spawn(this.local.x, this.local.y - 26, `+${ev.v}`, {
              color: '#ffc857', size: 13, bold: true,
            });
          }
          break;
        case 'gem':
          break;
        case 'nova':
          break;
        case 'levelup': {
          const p = this.playerBySlot(ev.slot);
          this.particles.ring(p.x, p.y, '#52ffa8', 10, 460, 0.5, 4);
          break;
        }
        case 'death': {
          const p = this.playerBySlot(ev.slot);
          this.particles.burst(this.deathDot, p.x, p.y, { count: 26, speed: 260, size: 1.8, life: 0.8 });
          this.particles.ring(p.x, p.y, '#35f0ff', 12, 520, 0.6, 6);
          if (ev.slot === this.deps.localSlot) {
            this.shake(60);
            this.deps.ui.banner(S.coopDownedTitle, S.coopDownedSub, true);
          } else {
            this.deps.ui.banner(S.coopPartnerDown);
          }
          break;
        }
        case 'revive': {
          const p = this.playerBySlot(ev.slot);
          this.particles.ring(p.x, p.y, '#35f0ff', 12, 520, 0.6, 6);
          if (ev.slot === this.deps.localSlot) this.deps.ui.banner(S.coopRevived);
          break;
        }
        case 'hit':
          break;
      }
    }
  }

  private playerBySlot(slot: number): Player {
    return slot === this.deps.localSlot ? this.local : this.remote;
  }

  private debrisFor(kindIdx: number): Sprite {
    let sprite = this.debris.get(kindIdx);
    if (!sprite) {
      sprite = glowDot(5, enemyColor(kindIdx));
      this.debris.set(kindIdx, sprite);
    }
    return sprite;
  }

  private shake(amount: number): void {
    if (!this.deps.save.data.settings.graphics.screenShake) return;
    this.trauma = Math.min(1, this.trauma + amount / 100);
  }

  /** Setting de gráficos (densidade de entidades) — inimigos/gemas são do servidor (autoritativo), só os floaters cosméticos escalam aqui. */
  applyGraphicsDensity(mul: number): void {
    this.floaters.setDensity(mul);
  }

  // ————— frame —————

  update(dt: number): void {
    // Intent: sample locally, feed the prediction AND the wire with the
    // exact same quantized numbers.
    const mv = this.deps.game.input.sample();
    this.local.intent.mx = mv.mx;
    this.local.intent.my = mv.my;
    this.sendT += dt;
    if (this.sendT >= 1 / SIM_RATE && this.deps.socket.open) {
      this.sendT = 0;
      this.sendInput(mv.mx, mv.my);
    }

    if (!this.local.dead) {
      this.local.applyMovement(dt);
      // Cosmetic facing: aim at the nearest replica enemy like the sim does.
      const target = this.replica.nearestEnemy(this.local.x, this.local.y, AIM_RANGE);
      if (target) {
        this.local.aimAngle = Math.atan2(target.y - this.local.y, target.x - this.local.x);
        this.local.facing += this.angleDelta(this.local.facing, this.local.aimAngle) * damp(18, dt);
      } else if (this.local.intentMag > 0.15) {
        this.local.facing += this.angleDelta(this.local.facing, Math.atan2(this.local.vy, this.local.vx)) * damp(8, dt);
      }
      this.correctLocal(dt);
    }

    this.updateRemote(dt);
    this.particles.update(dt);
    this.floaters.update(dt);

    // Camera: follow the local ship; when downed, spectate the partner.
    const target = this.local.dead && !this.remote.dead ? this.remote : this.local;
    const k = damp(8, dt);
    this.camX += (target.x - this.camX) * k;
    this.camY += (target.y - this.camY) * k;
    this.trauma = Math.max(0, this.trauma - 2.4 * dt);
    this.sectorFlash = Math.max(0, this.sectorFlash - 0.9 * dt);

    // Transição de setor agendada (após bossDown no limite do setor).
    if (this.sectorTransitionTimer > 0) {
      this.sectorTransitionTimer -= dt;
      if (this.sectorTransitionTimer <= 0 && this.pendingSector) {
        this.commitSector(this.pendingSector.sector, this.pendingSector.number);
        this.pendingSector = null;
      }
    }
  }

  private angleDelta(a: number, b: number): number {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Scratch body for replaying pending inputs over server states. */
  private ghost: Player | null = null;

  /**
   * Reconciliation: take the server's authoritative state, replay every
   * input it hasn't consumed yet (seq > ack) at one sim step each — the
   * client sends inputs at exactly SIM_RATE, so pending inputs ≈ pending
   * ticks — and blend the predicted ship toward that result. Hard-snap only
   * on teleport-sized errors (revives, corrections after a stall).
   */
  private correctLocal(dt: number): void {
    const snap = this.currSnap;
    if (!snap) return;
    const me = snap.players.find((p) => p.slot === this.deps.localSlot);
    if (!me || me.dead) return;

    // Drop acked inputs.
    while (this.pending.length > 0 && this.pending[0].seq <= snap.ack) this.pending.shift();

    if (!this.ghost) this.ghost = new Player(this.local.stats);
    const g = this.ghost;
    g.stats = this.local.stats;
    g.x = me.x;
    g.y = me.y;
    g.vx = me.vx;
    g.vy = me.vy;
    for (const input of this.pending) {
      g.intent.mx = input.mx;
      g.intent.my = input.my;
      g.applyMovement(1 / SIM_RATE);
    }

    const ex = g.x - this.local.x;
    const ey = g.y - this.local.y;
    const e2 = ex * ex + ey * ey;
    if (e2 > 140 * 140) {
      this.local.x = g.x;
      this.local.y = g.y;
      this.local.vx = g.vx;
      this.local.vy = g.vy;
      return;
    }
    // Tiny errors: leave the prediction alone (quantization noise). Larger
    // ones: exponential pull so corrections read as drift, never as jerk.
    if (e2 > 2 * 2) {
      const k = damp(6, dt);
      this.local.x += ex * k;
      this.local.y += ey * k;
      this.local.vx += (g.vx - this.local.vx) * k;
      this.local.vy += (g.vy - this.local.vy) * k;
    }
  }

  private updateRemote(dt: number): void {
    void dt;
    const curr = this.currSnap;
    if (!curr) return;
    const rs = curr.players.find((p) => p.slot === this.remote.slot);
    if (!rs) return;
    const ps = this.prevSnap?.players.find((p) => p.slot === this.remote.slot);
    const alpha = this.interpAlpha();
    if (ps && !ps.dead && !rs.dead) {
      this.remote.x = ps.x + (rs.x - ps.x) * alpha;
      this.remote.y = ps.y + (rs.y - ps.y) * alpha;
      this.remote.facing = ps.facing100 / 100
        + this.angleDelta(ps.facing100 / 100, rs.facing100 / 100) * alpha;
    } else {
      this.remote.x = rs.x;
      this.remote.y = rs.y;
      this.remote.facing = rs.facing100 / 100;
    }
    this.remote.dead = rs.dead;
    this.remote.iframes = rs.ifr;
    this.remote.hp = rs.hp;
  }

  private interpAlpha(): number {
    if (this.snapArrivedAt === 0) return 1;
    return clamp((performance.now() - this.snapArrivedAt) / this.snapIntervalMs, 0, 1);
  }

  // ————— render —————

  render(ctx: CanvasRenderingContext2D): void {
    const vp = this.deps.game.vp;
    const { w, h } = vp;
    const time = this.deps.game.time;
    const alpha = this.interpAlpha();
    const snap = this.currSnap;
    const gfx = this.deps.save.data.settings.graphics;

    const s = this.trauma * this.trauma;
    const sx = (Math.random() * 2 - 1) * 13 * s;
    const sy = (Math.random() * 2 - 1) * 13 * s;

    this.bg.render(ctx, this.camX - w / 2 + sx, this.camY - h / 2 + sy, w, h, time, gfx.background);

    ctx.save();
    ctx.translate(w / 2 - this.camX + sx, h / 2 - this.camY + sy);
    this.replica.renderPickups(ctx, alpha, time, this.camX, this.camY, w, h);
    this.replica.renderEnemyShots(ctx, alpha, time, this.camX, this.camY, w, h);
    this.replica.renderEnemies(ctx, alpha, time, this.camX, this.camY, w, h);
    this.remote.render(ctx, time);
    this.local.render(ctx, time);
    this.replica.renderPlayerShots(ctx, alpha, this.camX, this.camY, w, h);
    this.particles.render(ctx);
    this.floaters.render(ctx);
    ctx.restore();

    if (gfx.vignette) this.bg.renderVignette(ctx, w, h);

    if (this.sectorFlash > 0) {
      ctx.globalAlpha = Math.pow(this.sectorFlash, 1.6) * 0.5;
      ctx.fillStyle = this.sectorFlashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    this.renderEnemyArrow(ctx, w, h, snap, time, gfx.glow);
    this.renderPartnerArrow(ctx, w, h);
    this.deps.game.input.renderStick(ctx, gfx.glow, true);

    if (snap) {
      const me = snap.players.find((p) => p.slot === this.deps.localSlot);
      const partner = snap.players.find((p) => p.slot === this.remote.slot) ?? null;
      const hv = this.hudView;
      if (me) {
        hv.hp = me.hp;
        hv.maxHp = me.maxHp;
        hv.level = me.level;
        hv.xp = me.xp;
        hv.xpNeed = me.xpNeed;
        hv.coins = me.coins;
      }
      hv.wave = snap.wave;
      hv.remaining = snap.waveLeft;
      hv.runTime = snap.tick / SIM_RATE;
      hv.combo = 0;
      hv.boss = snap.boss
        ? { hp: snap.boss[0], maxHp: snap.boss[1], name: sectorForWave(snap.wave).boss.name }
        : null;
      hv.partner = partner
        ? {
            name: this.deps.names[partner.slot] ?? 'PARCEIRO',
            hp: partner.hp,
            maxHp: partner.maxHp,
            level: partner.level,
            dead: partner.dead,
            choosing: partner.choosing,
          }
        : null;
      hv.ping = Math.round(this.deps.socket.rttMs);
      this.hud.render(ctx, hv, vp, time, gfx.glow);
    }
  }

  /** Edge arrow pointing at the partner whenever they're off-screen. */
  private renderPartnerArrow(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.currSnap || this.local.dead) return;
    const sx = this.remote.x - this.camX + w / 2;
    const sy = this.remote.y - this.camY + h / 2;
    const margin = 26;
    if (sx > -margin && sx < w + margin && sy > -margin && sy < h + margin) return;

    const cx = w / 2;
    const cy = h / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    // Clamp the arrow to the screen border along the partner's direction.
    const tx = Math.cos(ang);
    const ty = Math.sin(ang);
    const kx = tx !== 0 ? (w / 2 - margin) / Math.abs(tx) : Infinity;
    const ky = ty !== 0 ? (h / 2 - margin) / Math.abs(ty) : Infinity;
    const k = Math.min(kx, ky);
    const ax = cx + tx * k;
    const ay = cy + ty * k;

    const color = this.remote.dead ? '#ff5d73' : '#b45cff';
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    if (this.deps.save.data.settings.graphics.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Executa a transição visual de setor (banner, bg, música, flash). */
  private commitSector(sector: import('../sectors.js').SectorDef, number: number): void {
    this.deps.ui.banner(`SETOR ${number} — ${sector.name}`, sector.subtitle, true);
    this.bg.setTheme(sector.background);
    this.deps.music.setTheme(sector.music);
    this.deps.music.intensity = 0.35;
    this.sectorFlash = 1;
    this.sectorFlashColor = sector.accent;
    this.shake(24);
  }

  /**
   * Seta na borda da tela apontando pro inimigo mais próximo,
   * ativada após 25s sem abates. A cor varia com a distância:
   * verde (muito longe) → âmbar (perto). Toca um som ao aparecer.
   */
  private renderEnemyArrow(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snap | null, time: number, glow: boolean): void {
    if (!snap || this.local.dead) return;
    const simSeconds = snap.tick / SIM_RATE;
    const idleTime = simSeconds - (this.lastKillTick / SIM_RATE);
    if (idleTime < 25) return;

    const target = this.replica.nearestEnemy(this.local.x, this.local.y, Infinity);
    if (!target) return;

    // Toca o som uma vez quando a seta aparece (reseta ao matar).
    if (!this.arrowSoundPlayed) {
      this.arrowSoundPlayed = true;
      this.deps.audio.play('arrow');
    }

    const sx = target.x - this.camX + w / 2;
    const sy = target.y - this.camY + h / 2;
    const margin = 28;
    if (sx > -margin && sx < w + margin && sy > -margin && sy < h + margin) return;

    const cx = w / 2;
    const cy = h / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const tx = Math.cos(ang);
    const ty = Math.sin(ang);
    const kx = tx !== 0 ? (w / 2 - margin) / Math.abs(tx) : Infinity;
    const ky = ty !== 0 ? (h / 2 - margin) / Math.abs(ty) : Infinity;
    const k = Math.min(kx, ky);
    const ax = cx + tx * k;
    const ay = cy + ty * k;

    // Distância mundo real do jogador ao inimigo (pra cor).
    const worldDist = Math.sqrt(
      (target.x - this.local.x) ** 2 + (target.y - this.local.y) ** 2,
    );
    // Cor: verde (longe, >= 1200px) → âmbar (perto, <= 300px).
    const t = Math.max(0, Math.min(1, (worldDist - 300) / (1200 - 300)));
    const color = lerpColor('#ffc857', '#52ffa8', t);

    // Pulse mais visível: alpha entre 0.35 e 0.75
    const pulse = 0.55 + Math.sin(time * 4) * 0.2;
    // Seta maior (1.5x)
    const s = 1.5;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = color;
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.moveTo(12 * s, 0);
    ctx.lineTo(-8 * s, 8 * s);
    ctx.lineTo(-4 * s, 0);
    ctx.lineTo(-8 * s, -8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/** Interpola duas cores hex (#rrggbb) por um fator t [0-1]. */
function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${rr.toString(16).padStart(2, '0')}${rg.toString(16).padStart(2, '0')}${rb.toString(16).padStart(2, '0')}`;
}

export type { PlayerSnap };

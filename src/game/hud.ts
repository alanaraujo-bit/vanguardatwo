import type { Viewport } from '../core/viewport';
import { clamp, fmtTime, roundRectPath } from '../core/utils';
import { BAL } from './balance';

export interface HudView {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNeed: number;
  wave: number;
  runTime: number;
  coins: number;
  combo: number;
  boss: { hp: number; maxHp: number; name: string } | null;
  /** Guided tutorial pins wave at 1 and shows its own skip button up top; skip the pill to avoid overlap. */
  hideWave?: boolean;
  /** Co-op: the other pilot's vitals, shown as a mini panel under the level chip. */
  partner?: {
    name: string;
    hp: number;
    maxHp: number;
    level: number;
    dead: boolean;
    choosing: boolean;
  } | null;
  /** Co-op: smoothed round-trip time in ms. */
  ping?: number;
}

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
const MARGIN = 12;

export class Hud {
  private lastCombo = 0;
  private comboPop = 0;
  private lastTime = 0;
  private redVignette: HTMLCanvasElement | null = null;
  private redKey = '';

  render(ctx: CanvasRenderingContext2D, v: HudView, vp: Viewport, time: number): void {
    const dt = clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;
    const w = vp.w;
    const h = vp.h;
    const top = vp.safeTop;
    const bottom = vp.safeBottom;

    // Low HP warning underlay.
    const hpRatio = v.maxHp > 0 ? v.hp / v.maxHp : 0;
    if (hpRatio < 0.35 && v.hp > 0) {
      const pulse = 0.5 + Math.sin(time * 6) * 0.5;
      this.drawRedVignette(ctx, w, h, (0.35 - hpRatio) * 1.6 * (0.4 + 0.6 * pulse));
    }

    // XP bar across the very top, below safe-area.
    const xpY = top + 6;
    this.bar(ctx, MARGIN, xpY, w - MARGIN * 2, 4, 2, 'rgba(255,255,255,0.09)');
    const xpRatio = clamp(v.xp / v.xpNeed, 0, 1);
    if (xpRatio > 0.01) {
      const g = ctx.createLinearGradient(MARGIN, 0, w - MARGIN, 0);
      g.addColorStop(0, '#35f0ff');
      g.addColorStop(1, '#52ffa8');
      this.bar(ctx, MARGIN, xpY, (w - MARGIN * 2) * xpRatio, 4, 2, g);
    }

    // Main HUD row: HP | Level | Wave | Timer | Coins, all at same baseline.
    const hudY = top + 18;
    const hudGap = 8;
    const cellHeight = 18;
    const smallFont = `700 10px ${FONT}`;
    const mediumFont = `800 12px ${FONT}`;
    const padding = 2;

    // Left side: HP + Level stacked.
    const hpW = Math.min(100, (w - MARGIN * 2 - hudGap * 2) * 0.2);
    this.bar(ctx, MARGIN, hudY, hpW, cellHeight, 6, 'rgba(6,10,24,0.72)');
    if (hpRatio > 0) {
      const color = hpRatio < 0.35 ? '#ff3b5c' : '#52ffa8';
      this.bar(ctx, MARGIN + padding, hudY + padding, (hpW - padding * 2) * hpRatio, cellHeight - padding * 2, 5, color, 0.9);
    }
    ctx.font = smallFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(2,8,16,0.9)';
    ctx.fillText(`${Math.ceil(v.hp)}`, MARGIN + hpW / 2, hudY + cellHeight / 2);

    // Level chip below HP.
    ctx.font = `800 10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7df3ff';
    ctx.fillText(`NV${v.level}`, MARGIN + padding, hudY + cellHeight + 10);

    // Center left: Wave pill (if not hidden).
    let centerX = w / 2;
    if (!v.hideWave) {
      const waveText = `ONDA ${v.wave}`;
      ctx.font = mediumFont;
      const tw = ctx.measureText(waveText).width;
      const pillW = Math.min(tw + 18, w * 0.25);
      const pillX = centerX - pillW / 2;
      this.bar(ctx, pillX, hudY, pillW, cellHeight, 6, 'rgba(6,10,24,0.72)');
      ctx.strokeStyle = 'rgba(53,240,255,0.35)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, pillX, hudY, pillW, cellHeight, 6);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eaf6ff';
      ctx.fillText(waveText, centerX, hudY + cellHeight / 2);
    }

    // Right side: Timer + Coins stacked, clearing pause button.
    const rightX = w - MARGIN - Math.max(50, w * 0.15);
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText(fmtTime(v.runTime), rightX, hudY + 6);

    ctx.font = `800 10px ${FONT}`;
    ctx.fillStyle = '#ffc857';
    const coinText = `${v.coins}`;
    ctx.fillText(coinText, rightX, hudY + cellHeight + 4);
    const ctw = ctx.measureText(coinText).width;
    ctx.beginPath();
    ctx.arc(rightX - ctw - 8, hudY + cellHeight + 4, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc857';
    ctx.fill();

    // Co-op: partner vitals under the level chip.
    if (v.partner) {
      const p = v.partner;
      const py = hudY + cellHeight + 18;
      const pw = Math.min(88, hpW);
      ctx.font = `700 9px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = p.dead ? '#ff5d73' : '#9ff2ff';
      const label = p.dead ? `${p.name} · CAÍDO` : p.choosing ? `${p.name} · ESCOLHENDO…` : `${p.name} · NV${p.level}`;
      ctx.fillText(label.slice(0, 26), MARGIN, py);
      this.bar(ctx, MARGIN, py + 5, pw, 6, 3, 'rgba(6,10,24,0.72)');
      const pr = p.maxHp > 0 ? clamp(p.hp / p.maxHp, 0, 1) : 0;
      if (pr > 0 && !p.dead) {
        this.bar(ctx, MARGIN + 1, py + 6, (pw - 2) * pr, 4, 2, pr < 0.35 ? '#ff3b5c' : '#52ffa8', 0.9);
      }
    }

    // Co-op: ping under the coins counter.
    if (v.ping !== undefined && v.ping > 0) {
      ctx.font = `700 9px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = v.ping < 90 ? 'rgba(125,243,255,0.7)' : v.ping < 180 ? '#ffc857' : '#ff5d73';
      ctx.fillText(`${v.ping}ms`, rightX, hudY + cellHeight + 18);
    }

    // Combo counter below main row.
    if (v.combo > this.lastCombo) this.comboPop = 1;
    this.lastCombo = v.combo;
    this.comboPop = Math.max(0, this.comboPop - dt * 5);
    if (v.combo >= BAL.combo.showFrom) {
      const size = 16 + this.comboPop * 6;
      ctx.font = `900 ${size.toFixed(0)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ffc857';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffc857';
      ctx.fillText(`x${v.combo}`, w / 2, hudY + cellHeight + 24);
      ctx.shadowBlur = 0;
    }

    // Boss health, positioned to avoid bottom safe-area.
    if (v.boss) {
      const bw = Math.min(280, w - MARGIN * 2);
      const bx = w / 2 - bw / 2;
      const by = h - bottom - 50;
      ctx.font = `800 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff9eb5';
      ctx.fillText(v.boss.name.toUpperCase().split('').join(' '), w / 2, by - 4);
      this.bar(ctx, bx, by + 4, bw, 7, 3, 'rgba(6,10,24,0.72)');
      const ratio = clamp(v.boss.hp / v.boss.maxHp, 0, 1);
      this.bar(ctx, bx + 1, by + 5, (bw - 2) * ratio, 5, 2, '#ff2e63', 0.95);
    }
  }

  private bar(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
    fill: string | CanvasGradient, alpha = 1,
  ): void {
    if (w <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawRedVignette(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
    const key = `${w}x${h}`;
    if (this.redKey !== key) {
      this.redKey = key;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w / 4));
      c.height = Math.max(1, Math.round(h / 4));
      const vctx = c.getContext('2d');
      if (vctx) {
        const r = Math.hypot(c.width, c.height) / 2;
        const g = vctx.createRadialGradient(c.width / 2, c.height / 2, r * 0.4, c.width / 2, c.height / 2, r);
        g.addColorStop(0, 'rgba(255,30,60,0)');
        g.addColorStop(1, 'rgba(255,30,60,0.85)');
        vctx.fillStyle = g;
        vctx.fillRect(0, 0, c.width, c.height);
      }
      this.redVignette = c;
    }
    if (this.redVignette) {
      ctx.globalAlpha = clamp(alpha, 0, 0.8);
      ctx.drawImage(this.redVignette, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }
}

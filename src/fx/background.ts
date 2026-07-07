import { hash2, TAU } from '../core/utils';
import { glowDot, softDot, drawSprite, type Sprite } from './sprites';

const GRID = 52;
const HEX_SIDE = 30;
const STAR_CELL = 140;
const NEBULA_CELL = 760;

/** Everything that gives a sector's backdrop its identity. */
export interface BackgroundTheme {
  /** Vertical gradient stops: top, middle, bottom. */
  gradient: readonly [string, string, string];
  /** Parallax blob colors (rgba with alpha baked in). */
  nebulas: readonly [string, string, string];
  star: string;
  /** Grid line color (rgba with alpha baked in). */
  grid: string;
  gridStyle: 'square' | 'hex';
}

/** Sector 1's deep-space look — also the menu backdrop. */
export const DEFAULT_BG_THEME: BackgroundTheme = {
  gradient: ['#070a16', '#05070f', '#080714'],
  nebulas: ['rgba(38, 70, 160, 0.5)', 'rgba(110, 38, 130, 0.45)', 'rgba(18, 100, 120, 0.45)'],
  star: '#9fd8ff',
  grid: 'rgba(70, 110, 210, 0.09)',
  gridStyle: 'square',
};

/**
 * Infinite scrolling backdrop: deep gradient, parallax nebula blobs and
 * stars (deterministically placed via coordinate hashing, so the world is
 * stable without storing anything), plus a fine grid that anchors motion.
 * The whole look is swappable per sector via `setTheme`.
 */
export class Background {
  private vignette: HTMLCanvasElement | null = null;
  private vignetteKey = '';
  private theme: BackgroundTheme = DEFAULT_BG_THEME;
  private nebulas: Sprite[] = [];
  private star!: Sprite;
  private hexPattern: CanvasPattern | null = null;
  private hexTileW = 0;
  private hexTileH = 0;

  constructor() {
    this.bake();
  }

  setTheme(theme: BackgroundTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.bake();
  }

  private bake(): void {
    const t = this.theme;
    this.nebulas = t.nebulas.map((c) => softDot(100, c));
    this.star = glowDot(3, t.star);
    this.hexPattern = t.gridStyle === 'hex' ? this.bakeHexPattern(t.grid) : null;
  }

  /**
   * Honeycomb lattice baked once into a repeating pattern tile — rendering
   * the grid is then a single pattern fill instead of thousands of lineTo.
   */
  private bakeHexPattern(color: string): CanvasPattern | null {
    const a = HEX_SIDE;
    const hh = Math.sin(Math.PI / 3) * a; // half hex height
    this.hexTileW = 3 * a;
    this.hexTileH = 2 * hh;
    const c = document.createElement('canvas');
    c.width = Math.round(this.hexTileW);
    c.height = Math.round(this.hexTileH);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Flat-top hexes: columns 1.5a apart, odd columns shifted half a row.
    // Drawing every hex touching the tile keeps the pattern seamless.
    for (let cx = -1; cx <= 2; cx++) {
      for (let cy = -1; cy <= 2; cy++) {
        const hx = cx * 1.5 * a;
        const hy = cy * 2 * hh + (((cx % 2) + 2) % 2) * hh;
        for (let i = 0; i <= 6; i++) {
          const ang = (i / 6) * TAU;
          const x = hx + Math.cos(ang) * a;
          const y = hy + Math.sin(ang) * a;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
    return ctx.createPattern(c, 'repeat');
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, time: number): void {
    const t = this.theme;

    // Base
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, t.gradient[0]);
    g.addColorStop(0.5, t.gradient[1]);
    g.addColorStop(1, t.gradient[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Nebula blobs, slow parallax
    this.layerCells(ctx, camX, camY, w, h, NEBULA_CELL, 0.35, (sx, sy, r1, r2) => {
      const spr = this.nebulas[Math.floor(r1 * this.nebulas.length)];
      const pulse = 1 + Math.sin(time * 0.3 + r2 * TAU) * 0.08;
      drawSprite(ctx, spr, sx, sy, 0, (1.4 + r2 * 1.6) * pulse, 0.35 + r2 * 0.25);
    });

    // Stars, medium parallax
    this.layerCells(ctx, camX, camY, w, h, STAR_CELL, 0.6, (sx, sy, r1, r2) => {
      if (r1 > 0.72) return; // sparse
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * (0.5 + r2) + r1 * TAU));
      drawSprite(ctx, this.star, sx, sy, 0, 0.5 + r2 * 0.9, tw * 0.8);
    });
    ctx.globalAlpha = 1;

    // Grid, 1:1 with world (grounds the sense of movement)
    if (t.gridStyle === 'hex' && this.hexPattern) {
      const ox = -(((camX % this.hexTileW) + this.hexTileW) % this.hexTileW);
      const oy = -(((camY % this.hexTileH) + this.hexTileH) % this.hexTileH);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = this.hexPattern;
      ctx.fillRect(-ox, -oy, w, h);
      ctx.restore();
    } else {
      ctx.strokeStyle = t.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ox = -(camX % GRID);
      const oy = -(camY % GRID);
      for (let x = ox; x < w; x += GRID) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = oy; y < h; y += GRID) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }
  }

  /** Deterministic sprite placement per world-space cell with parallax factor. */
  private layerCells(
    ctx: CanvasRenderingContext2D,
    camX: number, camY: number, w: number, h: number,
    cell: number, parallax: number,
    draw: (sx: number, sy: number, r1: number, r2: number) => void,
  ): void {
    const px = camX * parallax;
    const py = camY * parallax;
    const x0 = Math.floor(px / cell) - 1;
    const y0 = Math.floor(py / cell) - 1;
    const x1 = Math.floor((px + w) / cell) + 1;
    const y1 = Math.floor((py + h) / cell) + 1;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const r1 = hash2(cx, cy);
        const r2 = hash2(cx * 7 + 3, cy * 13 + 1);
        const wx = (cx + 0.15 + r1 * 0.7) * cell;
        const wy = (cy + 0.15 + r2 * 0.7) * cell;
        draw(wx - px, wy - py, r1, r2);
      }
    }
  }

  renderVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const key = `${w}x${h}`;
    if (this.vignetteKey !== key) {
      this.vignetteKey = key;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w / 4));
      c.height = Math.max(1, Math.round(h / 4));
      const vctx = c.getContext('2d');
      if (vctx) {
        const r = Math.hypot(c.width, c.height) / 2;
        const g = vctx.createRadialGradient(
          c.width / 2, c.height / 2, r * 0.45,
          c.width / 2, c.height / 2, r,
        );
        g.addColorStop(0, 'rgba(2,3,10,0)');
        g.addColorStop(1, 'rgba(2,3,10,0.6)');
        vctx.fillStyle = g;
        vctx.fillRect(0, 0, c.width, c.height);
      }
      this.vignette = c;
    }
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, w, h);
  }
}

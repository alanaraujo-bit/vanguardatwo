/**
 * All game art is procedural neon vector work, baked once into offscreen
 * canvases at startup. Baking lets us use expensive effects (shadowBlur glow)
 * for free at runtime — drawing a sprite is a single drawImage call.
 */

export interface Sprite {
  img: HTMLCanvasElement;
  /** Half of the canvas size; sprites are drawn centered. */
  half: number;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D não suportado');
  return [c, ctx];
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  s: Sprite,
  x: number, y: number,
  rot = 0, scale = 1, alpha = 1,
): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  if (rot === 0 && scale === 1) {
    ctx.drawImage(s.img, x - s.half, y - s.half);
  } else {
    ctx.save();
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate(rot);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(s.img, -s.half, -s.half);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Soft radial glow dot — the workhorse of every particle effect. */
export function glowDot(radius: number, color: string): Sprite {
  const size = radius * 4;
  const [img, ctx] = makeCanvas(size);
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, radius * 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return { img, half: c };
}

/** Glow without the white-hot center — for nebulas and ambient washes. */
export function softDot(radius: number, color: string): Sprite {
  const size = radius * 4;
  const [img, ctx] = makeCanvas(size);
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, radius * 2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return { img, half: c };
}

export type ShapePoints = ReadonlyArray<readonly [number, number]>;

export interface ShapeOptions {
  radius: number;
  color: string;
  /** Regular polygon side count (ignored when `points` is given). */
  sides?: number;
  /** Custom polygon in unit coordinates, scaled by `radius`. */
  points?: ShapePoints;
  rotate?: number;
  lineWidth?: number;
  fillAlpha?: number;
  /** Draw a smaller echo of the outline inside the shape. */
  innerDetail?: boolean;
}

function tracePath(ctx: CanvasRenderingContext2D, o: ShapeOptions, scale: number): void {
  ctx.beginPath();
  if (o.points) {
    o.points.forEach(([px, py], i) => {
      const x = px * o.radius * scale;
      const y = py * o.radius * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  } else {
    const sides = o.sides ?? 3;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * o.radius * scale;
      const y = Math.sin(a) * o.radius * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

/** Neon-outlined polygon: colored glow halo, bright body, white-hot core line. */
export function shapeSprite(o: ShapeOptions): Sprite {
  const pad = o.radius * 2.6;
  const size = pad * 2;
  const [img, ctx] = makeCanvas(size);
  ctx.translate(pad, pad);
  if (o.rotate) ctx.rotate(o.rotate);

  const lw = o.lineWidth ?? Math.max(2.5, o.radius * 0.22);

  ctx.shadowColor = o.color;
  ctx.shadowBlur = o.radius * 0.9;
  ctx.strokeStyle = o.color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  tracePath(ctx, o, 1);
  ctx.globalAlpha = o.fillAlpha ?? 0.16;
  ctx.fillStyle = o.color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.stroke(); // double pass strengthens the halo

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(1.1, lw * 0.38);
  tracePath(ctx, o, 1);
  ctx.stroke();

  if (o.innerDetail) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(1, lw * 0.3);
    tracePath(ctx, o, 0.55);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  return { img, half: pad };
}

/** Player ship: a sharp chevron pointing +X. */
export const SHIP_POINTS: ShapePoints = [
  [1.05, 0], [-0.75, 0.72], [-0.38, 0], [-0.75, -0.72],
];

/** Fast enemy dart pointing +X. */
export const DART_POINTS: ShapePoints = [
  [1.15, 0], [-0.7, 0.5], [-0.35, 0], [-0.7, -0.5],
];

/** Player projectile: elongated bolt pointing +X. */
export const BOLT_POINTS: ShapePoints = [
  [1.5, 0], [0, 0.45], [-1, 0], [0, -0.45],
];

/** Orbital blade: slim crescent-ish sliver pointing +X. */
export const BLADE_POINTS: ShapePoints = [
  [1.2, 0], [-0.5, 0.42], [-0.15, 0], [-0.5, -0.42],
];

/** Pickup gem: tall rhombus. */
export const GEM_POINTS: ShapePoints = [
  [0, -1.1], [0.7, 0], [0, 1.1], [-0.7, 0],
];

/** Hive stinger: barbed dart with swept-back wings, pointing +X. */
export const STINGER_POINTS: ShapePoints = [
  [1.25, 0], [-0.1, 0.38], [-0.8, 0.78], [-0.45, 0], [-0.8, -0.78], [-0.1, -0.38],
];

/** Hive queen: a 12-point crown star. */
export const QUEEN_POINTS: ShapePoints = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
  const r = i % 2 === 0 ? 1.05 : 0.62;
  return [Math.cos(a) * r, Math.sin(a) * r] as const;
});

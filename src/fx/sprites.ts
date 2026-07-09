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

/** Magnetic archive glyph: offset chevrons, like a corrupted cursor. */
export const GLYPH_POINTS: ShapePoints = [
  [-0.85, -0.8], [0.75, -0.35], [0.35, 0], [0.95, 0.62], [-0.55, 0.82], [-0.2, 0.12],
];

/** Archive needle: long railgun splinter pointing +X. */
export const NEEDLE_POINTS: ShapePoints = [
  [1.35, 0], [0.15, 0.28], [-0.95, 0.16], [-0.48, 0], [-0.95, -0.16], [0.15, -0.28],
];

/** Magnetic mine: faceted diamond with a clipped core. */
export const MINE_POINTS: ShapePoints = [
  [0, -1.1], [0.86, -0.3], [0.66, 0.68], [0, 1.05], [-0.66, 0.68], [-0.86, -0.3],
];

/** Archivist boss: asymmetric data crown, not a hive star or regular polygon. */
export const ARCHIVIST_POINTS: ShapePoints = [
  [0, -1.1], [0.34, -0.56], [1.04, -0.74], [0.66, -0.1], [0.98, 0.66], [0.22, 0.5],
  [0, 1.08], [-0.22, 0.5], [-0.98, 0.66], [-0.66, -0.1], [-1.04, -0.74], [-0.34, -0.56],
];

// ——— Setor 4: Estação Gélida ———

/** Ice shard: sharp asymmetric splinter pointing +X. */
export const SHARD_POINTS: ShapePoints = [
  [1.2, 0], [0.5, 0.35], [-0.2, 0.28], [-0.7, 0.12], [-0.9, 0.45], [-0.5, 0],
  [-0.9, -0.45], [-0.7, -0.12], [-0.2, -0.28], [0.5, -0.35],
];

/** Snowflake: crystalline branching shape. */
export const FLAKE_POINTS: ShapePoints = [
  [0, -1.1], [0.15, -0.6], [0.35, -0.9], [0.25, -0.4], [0.6, -0.5], [0.3, -0.15],
  [0.85, -0.25], [0.35, 0], [0.85, 0.25], [0.3, 0.15], [0.6, 0.5], [0.25, 0.4],
  [0.35, 0.9], [0.15, 0.6], [0, 1.1], [-0.15, 0.6], [-0.35, 0.9], [-0.25, 0.4],
  [-0.6, 0.5], [-0.3, 0.15], [-0.85, 0.25], [-0.35, 0], [-0.85, -0.25], [-0.3, -0.15],
  [-0.6, -0.5], [-0.25, -0.4], [-0.35, -0.9], [-0.15, -0.6],
];

/** Geyser spire: tall tapering crystal pointing up. */
export const GEYSER_POINTS: ShapePoints = [
  [0, -1.1], [0.38, -0.4], [0.45, 0.2], [0.24, 0.58], [0.06, 0.92], [-0.06, 0.92],
  [-0.24, 0.58], [-0.45, 0.2], [-0.38, -0.4],
];

/** Glacier: bulky irregular hexagon. */
export const GLACIER_POINTS: ShapePoints = [
  [0.3, -1.05], [0.78, -0.7], [1.05, -0.15], [0.85, 0.5], [0.35, 0.92], [-0.25, 1.05],
  [-0.72, 0.78], [-1.05, 0.2], [-0.9, -0.4], [-0.5, -0.9],
];

/** Zero Absoluto boss: complex crystal crown formation. */
export const ZERO_POINTS: ShapePoints = [
  [0, -1.1], [0.24, -0.7], [0.5, -0.92], [0.44, -0.44], [0.92, -0.5], [0.7, -0.18],
  [1.06, 0], [0.7, 0.18], [0.92, 0.5], [0.44, 0.44], [0.5, 0.92], [0.24, 0.7],
  [0, 1.1], [-0.24, 0.7], [-0.5, 0.92], [-0.44, 0.44], [-0.92, 0.5], [-0.7, 0.18],
  [-1.06, 0], [-0.7, -0.18], [-0.92, -0.5], [-0.44, -0.44], [-0.5, -0.92], [-0.24, -0.7],
];

// ——— Setor 5: Zona Tóxica ———

/** Fume gas bag: asymmetrical balloon-like shape, wider at the top. */
export const FUME_POINTS: ShapePoints = [
  [0, -1.05], [0.65, -0.7], [0.95, -0.2], [0.85, 0.35], [0.5, 0.72], [0, 0.92],
  [-0.45, 0.78], [-0.78, 0.45], [-0.95, -0.1], [-0.75, -0.55], [-0.3, -0.85],
];

/** Miasma boss: organic reactor core - 10-point irregular star with uneven arms. */
export const MIASMA_POINTS: ShapePoints = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
  const r = i % 2 === 0 ? 1.05 : 0.5 + (i * 0.07);
  return [Math.cos(a) * r, Math.sin(a) * r] as const;
});

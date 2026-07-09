import type { SaveData } from '../core/save';
import { BAL } from './balance';
import { metaLevel } from './meta';

/** Fully-resolved player stats: base + permanent meta + in-run upgrades. */
export interface Stats {
  maxHp: number;
  speed: number;
  damage: number;
  fireInterval: number;
  projSpeed: number;
  projectiles: number;
  pierce: number;
  bounce: number;
  critChance: number;
  critMult: number;
  magnet: number;
  regen: number;
  coinMult: number;
  novaLevel: number;
  bladeLevel: number;
  fragLevel: number;
}

export type IconPainter = (ctx: CanvasRenderingContext2D, s: number) => void;

export interface UpgradeDef {
  id: string;
  name: string;
  color: string;
  max: number;
  weight: number;
  desc: (nextLevel: number) => string;
  icon: string;
}

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  {
    id: 'power', name: 'Sobrecarga', color: '#ff5d73', max: 5, weight: 10,
    desc: () => 'Dano +20%', icon: 'power',
  },
  {
    id: 'rate', name: 'Gatilho Rápido', color: '#35f0ff', max: 5, weight: 10,
    desc: () => 'Cadência de tiro +15%', icon: 'rate',
  },
  {
    id: 'multi', name: 'Disparo Múltiplo', color: '#ffc857', max: 3, weight: 7,
    desc: () => '+1 projétil por disparo', icon: 'multi',
  },
  {
    id: 'pierce', name: 'Perfurante', color: '#c56cf0', max: 3, weight: 7,
    desc: () => 'Projéteis atravessam +1 inimigo', icon: 'pierce',
  },
  {
    id: 'ricochet', name: 'Ricochete', color: '#52ffa8', max: 3, weight: 7,
    desc: () => 'Projéteis saltam para +1 alvo próximo', icon: 'ricochet',
  },
  {
    id: 'crit', name: 'Impacto Crítico', color: '#ffc857', max: 4, weight: 8,
    desc: () => 'Chance crítica +10% (dano em dobro)', icon: 'crit',
  },
  {
    id: 'blades', name: 'Lâminas Orbitais', color: '#35f0ff', max: 4, weight: 8,
    desc: (lv) => lv === 1 ? 'Invoca lâminas que orbitam você' : '+1 lâmina orbital e mais dano', icon: 'blades',
  },
  {
    id: 'nova', name: 'Pulso Nova', color: '#f368e0', max: 4, weight: 8,
    desc: (lv) => lv === 1 ? 'Emite ondas de choque periódicas' : 'Nova maior, mais forte e mais frequente', icon: 'nova',
  },
  {
    id: 'magnet', name: 'Ímã Quântico', color: '#52ffa8', max: 3, weight: 6,
    desc: () => 'Raio de coleta +40%', icon: 'magnet',
  },
  {
    id: 'vital', name: 'Núcleo Vital', color: '#ff5d73', max: 4, weight: 8,
    desc: () => '+20 de vida máxima e recupera 35%', icon: 'vital',
  },
  {
    id: 'thrusters', name: 'Propulsores', color: '#35f0ff', max: 3, weight: 6,
    desc: () => 'Velocidade de movimento +8%', icon: 'thrusters',
  },
  {
    id: 'regen', name: 'Regeneração', color: '#52ffa8', max: 3, weight: 6,
    desc: () => 'Recupera 0,6 de vida por segundo', icon: 'regen',
  },
  {
    id: 'frag', name: 'Fragmentação', color: '#ff9f43', max: 3, weight: 6,
    desc: (lv) => lv === 1 ? 'Inimigos explodem ao serem destruídos' : 'Explosões maiores e mais fortes', icon: 'frag',
  },
];

export function computeStats(save: SaveData, level: (id: string) => number): Stats {
  const p = BAL.player;
  const meta = (id: string) => metaLevel(save, id);
  return {
    maxHp: p.hp + 12 * meta('hull') + 20 * level('vital'),
    speed: p.speed * (1 + 0.04 * meta('thrust') + 0.08 * level('thrusters')),
    damage: p.damage * (1 + 0.08 * meta('core') + 0.2 * level('power')),
    fireInterval: p.fireInterval / (1 + 0.15 * level('rate')),
    projSpeed: p.projSpeed,
    projectiles: 1 + level('multi'),
    pierce: level('pierce'),
    bounce: level('ricochet'),
    critChance: p.critChance + 0.03 * meta('luck') + 0.1 * level('crit'),
    critMult: p.critMult,
    magnet: p.magnet * (1 + 0.14 * meta('magnet') + 0.4 * level('magnet')),
    regen: 0.6 * level('regen'),
    coinMult: 1 + 0.1 * meta('greed'),
    novaLevel: level('nova'),
    bladeLevel: level('blades'),
    fragLevel: level('frag'),
  };
}

/** Weighted sample (without replacement) of upgrades that are not maxed out. */
export function rollChoices(level: (id: string) => number, count = 3, banned?: ReadonlySet<string>): UpgradeDef[] {
  const pool = UPGRADE_DEFS.filter((u) => level(u.id) < u.max && !banned?.has(u.id));
  const picks: UpgradeDef[] = [];
  while (picks.length < count && pool.length > 0) {
    const total = pool.reduce((sum, u) => sum + u.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

// ————— Icon painters (shared by level-up cards and the hangar shop) —————

const PAINTERS: Record<string, IconPainter> = {
  power: (c, s) => {
    star(c, s / 2, s / 2, s * 0.38, s * 0.16, 4, Math.PI / 4);
  },
  rate: (c, s) => {
    for (let i = 0; i < 3; i++) {
      const x = s * 0.28 + i * s * 0.18;
      chevronRight(c, x, s / 2, s * 0.16);
    }
  },
  multi: (c, s) => {
    for (const a of [-0.5, 0, 0.5]) {
      c.beginPath();
      c.moveTo(s * 0.3, s * 0.62);
      c.lineTo(s * 0.3 + Math.cos(a - Math.PI / 2) * s * 0.34 + s * 0.1, s * 0.62 + Math.sin(a - Math.PI / 2) * s * 0.34);
      c.stroke();
    }
  },
  pierce: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.12, s / 2);
    c.lineTo(s * 0.88, s / 2);
    c.stroke();
    chevronRight(c, s * 0.74, s / 2, s * 0.12);
  },
  ricochet: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.18, s * 0.3);
    c.lineTo(s * 0.5, s * 0.62);
    c.lineTo(s * 0.62, s * 0.28);
    c.lineTo(s * 0.84, s * 0.72);
    c.stroke();
  },
  crit: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(s / 2, s * 0.1); c.lineTo(s / 2, s * 0.32);
    c.moveTo(s / 2, s * 0.68); c.lineTo(s / 2, s * 0.9);
    c.moveTo(s * 0.1, s / 2); c.lineTo(s * 0.32, s / 2);
    c.moveTo(s * 0.68, s / 2); c.lineTo(s * 0.9, s / 2);
    c.stroke();
  },
  blades: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2);
    c.setLineDash([4, 5]);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.08, 0, Math.PI * 2);
    c.stroke();
    for (const a of [0, Math.PI]) {
      const x = s / 2 + Math.cos(a) * s * 0.32;
      const y = s / 2 + Math.sin(a) * s * 0.32;
      c.beginPath();
      c.arc(x, y, s * 0.07, 0, Math.PI * 2);
      c.fill();
    }
  },
  nova: (c, s) => {
    for (const r of [0.12, 0.24, 0.37]) {
      c.beginPath();
      c.arc(s / 2, s / 2, s * r, 0, Math.PI * 2);
      c.stroke();
    }
  },
  magnet: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s * 0.45, s * 0.26, Math.PI, 0);
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.24, s * 0.45); c.lineTo(s * 0.24, s * 0.72);
    c.moveTo(s * 0.76, s * 0.45); c.lineTo(s * 0.76, s * 0.72);
    c.stroke();
  },
  vital: (c, s) => {
    c.beginPath();
    c.moveTo(s / 2, s * 0.78);
    c.bezierCurveTo(s * 0.06, s * 0.44, s * 0.3, s * 0.14, s / 2, s * 0.36);
    c.bezierCurveTo(s * 0.7, s * 0.14, s * 0.94, s * 0.44, s / 2, s * 0.78);
    c.stroke();
  },
  thrusters: (c, s) => {
    c.beginPath();
    c.moveTo(s / 2, s * 0.12);
    c.lineTo(s * 0.68, s * 0.55);
    c.lineTo(s / 2, s * 0.45);
    c.lineTo(s * 0.32, s * 0.55);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.42, s * 0.65); c.lineTo(s * 0.38, s * 0.85);
    c.moveTo(s / 2, s * 0.62); c.lineTo(s / 2, s * 0.9);
    c.moveTo(s * 0.58, s * 0.65); c.lineTo(s * 0.62, s * 0.85);
    c.stroke();
  },
  regen: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(s / 2, s * 0.34); c.lineTo(s / 2, s * 0.66);
    c.moveTo(s * 0.34, s / 2); c.lineTo(s * 0.66, s / 2);
    c.stroke();
  },
  frag: (c, s) => {
    c.beginPath();
    c.moveTo(s / 2, s / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      c.moveTo(s / 2 + Math.cos(a) * s * 0.12, s / 2 + Math.sin(a) * s * 0.12);
      c.lineTo(s / 2 + Math.cos(a) * s * 0.36, s / 2 + Math.sin(a) * s * 0.36);
    }
    c.stroke();
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.08, 0, Math.PI * 2);
    c.fill();
  },
  coin: (c, s) => {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.16, 0, Math.PI * 2);
    c.stroke();
  },
  // ————— coin store icons (scale with pack size) —————
  coinBag: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.4, s * 0.22);
    c.lineTo(s * 0.6, s * 0.22);
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.4, s * 0.22);
    c.bezierCurveTo(s * 0.16, s * 0.32, s * 0.12, s * 0.62, s * 0.28, s * 0.8);
    c.bezierCurveTo(s * 0.38, s * 0.92, s * 0.62, s * 0.92, s * 0.72, s * 0.8);
    c.bezierCurveTo(s * 0.88, s * 0.62, s * 0.84, s * 0.32, s * 0.6, s * 0.22);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.arc(s * 0.5, s * 0.58, s * 0.1, 0, Math.PI * 2);
    c.stroke();
  },
  coinChest: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.16, s * 0.5);
    c.lineTo(s * 0.16, s * 0.8);
    c.lineTo(s * 0.84, s * 0.8);
    c.lineTo(s * 0.84, s * 0.5);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.16, s * 0.5);
    c.quadraticCurveTo(s * 0.5, s * 0.22, s * 0.84, s * 0.5);
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.42);
    c.lineTo(s * 0.5, s * 0.62);
    c.stroke();
    c.beginPath();
    c.arc(s * 0.5, s * 0.52, s * 0.07, 0, Math.PI * 2);
    c.stroke();
  },
  coinChestOpen: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.58);
    c.lineTo(s * 0.14, s * 0.82);
    c.lineTo(s * 0.86, s * 0.82);
    c.lineTo(s * 0.86, s * 0.58);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.58);
    c.lineTo(s * 0.22, s * 0.26);
    c.lineTo(s * 0.7, s * 0.22);
    c.stroke();
    for (const [dx, dy, r] of [[-0.16, 0.5, 0.09], [0.14, 0.46, 0.1], [0, 0.36, 0.08]] as const) {
      c.beginPath();
      c.arc(s * 0.5 + s * dx, s * dy, s * r, 0, Math.PI * 2);
      c.stroke();
    }
  },
};

function star(c: CanvasRenderingContext2D, cx: number, cy: number, r1: number, r2: number, points: number, rot: number): void {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (i / (points * 2)) * Math.PI * 2 + rot;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.stroke();
}

function chevronRight(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  c.beginPath();
  c.moveTo(x - size * 0.5, y - size);
  c.lineTo(x + size * 0.5, y);
  c.lineTo(x - size * 0.5, y + size);
  c.stroke();
}

/** Renders a named icon into a fresh canvas element for use in DOM UI. */
export function paintIcon(name: string, color: string, size = 44): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  const painter = PAINTERS[name];
  if (painter) {
    painter(ctx, size);
    // Second pass for a white-hot core.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.1;
    painter(ctx, size);
  }
  return canvas;
}

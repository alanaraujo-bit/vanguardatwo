import { DEFAULT_BG_THEME, type BackgroundTheme } from '../fx/background';
import { DEFAULT_MUSIC_THEME, type MusicTheme } from '../audio/music';
import type { EnemyKind } from './enemies';

/**
 * The campaign: every SECTOR_LEN waves the run travels to a new sector — a
 * full identity swap (name, enemy roster, boss, backdrop, soundtrack). When
 * the list runs out the sectors cycle, so wave scaling keeps the pressure up
 * and every new sector added here automatically extends the campaign.
 */

export const SECTOR_LEN = 10;

export interface PoolEntry {
  kind: EnemyKind;
  weight: number;
  /** Wave the kind starts appearing in, relative to the sector's first wave (1-based). */
  from: number;
  /** Weight lost per sector wave — fodder slowly gives way to specialists. */
  decay?: number;
  /** Weight floor when decaying. */
  floor?: number;
}

export interface SectorDef {
  id: string;
  /** Display name, uppercase — shown in the transition banner. */
  name: string;
  subtitle: string;
  /** Screen flash color when the run enters this sector. */
  accent: string;
  composition: readonly PoolEntry[];
  boss: {
    kind: EnemyKind;
    name: string;
    warnSub: string;
    defeatTitle: string;
    defeatSub: string;
  };
  background: BackgroundTheme;
  music: MusicTheme;
}

export const RUINA: SectorDef = {
  id: 'ruina',
  name: 'CAMPO DA RUÍNA',
  subtitle: 'O vazio onde a invasão começou',
  accent: '#ff2e63',
  composition: [
    { kind: 'drone', weight: 10, from: 1, decay: 0.2, floor: 4 },
    { kind: 'dart', weight: 6, from: 2 },
    { kind: 'splitter', weight: 4.5, from: 3 },
    { kind: 'wasp', weight: 4, from: 4 },
    { kind: 'tank', weight: 3, from: 6 },
  ],
  boss: {
    kind: 'boss',
    name: 'Colosso da Ruína',
    warnSub: 'ELE SENTIU SUA PRESENÇA',
    defeatTitle: 'COLOSSO DESTRUÍDO',
    defeatSub: 'A Ruína recua... por enquanto',
  },
  background: DEFAULT_BG_THEME,
  music: DEFAULT_MUSIC_THEME,
};

export const COLMEIA: SectorDef = {
  id: 'colmeia',
  name: 'A COLMEIA',
  subtitle: 'Algo vivo pulsa nas profundezas',
  accent: '#9dff2e',
  composition: [
    { kind: 'larva', weight: 9, from: 1, decay: 0.15, floor: 4 },
    { kind: 'spore', weight: 5, from: 1 },
    { kind: 'stinger', weight: 5, from: 2 },
    { kind: 'weaver', weight: 4, from: 3 },
    { kind: 'beetle', weight: 3, from: 4 },
  ],
  boss: {
    kind: 'queen',
    name: 'Rainha da Colmeia',
    warnSub: 'A COLMEIA INTEIRA CANTA PARA ELA',
    defeatTitle: 'RAINHA DESTRUÍDA',
    defeatSub: 'A Colmeia emudece... por enquanto',
  },
  background: {
    gradient: ['#0a1305', '#060d06', '#0c0e03'],
    nebulas: ['rgba(74, 138, 28, 0.5)', 'rgba(168, 122, 18, 0.45)', 'rgba(34, 116, 62, 0.45)'],
    star: '#d8ffa8',
    grid: 'rgba(150, 205, 60, 0.11)',
    gridStyle: 'hex',
  },
  // E phrygian pulse: Em — F — G — F, faster and darker than the home theme.
  music: {
    bpm: 132,
    bass: [41.2, 43.65, 49, 43.65],
    chords: [
      [164.81, 196, 246.94],
      [174.61, 220, 261.63],
      [196, 246.94, 293.66],
      [174.61, 220, 261.63],
    ],
    lead: 'triangle',
  },
};

export const ARQUIVO: SectorDef = {
  id: 'arquivo',
  name: 'O ARQUIVO MAGNÉTICO',
  subtitle: 'Dados mortos orbitam como lâminas',
  accent: '#35f0ff',
  composition: [
    { kind: 'glyph', weight: 9, from: 1, decay: 0.18, floor: 4 },
    { kind: 'needle', weight: 5.5, from: 1 },
    { kind: 'pylon', weight: 4.5, from: 2 },
    { kind: 'mine', weight: 4, from: 3 },
    { kind: 'monolith', weight: 3, from: 5 },
  ],
  boss: {
    kind: 'archivist',
    name: 'Arquivista Magnético',
    warnSub: 'ELE INDEXOU SUA ROTA DE FUGA',
    defeatTitle: 'ARQUIVO CORROMPIDO',
    defeatSub: 'As órbitas de dados entram em silêncio',
  },
  background: {
    gradient: ['#031018', '#07120f', '#10081a'],
    nebulas: ['rgba(20, 210, 240, 0.42)', 'rgba(118, 255, 183, 0.32)', 'rgba(180, 85, 255, 0.34)'],
    star: '#b7fff3',
    grid: 'rgba(90, 255, 218, 0.1)',
    gridStyle: 'square',
  },
  // F# locrian-ish pulse: brittle, metallic, and colder than the previous sectors.
  music: {
    bpm: 146,
    bass: [46.25, 49, 55, 51.91],
    chords: [
      [185, 220, 277.18],
      [196, 246.94, 293.66],
      [220, 277.18, 329.63],
      [207.65, 246.94, 311.13],
    ],
    lead: 'sawtooth',
    bossMusic: {
      bpm: 154,
      bass: [46.25, 46.25, 55, 51.91],
      chords: [
        [185, 233.08, 277.18, 369.99],
        [185, 220, 277.18, 329.63],
        [220, 277.18, 329.63, 440],
        [207.65, 261.63, 311.13, 415.3],
      ],
      lead: 'square',
    },
  },
};

export const GELIDA: SectorDef = {
  id: 'gelida',
  name: 'ESTAÇÃO GÉLIDA',
  subtitle: 'O frio absoluto onde até a luz congela',
  accent: '#4fc3f7',
  composition: [
    { kind: 'crystal', weight: 9, from: 1, decay: 0.18, floor: 4 },
    { kind: 'shard', weight: 5, from: 1 },
    { kind: 'flake', weight: 4.5, from: 2 },
    { kind: 'geyser', weight: 3.5, from: 3 },
    { kind: 'glacier', weight: 3, from: 5 },
  ],
  boss: {
    kind: 'zero',
    name: 'Zero Absoluto',
    warnSub: 'A TEMPERATURA CAIU PARA ZERO',
    defeatTitle: 'ZERO ABSOLUTO DESTRUÍDO',
    defeatSub: 'O gelo se quebra... por enquanto',
  },
  background: {
    gradient: ['#0b1620', '#0a1a2e', '#05101a'],
    nebulas: ['rgba(80, 200, 255, 0.4)', 'rgba(160, 230, 255, 0.3)', 'rgba(40, 120, 200, 0.35)'],
    star: '#d4f5ff',
    grid: 'rgba(100, 200, 255, 0.08)',
    gridStyle: 'hex',
  },
  // D-minor glacial: cold, hollow, with chime-like lead. Slower and wider
  // than previous sectors to evoke the vast frozen expanse.
  music: {
    bpm: 100,
    bass: [36.71, 43.65, 38.89, 43.65],
    chords: [
      [146.83, 174.61, 220],
      [174.61, 220, 261.63],
      [155.56, 185, 233.08],
      [174.61, 220, 261.63],
    ],
    lead: 'triangle',
    bossMusic: {
      bpm: 116,
      bass: [36.71, 43.65, 32.7, 43.65],
      chords: [
        [146.83, 185, 233.08, 293.66],
        [174.61, 220, 277.18, 349.23],
        [155.56, 196, 246.94, 311.13],
        [185, 233.08, 277.18, 370],
      ],
      lead: 'square',
    },
  },
};

export const TOXICA: SectorDef = {
  id: 'toxica',
  name: 'ZONA TÓXICA',
  subtitle: 'A ferida aberta da Ruína',
  accent: '#9eff4d',
  composition: [
    { kind: 'blight', weight: 9, from: 1, decay: 0.18, floor: 4 },
    { kind: 'vile', weight: 5.5, from: 1 },
    { kind: 'ooze', weight: 4.5, from: 2 },
    { kind: 'fume', weight: 4, from: 3 },
    { kind: 'crawler', weight: 3, from: 5 },
  ],
  boss: {
    kind: 'miasma',
    name: 'Miasma',
    warnSub: 'O VENENO TOMOU CONTA DE TUDO',
    defeatTitle: 'MIASMA NEUTRALIZADO',
    defeatSub: 'O ar começa a limpar... por enquanto',
  },
  background: {
    gradient: ['#0a1106', '#0e0d05', '#0c0804'],
    nebulas: ['rgba(80, 200, 40, 0.4)', 'rgba(200, 180, 20, 0.35)', 'rgba(100, 255, 80, 0.3)'],
    star: '#b8ff84',
    grid: 'rgba(120, 200, 50, 0.1)',
    gridStyle: 'square',
  },
  // G Phrygian: acidic, dissonant, with a harsh sawtooth lead.
  music: {
    bpm: 124,
    bass: [49, 51.91, 55, 51.91],
    chords: [
      [196, 233.08, 277.18],
      [207.65, 261.63, 293.66],
      [233.08, 277.18, 349.23],
      [220, 261.63, 311.13],
    ],
    lead: 'sawtooth',
    bossMusic: {
      bpm: 136,
      bass: [49, 49, 55, 51.91],
      chords: [
        [196, 233.08, 277.18, 349.23],
        [207.65, 261.63, 293.66, 370],
        [233.08, 277.18, 349.23, 415.3],
        [220, 261.63, 311.13, 392],
      ],
      lead: 'square',
    },
  },
};

export const SECTORS: readonly SectorDef[] = [RUINA, COLMEIA, ARQUIVO, GELIDA, TOXICA];

/** 0-based campaign position — keeps counting up when sectors cycle. */
export function sectorIndexForWave(wave: number): number {
  return Math.floor((wave - 1) / SECTOR_LEN);
}

export function sectorForWave(wave: number): SectorDef {
  return SECTORS[sectorIndexForWave(wave) % SECTORS.length];
}

/** Display number for banners: wave 21 opens "SETOR 3" even though it cycles. */
export function sectorNumberForWave(wave: number): number {
  return sectorIndexForWave(wave) + 1;
}

/** First absolute wave a kind shows up in (codex "surgimento" line). */
export function firstWaveOf(kind: EnemyKind): { sector: number; wave: number } | null {
  for (let i = 0; i < SECTORS.length; i++) {
    const entry = SECTORS[i].composition.find((c) => c.kind === kind);
    if (entry) return { sector: i + 1, wave: i * SECTOR_LEN + entry.from };
  }
  return null;
}

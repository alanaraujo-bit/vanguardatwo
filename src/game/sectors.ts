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

const RUINA: SectorDef = {
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

const COLMEIA: SectorDef = {
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

export const SECTORS: readonly SectorDef[] = [RUINA, COLMEIA];

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

import type { EnemyKind } from './enemies';
import { RUINA, type PoolEntry, type SectorDef } from './sectors';

/**
 * The campaign: a fixed sequence of hand-authored levels (unlike the endless
 * mode's continuous wave scaling). Each level reuses a sector's roster/boss/
 * background/music but curates its own composition, difficulty and win
 * condition instead of following BAL.wave's formulas.
 */

export type LevelObjective =
  | { type: 'survive'; seconds: number }
  | { type: 'killTarget'; count: number }
  | { type: 'boss'; kind: EnemyKind }
  | { type: 'bossRush'; kinds: readonly EnemyKind[] };

export interface LevelModifier {
  /** Multiplies how many enemies may be alive at once. */
  denseSwarm?: number;
  /** Multiplies spawn frequency (>1 = faster spawns). */
  relentless?: number;
  /** Restricts regular spawns to the toughest kinds in the composition. */
  eliteOnly?: boolean;
}

export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  sector: SectorDef;
  objective: LevelObjective;
  /** Overrides sector.composition for this level's spawn pool. */
  composition?: readonly PoolEntry[];
  hpMul: number;
  dmgMul: number;
  modifier?: LevelModifier;
}

export const CAMPAIGN: readonly LevelDef[] = [
  {
    id: 'primeiros-sinais',
    name: 'PRIMEIROS SINAIS',
    subtitle: 'Um punhado de drones testa suas defesas',
    sector: RUINA,
    objective: { type: 'survive', seconds: 60 },
    composition: [
      { kind: 'drone', weight: 10, from: 1 },
      { kind: 'dart', weight: 5, from: 1 },
    ],
    hpMul: 0.9,
    dmgMul: 0.85,
  },
  {
    id: 'enxame',
    name: 'ENXAME',
    subtitle: 'A Ruína manda reforços — não pare de atirar',
    sector: RUINA,
    objective: { type: 'killTarget', count: 40 },
    composition: [
      { kind: 'drone', weight: 8, from: 1 },
      { kind: 'dart', weight: 6, from: 1 },
      { kind: 'splitter', weight: 4.5, from: 1 },
      { kind: 'wasp', weight: 4, from: 1 },
    ],
    hpMul: 1,
    dmgMul: 1,
    modifier: { relentless: 1.15 },
  },
  {
    id: 'colosso-desperta',
    name: 'O COLOSSO DESPERTA',
    subtitle: 'A primeira grande ameaça da Ruína',
    sector: RUINA,
    objective: { type: 'boss', kind: 'boss' },
    hpMul: 1,
    dmgMul: 1,
  },
];

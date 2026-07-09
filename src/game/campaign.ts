import type { EnemyKind } from './enemies';
import { RUINA, COLMEIA, ARQUIVO, type PoolEntry, type SectorDef } from './sectors';

/**
 * The campaign: 20 hand-authored levels across 3 sectors. Each level has its
 * own objective, composition, difficulty curve, and star thresholds.
 *
 * Star system:
 *   1★ = Complete the level (cleared)
 *   2★ = Good performance (varies by objective type)
 *   3★ = Excellent performance (varies by objective type)
 *
 * Coin reward per star: 5 coins (shown on the level card).
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

export interface StarCondition {
  /** Descrição curta da condição pra 2★. Ex: \"HP > 30%\" */
  cond2: string;
  /** Descrição curta da condição pra 3★. Ex: \"HP > 60%\" */
  cond3: string;
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
  /** Condições de estrela pra mostrar na tela de seleção. */
  stars: StarCondition;
}

const COINS_PER_STAR = 5 as const;

export { COINS_PER_STAR };

/** Calcula estrelas (0-3) baseado no tipo de objetivo e desempenho. */
export function calcStars(
  level: LevelDef,
  cleared: boolean,
  hp: number,
  maxHp: number,
  time: number,
): number {
  if (!cleared) return 0;

  const hpFrac = maxHp > 0 ? hp / maxHp : 0;

  switch (level.objective.type) {
    case 'survive': {
      // 2★: HP > 30% | 3★: HP > 60%
      if (hpFrac >= 0.6) return 3;
      if (hpFrac >= 0.3) return 2;
      return 1;
    }
    case 'killTarget': {
      // 2★: completou em < 80% do tempo limite | 3★: < 50%
      const limit = level.objective.count * 1.6; // par estimado de segundos por kill
      const frac = limit > 0 ? time / limit : 1;
      if (frac <= 0.5) return 3;
      if (frac <= 0.8) return 2;
      return 1;
    }
    case 'boss':
    case 'bossRush': {
      // 2★: HP > 30% | 3★: HP > 60%
      if (hpFrac >= 0.6) return 3;
      if (hpFrac >= 0.3) return 2;
      return 1;
    }
  }
}

/**
 * 20 levels — 7 no Campo da Ruína, 6 na Colmeia, 7 no Arquivo Magnético.
 * Chefes a cada 5 níveis: 5, 10, 15, 20 (boss rush final).
 * Cada nível apresenta novos tipos de inimigo gradualmente.
 */
export const CAMPAIGN: readonly LevelDef[] = [
  // ═══════════════════════════════════════════════════════════════
  // SETOR 1 — CAMPO DA RUÍNA (níveis 1-7)
  // Introdução: drones, darts, depois splitters, wasps, tanks
  // ═══════════════════════════════════════════════════════════════

  // ── Nível 1 ──
  {
    id: 'primeiros-sinais',
    name: 'PRIMEIROS SINAIS',
    subtitle: 'A Ruína testa suas defesas com uma patrulha leve',
    sector: RUINA,
    objective: { type: 'survive', seconds: 45 },
    composition: [
      { kind: 'drone', weight: 10, from: 1 },
      { kind: 'dart', weight: 4, from: 1 },
    ],
    hpMul: 0.85,
    dmgMul: 0.8,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 2 ──
  {
    id: 'agulhas-no-escuro',
    name: 'AGULHAS NO ESCURO',
    subtitle: 'Dardos rápidos testam seus reflexos — desvie e atire',
    sector: RUINA,
    objective: { type: 'killTarget', count: 25 },
    composition: [
      { kind: 'drone', weight: 8, from: 1 },
      { kind: 'dart', weight: 7, from: 1 },
    ],
    hpMul: 0.9,
    dmgMul: 0.85,
    modifier: { relentless: 1.1 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 3 ──
  {
    id: 'enxame-rasante',
    name: 'ENXAME RASANTE',
    subtitle: 'Vespas e fragmentadores entram em cena',
    sector: RUINA,
    objective: { type: 'survive', seconds: 55 },
    composition: [
      { kind: 'drone', weight: 7, from: 1 },
      { kind: 'dart', weight: 5, from: 1 },
      { kind: 'splitter', weight: 4, from: 1 },
      { kind: 'wasp', weight: 3, from: 1 },
    ],
    hpMul: 0.95,
    dmgMul: 0.9,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 4 ──
  {
    id: 'muro-de-aco',
    name: 'MURO DE AÇO',
    subtitle: 'Os primeiros tanques da Ruína avançam — pare-os',
    sector: RUINA,
    objective: { type: 'killTarget', count: 40 },
    composition: [
      { kind: 'drone', weight: 6, from: 1 },
      { kind: 'dart', weight: 5, from: 1 },
      { kind: 'splitter', weight: 4, from: 1 },
      { kind: 'wasp', weight: 3, from: 1 },
      { kind: 'tank', weight: 3, from: 1 },
    ],
    hpMul: 1,
    dmgMul: 1,
    modifier: { relentless: 1.15 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 5 — BOSS ──
  {
    id: 'colosso-desperta',
    name: 'O COLOSSO DESPERTA',
    subtitle: 'A primeira grande ameaça da Ruína',
    sector: RUINA,
    objective: { type: 'boss', kind: 'boss' },
    hpMul: 1,
    dmgMul: 1,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 6 ──
  {
    id: 'cinzas',
    name: 'CINZAS',
    subtitle: 'A Ruína responde com ferocidade redobrada',
    sector: RUINA,
    objective: { type: 'killTarget', count: 50 },
    composition: [
      { kind: 'drone', weight: 5, from: 1 },
      { kind: 'dart', weight: 5, from: 1 },
      { kind: 'splitter', weight: 5, from: 1 },
      { kind: 'wasp', weight: 4, from: 1 },
      { kind: 'tank', weight: 3, from: 1 },
    ],
    hpMul: 1.1,
    dmgMul: 1.05,
    modifier: { relentless: 1.2, denseSwarm: 1.1 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 7 ──
  {
    id: 'fronteira',
    name: 'A FRONTEIRA',
    subtitle: 'Sobreviva ao bombardeio final antes do desconhecido',
    sector: RUINA,
    objective: { type: 'survive', seconds: 70 },
    composition: [
      { kind: 'drone', weight: 6, from: 1 },
      { kind: 'dart', weight: 5, from: 1 },
      { kind: 'splitter', weight: 5, from: 1 },
      { kind: 'wasp', weight: 4, from: 1 },
      { kind: 'tank', weight: 4, from: 1 },
    ],
    hpMul: 1.15,
    dmgMul: 1.1,
    modifier: { denseSwarm: 1.2 },
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ═══════════════════════════════════════════════════════════════
  // SETOR 2 — A COLMEIA (níveis 8-13)
  // Inimigos orgânicos: larvas, esporos, ferroadas, tecelãs, besouros
  // ═══════════════════════════════════════════════════════════════

  // ── Nível 8 ──
  {
    id: 'o-enxame-organico',
    name: 'O ENXAME ORGÂNICO',
    subtitle: 'Algo vivo pulsa nas profundezas — larvas e esporos',
    sector: COLMEIA,
    objective: { type: 'survive', seconds: 50 },
    composition: [
      { kind: 'larva', weight: 9, from: 1 },
      { kind: 'spore', weight: 5, from: 1 },
    ],
    hpMul: 1,
    dmgMul: 1,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 9 ──
  {
    id: 'ferroadas',
    name: 'FERROADAS',
    subtitle: 'Ferroadas e tecelãs cercam você — abra caminho',
    sector: COLMEIA,
    objective: { type: 'killTarget', count: 30 },
    composition: [
      { kind: 'larva', weight: 7, from: 1 },
      { kind: 'spore', weight: 5, from: 1 },
      { kind: 'stinger', weight: 5, from: 1 },
      { kind: 'weaver', weight: 4, from: 1 },
    ],
    hpMul: 1.05,
    dmgMul: 1.05,
    modifier: { relentless: 1.1 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 10 — BOSS ──
  {
    id: 'rainha-da-colmeia',
    name: 'RAINHA DA COLMEIA',
    subtitle: 'A colmeia inteira canta para ela',
    sector: COLMEIA,
    objective: { type: 'boss', kind: 'queen' },
    hpMul: 1.1,
    dmgMul: 1.05,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 11 ──
  {
    id: 'colmeia-ferver',
    name: 'COLMEIA FERVER',
    subtitle: 'A colônia inteira foi alertada — elas vêm em massa',
    sector: COLMEIA,
    objective: { type: 'killTarget', count: 45 },
    composition: [
      { kind: 'larva', weight: 6, from: 1 },
      { kind: 'spore', weight: 5, from: 1 },
      { kind: 'stinger', weight: 5, from: 1 },
      { kind: 'weaver', weight: 5, from: 1 },
    ],
    hpMul: 1.1,
    dmgMul: 1.1,
    modifier: { relentless: 1.2, denseSwarm: 1.15 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 12 ──
  {
    id: 'besouros-de-aco',
    name: 'BESOUROS DE AÇO',
    subtitle: 'Besouros blindados chegamm — munição extra necessária',
    sector: COLMEIA,
    objective: { type: 'survive', seconds: 60 },
    composition: [
      { kind: 'stinger', weight: 5, from: 1 },
      { kind: 'weaver', weight: 4, from: 1 },
      { kind: 'beetle', weight: 4, from: 1 },
    ],
    hpMul: 1.15,
    dmgMul: 1.1,
    modifier: { denseSwarm: 1.1 },
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 13 ──
  {
    id: 'proximo-andar',
    name: 'O PRÓXIMO ANDAR',
    subtitle: 'O limite da Colmeia — tudo que ela tem para oferecer',
    sector: COLMEIA,
    objective: { type: 'killTarget', count: 55 },
    composition: [
      { kind: 'larva', weight: 5, from: 1 },
      { kind: 'spore', weight: 4, from: 1 },
      { kind: 'stinger', weight: 5, from: 1 },
      { kind: 'weaver', weight: 5, from: 1 },
      { kind: 'beetle', weight: 4, from: 1 },
    ],
    hpMul: 1.2,
    dmgMul: 1.15,
    modifier: { relentless: 1.25, denseSwarm: 1.2 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ═══════════════════════════════════════════════════════════════
  // SETOR 3 — O ARQUIVO MAGNÉTICO (níveis 14-20)
  // Inimigos digitais: glifos, agulhas, pilones, minas, monólitos
  // ═══════════════════════════════════════════════════════════════

  // ── Nível 14 ──
  {
    id: 'glifos',
    name: 'GLIFOS',
    subtitle: 'Dados mortos se agitam — glifos e agulhas magnéticas',
    sector: ARQUIVO,
    objective: { type: 'survive', seconds: 50 },
    composition: [
      { kind: 'glyph', weight: 9, from: 1 },
      { kind: 'needle', weight: 5, from: 1 },
    ],
    hpMul: 1.05,
    dmgMul: 1.05,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 15 — BOSS ──
  {
    id: 'arquivista-magnetico',
    name: 'ARQUIVISTA MAGNÉTICO',
    subtitle: 'Ele indexou sua rota de fuga',
    sector: ARQUIVO,
    objective: { type: 'boss', kind: 'archivist' },
    hpMul: 1.15,
    dmgMul: 1.1,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 16 ──
  {
    id: 'corrupcao-de-dados',
    name: 'CORRUPÇÃO DE DADOS',
    subtitle: 'O Arquivo está corrompendo suas defesas',
    sector: ARQUIVO,
    objective: { type: 'killTarget', count: 40 },
    composition: [
      { kind: 'glyph', weight: 7, from: 1 },
      { kind: 'needle', weight: 5, from: 1 },
      { kind: 'pylon', weight: 4, from: 1 },
      { kind: 'mine', weight: 3, from: 1 },
    ],
    hpMul: 1.15,
    dmgMul: 1.1,
    modifier: { relentless: 1.15 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 17 ──
  {
    id: 'sobrecarga',
    name: 'SOBRECARGA',
    subtitle: 'O sistema está em sobrecarga — aguente firme',
    sector: ARQUIVO,
    objective: { type: 'survive', seconds: 60 },
    composition: [
      { kind: 'glyph', weight: 6, from: 1 },
      { kind: 'needle', weight: 5, from: 1 },
      { kind: 'pylon', weight: 5, from: 1 },
      { kind: 'mine', weight: 4, from: 1 },
      { kind: 'monolith', weight: 2, from: 1 },
    ],
    hpMul: 1.2,
    dmgMul: 1.15,
    modifier: { denseSwarm: 1.15, relentless: 1.1 },
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 18 ──
  {
    id: 'indexacao',
    name: 'INDEXAÇÃO',
    subtitle: 'O Arquivo te marcou como prioridade de eliminação',
    sector: ARQUIVO,
    objective: { type: 'killTarget', count: 55 },
    composition: [
      { kind: 'glyph', weight: 6, from: 1 },
      { kind: 'needle', weight: 5, from: 1 },
      { kind: 'pylon', weight: 5, from: 1 },
      { kind: 'mine', weight: 4, from: 1 },
      { kind: 'monolith', weight: 3, from: 1 },
    ],
    hpMul: 1.25,
    dmgMul: 1.2,
    modifier: { relentless: 1.25, denseSwarm: 1.2 },
    stars: { cond2: 'Completar em < 80% do tempo', cond3: 'Completar em < 50% do tempo' },
  },

  // ── Nível 19 ──
  {
    id: 'limiar',
    name: 'LIMIAR',
    subtitle: 'Além do Arquivo — o coração da Ruína no horizonte',
    sector: ARQUIVO,
    objective: { type: 'survive', seconds: 75 },
    composition: [
      { kind: 'glyph', weight: 5, from: 1 },
      { kind: 'needle', weight: 5, from: 1 },
      { kind: 'pylon', weight: 5, from: 1 },
      { kind: 'mine', weight: 4, from: 1 },
      { kind: 'monolith', weight: 4, from: 1 },
    ],
    hpMul: 1.3,
    dmgMul: 1.25,
    modifier: { denseSwarm: 1.3, relentless: 1.15 },
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },

  // ── Nível 20 — BOSS RUSH FINAL ──
  {
    id: 'a-ruina-final',
    name: 'A RUÍNA FINAL',
    subtitle: 'Todas as três ameaças. Uma atrás da outra. Sem respiro.',
    sector: ARQUIVO,
    objective: { type: 'bossRush', kinds: ['boss', 'queen', 'archivist'] as const },
    hpMul: 1.2,
    dmgMul: 1.2,
    stars: { cond2: 'HP > 30%', cond3: 'HP > 60%' },
  },
];

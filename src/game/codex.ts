import { drawSprite, shapeSprite, type Sprite } from '../fx/sprites';
import { BAL } from './balance';
import { SPECS as ENEMY_SPECS, ENEMY_SHAPE_OPTS, type EnemyKind } from './enemies';
import { META_DEFS } from './meta';
import { COIN_SHAPE, GEM_SHAPE, MAX_GEMS, heartSprite } from './pickups';
import { SHIP_SHAPE } from './player';
import { paintIcon, UPGRADE_DEFS } from './upgrades';
import { COMPOSITION } from './waves';

/**
 * The in-game Codex: a read-only reference of everything that exists in
 * Vanguarda, built from the same data tables the systems run on (so numbers
 * can't drift) plus hand-written lore/tactics text.
 *
 * Whenever a new enemy, upgrade, meta upgrade or resource is added to the
 * game, add a matching entry here too — this file is the single place
 * players can learn what everything does.
 */

export type CodexCategoryId = 'ship' | 'enemies' | 'upgrades' | 'meta' | 'resources' | 'systems';

export interface CodexStat {
  label: string;
  value: string;
}

export interface CodexEntry {
  id: string;
  name: string;
  tagline: string;
  lore: string;
  tactic?: string;
  stats: CodexStat[];
  accent: string;
  icon: HTMLCanvasElement;
}

export interface CodexCategory {
  id: CodexCategoryId;
  label: string;
  intro: string;
  entries: CodexEntry[];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function spriteIcon(sprite: Sprite, size = 48): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    const scale = (size * 0.36) / sprite.half;
    drawSprite(ctx, sprite, size / 2, size / 2, 0, scale);
  }
  return canvas;
}

// ————— nave —————

const shipEntry: CodexEntry = {
  id: 'ship',
  name: 'Interceptador',
  tagline: 'Sua nave — mira e atira sozinha; você comanda o movimento.',
  lore: 'A última unidade ainda em campo contra a Ruína. O sistema de combate é totalmente automatizado: a nave mira e dispara contra a ameaça mais próxima sem qualquer comando manual — sua única tarefa é posicioná-la e sobreviver.',
  tactic: 'O movimento responde de forma assimétrica: acelerar é suave, mas soltar o controle freia rápido e inverter a direção é ainda mais rápido — use isso para desviar por pouco de ataques. Depois de tomar um golpe, você fica brevemente invulnerável, então um recuo rápido pode salvar a run.',
  accent: '#35f0ff',
  icon: spriteIcon(shapeSprite(SHIP_SHAPE), 52),
  stats: [
    { label: 'Vida', value: String(BAL.player.hp) },
    { label: 'Velocidade', value: String(BAL.player.speed) },
    { label: 'Dano base', value: String(BAL.player.damage) },
    { label: 'Cadência de tiro', value: `1 disparo a cada ${BAL.player.fireInterval.toFixed(2)}s` },
    { label: 'Velocidade do projétil', value: String(BAL.player.projSpeed) },
    { label: 'Alcance de mira automática', value: String(BAL.player.aimRange) },
    { label: 'Raio de coleta (ímã)', value: String(BAL.player.magnet) },
    { label: 'Chance crítica base', value: `${pct(BAL.player.critChance)} (dano x${BAL.player.critMult})` },
    { label: 'Invulnerabilidade após dano', value: `${BAL.player.iframes}s` },
  ],
};

// ————— inimigos (a Ruína) —————

interface EnemyLore { name: string; tagline: string; lore: string; tactic: string; }

const ENEMY_LORE: Record<EnemyKind, EnemyLore> = {
  drone: {
    name: 'Drone',
    tagline: 'Autômato básico — fraco sozinho, perigoso em enxame.',
    lore: 'Unidade triangular produzida em massa pela Ruína. Avança em linha reta até o alvo, sem qualquer manobra: a ameaça está no número, não na força individual.',
    tactic: 'HP baixíssimo — cai em um ou dois golpes na maioria das builds. O perigo real é ser cercado por muitos ao mesmo tempo.',
  },
  dart: {
    name: 'Dardo',
    tagline: 'Batedor veloz que serpenteia para escapar da sua mira.',
    lore: 'Corpo fino e afiado que corta o campo de batalha em alta velocidade, ondulando de um lado a outro para dificultar qualquer perseguição.',
    tactic: 'Morre com um único golpe na maioria das builds, mas o desvio lateral constante atrapalha a leitura da sua trajetória — confie na mira automática da nave.',
  },
  splitter: {
    name: 'Fragmentador',
    tagline: 'Ao ser destruído, se parte em dois Fragmentos.',
    lore: 'Um casulo instável e romboide que carrega duas crias em seu interior, liberadas no instante em que sua casca se rompe.',
    tactic: 'Destrua-o à distância quando possível — os dois Fragmentos nascem com impulso aleatório e podem surpreender você se estiver colado nele.',
  },
  mini: {
    name: 'Fragmento',
    tagline: 'Cria do Fragmentador — pequena, veloz e frágil.',
    lore: 'Nasce apenas quando um Fragmentador é destruído, herdando uma fração de sua força e quase o dobro da velocidade.',
    tactic: 'HP mínimo — o risco é vir aos pares bem no meio do combate, logo após você destruir o Fragmentador de origem.',
  },
  wasp: {
    name: 'Vespa',
    tagline: 'Atiradora à distância — mantém o alcance e dispara orbes.',
    lore: 'Voa em zigue-zague ao redor do alvo, alternando aproximação e recuo enquanto dispara orbes de energia à distância.',
    tactic: 'Aproxime-se demais e ela recua para reabrir distância antes de atirar de novo — persiga de perto para tirá-la do alcance de tiro, ou elimine-a de longe antes que dispare.',
  },
  tank: {
    name: 'Tanque',
    tagline: 'Lento e blindado — resiste a impacto e golpeia forte.',
    lore: 'Infantaria pesada da Ruína. Avança devagar, mas absorve grandes quantidades de dano e quase não recua com os impactos dos seus tiros.',
    tactic: 'A lentidão o torna fácil de evitar — mantenha distância em vez de trocar golpes de perto. Tem mais chance de soltar moedas e pode derrubar um coração ao morrer.',
  },
  boss: {
    name: 'Colosso da Ruína',
    tagline: `O ápice da invasão — aparece a cada ${BAL.wave.bossEvery} ondas.`,
    lore: 'Uma fusão titânica de tudo que a Ruína já consumiu. Sua chegada é anunciada antes mesmo de ele pisar no campo de batalha.',
    tactic: 'Alterna entre perseguir, parar para disparar rajadas circulares de projéteis (aproveite para descarregar dano nele) e uma investida de altíssima velocidade avisada por um brilho de alerta — desvie assim que perceber o aviso. Abaixo de 35% de vida ele entra em fúria e todas as fases ficam mais rápidas.',
  },
};

const ENEMY_ORDER: readonly EnemyKind[] = ['drone', 'dart', 'splitter', 'mini', 'wasp', 'tank', 'boss'];

function waveAvailability(kind: EnemyKind): string {
  if (kind === 'boss') return `Aparece a cada ${BAL.wave.bossEvery} ondas`;
  if (kind === 'mini') return 'Só nasce de um Fragmentador destruído';
  const comp = COMPOSITION.find((c) => c.kind === kind);
  return comp ? `Aparece a partir da onda ${comp.from}` : '—';
}

const enemyEntries: CodexEntry[] = ENEMY_ORDER.map((kind) => {
  const spec = ENEMY_SPECS[kind];
  const lore = ENEMY_LORE[kind];
  const sprite = shapeSprite({ radius: spec.radius * 1.25, color: spec.color, fillAlpha: 0.3, ...ENEMY_SHAPE_OPTS[kind] });

  const stats: CodexStat[] = [
    { label: 'Vida', value: String(spec.hp) },
    { label: 'Velocidade', value: String(spec.speed) },
    { label: 'Dano de contato', value: String(spec.dmg) },
    { label: 'XP ao derrotar', value: String(spec.xp) },
    { label: 'Pontuação', value: String(spec.score) },
    { label: 'Surgimento', value: waveAvailability(kind) },
  ];
  if (kind === 'wasp') {
    stats.push({ label: 'Dano do disparo à distância', value: String(Math.round(spec.dmg * 0.85)) });
  }
  if (kind === 'tank') {
    stats.push({ label: 'Chance de soltar coração', value: pct(BAL.drops.heartChanceTank) });
  }
  if (kind === 'boss') {
    stats.push({ label: 'Vida na 1ª aparição (onda 5)', value: String(Math.round(BAL.wave.bossHp(5))) });
    stats.push({ label: 'Dano por projétil da rajada', value: String(Math.round(spec.dmg * 0.6)) });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}–${BAL.drops.bossCoins[1]} moedas + 1 coração` });
  }

  return {
    id: kind,
    name: lore.name,
    tagline: lore.tagline,
    lore: lore.lore,
    tactic: lore.tactic,
    accent: spec.color,
    icon: spriteIcon(sprite, 52),
    stats,
  };
});

// ————— potencializadores de combate (upgrades temporários) —————

const UPGRADE_LORE: Record<string, { tagline: string; lore: string }> = {
  power: { tagline: 'Amplifica o núcleo de disparo.', lore: 'Sobrecarrega os capacitores de tiro, aumentando o dano de cada disparo.' },
  rate: { tagline: 'Acelera o ciclo de disparo automático.', lore: 'Reduz o tempo de recarga entre disparos, aumentando a cadência de fogo.' },
  multi: { tagline: 'Mais canos, mais projéteis por rajada.', lore: 'Adiciona um cano de disparo extra, lançando mais projéteis a cada disparo automático.' },
  pierce: { tagline: 'Projéteis atravessam alvos.', lore: 'Reforça a ponta dos projéteis para que continuem em frente após o primeiro impacto.' },
  ricochet: { tagline: 'Projéteis saltam entre inimigos.', lore: 'Guia o projétil para saltar automaticamente até o inimigo alcançável mais próximo após o impacto.' },
  crit: { tagline: 'Mais chance de dano crítico.', lore: 'Refina os sensores de mira, aumentando a chance de cada tiro causar dano crítico (dobro do dano).' },
  blades: { tagline: 'Lâminas orbitam ao seu redor.', lore: 'Ativa lâminas de energia que giram ao redor da nave, cortando qualquer inimigo que tocarem.' },
  nova: { tagline: 'Onda de choque periódica.', lore: 'Libera periodicamente uma onda de choque que empurra e danifica tudo ao redor da nave.' },
  magnet: { tagline: 'Expande o raio de coleta.', lore: 'Amplia o campo magnético da nave, atraindo gemas, moedas e corações de mais longe.' },
  vital: { tagline: 'Reforça o casco e cura na hora.', lore: 'Reforça a estrutura da nave, aumentando a vida máxima e restaurando parte dela imediatamente.' },
  thrusters: { tagline: 'Propulsores mais potentes.', lore: 'Aumenta a potência dos propulsores, deixando a nave mais ágil.' },
  regen: { tagline: 'Reparo automático contínuo.', lore: 'Ativa nanobots de reparo que recuperam vida aos poucos, de forma contínua, durante toda a partida.' },
  frag: { tagline: 'Inimigos explodem ao morrer.', lore: 'Instala carga residual em cada inimigo — ao serem destruídos, detonam e danificam vizinhos próximos.' },
};

const upgradeEntries: CodexEntry[] = UPGRADE_DEFS.map((def) => {
  const lore = UPGRADE_LORE[def.id];
  const first = def.desc(1);
  const later = def.max > 1 ? def.desc(2) : first;
  const stats: CodexStat[] = [{ label: 'Nível 1', value: first }];
  if (later !== first) stats.push({ label: 'Níveis seguintes', value: later });
  stats.push({ label: 'Nível máximo', value: String(def.max) });

  return {
    id: def.id,
    name: def.name,
    tagline: lore.tagline,
    lore: lore.lore,
    accent: def.color,
    icon: paintIcon(def.icon, def.color, 48),
    stats,
  };
});

// ————— tecnologia do hangar (upgrades permanentes) —————

const META_ACCENT = '#35f0ff';

const META_LORE: Record<string, { tagline: string; lore: string }> = {
  hull: { tagline: 'Blindagem permanente do casco.', lore: 'Reforço estrutural fixo, instalado no Hangar antes de cada partida começar.' },
  core: { tagline: 'Upgrade permanente do reator.', lore: 'Recalibra o reator de tiro da nave de forma definitiva, elevando o dano base de toda partida futura.' },
  thrust: { tagline: 'Propulsão de elite permanente.', lore: 'Substitui os propulsores por um modelo mais potente, disponível desde o primeiro segundo de qualquer partida.' },
  magnet: { tagline: 'Coletor magnético fixo.', lore: 'Amplia permanentemente o campo de coleta da nave.' },
  luck: { tagline: 'Mira tática permanente.', lore: 'Um sistema de mira preditivo permanente, aumentando a chance crítica base.' },
  greed: { tagline: 'Prosperidade permanente.', lore: 'Um acordo comercial com os últimos postos avançados — mais moedas em cada coleta, para sempre.' },
};

const metaEntries: CodexEntry[] = META_DEFS.map((def) => ({
  id: def.id,
  name: def.name,
  tagline: META_LORE[def.id].tagline,
  lore: META_LORE[def.id].lore,
  accent: META_ACCENT,
  icon: paintIcon(def.icon, META_ACCENT, 48),
  stats: [
    { label: 'Efeito por nível', value: def.desc },
    { label: 'Nível máximo', value: String(def.max) },
    { label: 'Custo inicial', value: `${def.baseCost} moedas` },
  ],
}));

// ————— recursos (coletáveis) —————

const resourceEntries: CodexEntry[] = [
  {
    id: 'gem',
    name: 'Gema',
    tagline: 'Experiência — sobe seu nível e libera potencializadores.',
    lore: 'Fragmento de energia liberado por todo inimigo destruído. É atraída automaticamente para a nave assim que entra no raio do ímã.',
    tactic: `Até ${MAX_GEMS} gemas podem existir ao mesmo tempo em campo; se o limite é atingido, a mais antiga voa até você sozinha, então nenhuma experiência é perdida. Abates seguidos dentro de ${BAL.combo.window}s constroem um combo que aumenta a experiência de cada gema coletada — veja "Combo" em Sistemas.`,
    accent: '#52ffa8',
    icon: spriteIcon(shapeSprite(GEM_SHAPE), 48),
    stats: [
      { label: 'Efeito', value: 'Concede experiência (XP) para subir de nível' },
      { label: 'Limite simultâneo em campo', value: `${MAX_GEMS} gemas` },
    ],
  },
  {
    id: 'coin',
    name: 'Moeda',
    tagline: 'Moeda permanente — gasta no Hangar entre partidas.',
    lore: 'O único recurso que sobrevive à sua destruição. Tudo que for acumulado numa partida continua disponível no Hangar do menu principal.',
    tactic: 'Tanques têm mais chance de derrubar moedas do que inimigos comuns, e o Colosso da Ruína sempre solta um bom punhado ao cair. Vale a pena buscar sobreviver mais ondas: o bônus por onda alcançada costuma valer mais que as moedas soltas em campo.',
    accent: '#ffc857',
    icon: spriteIcon(shapeSprite(COIN_SHAPE), 48),
    stats: [
      { label: 'Efeito', value: 'Compra melhorias permanentes no Hangar' },
      { label: 'Chance de queda (inimigo comum)', value: pct(BAL.drops.coinChance) },
      { label: 'Queda do Tanque', value: '3 moedas' },
      { label: 'Queda do Colosso da Ruína', value: `${BAL.drops.bossCoins[0]}–${BAL.drops.bossCoins[1]} moedas` },
      { label: 'Bônus por onda (fim de partida)', value: `${BAL.score.coinsPerWave} moedas por onda alcançada` },
    ],
  },
  {
    id: 'heart',
    name: 'Coração',
    tagline: 'Cura instantânea — recupera parte da sua vida máxima.',
    lore: 'Núcleo de energia vital deixado por inimigos mais resistentes ao caírem. Restaura parte da sua vida no instante em que é coletado.',
    tactic: 'Guarde de olho na vida do Colosso da Ruína: ele sempre solta um coração ao ser destruído, então não há problema em arriscar um pouco mais perto do fim da luta.',
    accent: '#ff5d73',
    icon: spriteIcon(heartSprite(), 48),
    stats: [
      { label: 'Efeito', value: 'Cura 25% da vida máxima' },
      { label: 'Queda do Tanque', value: pct(BAL.drops.heartChanceTank) },
      { label: 'Queda do Colosso da Ruína', value: 'Sempre' },
    ],
  },
];

// ————— sistemas (ondas, combo, pontuação) —————

const systemEntries: CodexEntry[] = [
  {
    id: 'waves',
    name: 'Ondas',
    tagline: `Cada onda dura ${BAL.wave.duration}s e a Ruína fica mais forte a cada uma.`,
    lore: 'A Ruína ataca em ondas cronometradas. A cada onda, mais inimigos aparecem, mais rápido, com mais vida e mais dano — e novos tipos de inimigo entram em cena conforme a run avança.',
    tactic: `A cada ${BAL.wave.bossEvery} ondas, a onda regular é substituída por um confronto contra o Colosso da Ruína, que precisa ser destruído para a progressão continuar.`,
    accent: '#35f0ff',
    icon: paintIcon('rate', '#35f0ff', 48),
    stats: [
      { label: 'Duração de cada onda', value: `${BAL.wave.duration}s` },
      { label: 'Onda com chefe', value: `A cada ${BAL.wave.bossEvery} ondas` },
    ],
  },
  {
    id: 'combo',
    name: 'Combo',
    tagline: 'Abates seguidos aumentam a experiência ganha.',
    lore: 'Eliminar inimigos em sequência rápida constrói um combo. Quanto maior o combo, mais experiência cada gema coletada concede.',
    tactic: `A janela entre abates é de ${BAL.combo.window}s — deixe passar mais que isso e o combo zera. O contador só aparece na tela a partir de x${BAL.combo.showFrom}.`,
    accent: '#ffc857',
    icon: paintIcon('crit', '#ffc857', 48),
    stats: [
      { label: 'Janela entre abates', value: `${BAL.combo.window}s` },
      { label: 'Bônus de XP por stack de combo', value: pct(BAL.combo.xpPerStack) },
      { label: 'Combo máximo', value: `x${BAL.combo.maxStack}` },
    ],
  },
  {
    id: 'tutorial',
    name: 'Treinamento',
    tagline: 'O simulador de combate guiado para novos pilotos.',
    lore: 'Todo piloto passa pelo simulador antes do primeiro combate real: movimento, tiro automático, gemas, melhorias, moedas e uma prova final de resistência — com direito a reinício instantâneo em caso de queda, um luxo que a Ruína jamais oferecerá.',
    tactic: 'Concluir o treinamento rende um bônus de 25 moedas. Dá para revê-lo a qualquer momento nos Ajustes; partidas de treinamento não contam para o ranking nem para os recordes.',
    accent: '#52ffa8',
    icon: paintIcon('regen', '#52ffa8', 48),
    stats: [
      { label: 'Bônus de conclusão', value: '25 moedas' },
      { label: 'Conta para o ranking', value: 'Não' },
      { label: 'Rever', value: 'Ajustes → Rever tutorial' },
    ],
  },
  {
    id: 'ranking',
    name: 'Ranking Global',
    tagline: 'Compare suas melhores partidas com pilotos do mundo todo.',
    lore: 'O comando da resistência mantém três quadros de honra: a onda máxima alcançada, o maior saque de moedas em uma única partida e o maior tempo de resistência contra a Ruína. Cada quadro guarda o melhor feito de cada piloto — uma única partida lendária basta para entrar para a história.',
    tactic: 'Somente partidas jogadas com a conta conectada valem para o ranking — os resultados são validados pelo comando antes de entrar nos quadros. Toque em qualquer linha do ranking para inspecionar o perfil do piloto.',
    accent: '#ffc857',
    icon: paintIcon('crit', '#ffc857', 48),
    stats: [
      { label: 'Quadro 1', value: 'Onda máxima' },
      { label: 'Quadro 2', value: 'Moedas em uma partida' },
      { label: 'Quadro 3', value: 'Tempo de resistência' },
      { label: 'Requisito', value: 'Entrar com Google' },
    ],
  },
  {
    id: 'perfil',
    name: 'Perfil de Piloto',
    tagline: 'Sua identidade pública na resistência.',
    lore: 'Cada piloto registrado tem um perfil público com seus recordes validados, total de partidas, abates acumulados e tempo total de combate — visível para qualquer outro piloto a partir do ranking. O progresso fica salvo na nuvem: entre com a mesma conta em outro aparelho e continue de onde parou.',
    tactic: 'O nome escolhido após o treinamento pode ser alterado a qualquer momento no seu perfil. Escolha bem: é assim que os outros pilotos vão te reconhecer nos quadros de honra.',
    accent: '#35f0ff',
    icon: paintIcon('vital', '#35f0ff', 48),
    stats: [
      { label: 'Recordes exibidos', value: 'Onda · Pontuação · Tempo · Moedas' },
      { label: 'Salvamento na nuvem', value: 'Automático ao jogar conectado' },
      { label: 'Alterar nome', value: 'Perfil → Editar nome' },
    ],
  },
  {
    id: 'score',
    name: 'Pontuação & Recompensas',
    tagline: 'O que você ganha ao fim de cada partida.',
    lore: 'Ao final de cada partida, seu desempenho vira pontuação e moedas. A pontuação de abate varia por tipo de inimigo (veja cada um em "A Ruína"); ondas alcançadas e tempo de sobrevivência somam pontos extras.',
    tactic: 'O bônus de moedas por onda é creditado mesmo que você não tenha coletado nenhuma moeda na partida — sobreviver mais ondas sempre compensa, mesmo numa corrida ruim de sorte.',
    accent: '#52ffa8',
    icon: paintIcon('coin', '#52ffa8', 48),
    stats: [
      { label: 'Pontos por onda alcançada', value: String(BAL.score.perWave) },
      { label: 'Pontos por segundo sobrevivido', value: String(BAL.score.perSecond) },
      { label: 'Moedas bônus por onda alcançada', value: String(BAL.score.coinsPerWave) },
    ],
  },
];

// ————— índice —————

export const CODEX_INTRO = 'Referência completa de tudo que existe em Vanguarda: nave, ameaças, poderes e recursos.';

export const CODEX: readonly CodexCategory[] = [
  { id: 'ship', label: 'Nave', intro: 'A única unidade ainda em campo contra a Ruína.', entries: [shipEntry] },
  { id: 'enemies', label: 'A Ruína', intro: 'Toda ameaça que você vai enfrentar, da mais comum ao Colosso.', entries: enemyEntries },
  { id: 'upgrades', label: 'Combate', intro: 'Melhorias temporárias, escolhidas ao subir de nível durante a partida.', entries: upgradeEntries },
  { id: 'meta', label: 'Hangar', intro: 'Melhorias permanentes, compradas com moedas entre partidas.', entries: metaEntries },
  { id: 'resources', label: 'Recursos', intro: 'Tudo que você coleta no campo de batalha.', entries: resourceEntries },
  { id: 'systems', label: 'Sistemas', intro: 'Como a dificuldade, o combo e a pontuação funcionam.', entries: systemEntries },
];

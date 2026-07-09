import { drawSprite, shapeSprite, type Sprite } from '../fx/sprites';
import { BAL } from './balance';
import { CAMPAIGN } from './campaign';
import { SPECS as ENEMY_SPECS, ENEMY_SHAPE_OPTS, isBossKind, type EnemyKind } from './enemies';
import { META_DEFS } from './meta';
import { COIN_SHAPE, GEM_SHAPE, MAX_GEMS, heartSprite } from './pickups';
import { SHIP_SHAPE } from './player';
import { firstWaveOf, SECTOR_LEN, SECTORS } from './sectors';
import { SKINS } from './skins';
import { paintIcon, UPGRADE_DEFS } from './upgrades';

/**
 * The in-game Codex: a read-only reference of everything that exists in
 * Baluarte, built from the same data tables the systems run on (so numbers
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
    tagline: 'O chefe do Campo da Ruína — barra as ondas 5 e 10.',
    lore: 'Uma fusão titânica de tudo que a Ruína já consumiu. Sua chegada é anunciada antes mesmo de ele pisar no campo de batalha.',
    tactic: 'Alterna entre perseguir, parar para disparar rajadas circulares de projéteis (aproveite para descarregar dano nele) e uma investida de altíssima velocidade avisada por um brilho de alerta — desvie assim que perceber o aviso. Abaixo de 35% de vida ele entra em fúria e todas as fases ficam mais rápidas.',
  },
  larva: {
    name: 'Larva',
    tagline: 'Cria da Colmeia — pequena, incansável e sempre em bando.',
    lore: 'A forma mais jovem da Colmeia. Nasce às dezenas nas paredes vivas do setor e avança em linha reta, guiada apenas pela fome.',
    tactic: 'Individualmente inofensiva, mas a Colmeia nunca envia uma só — e a Rainha invoca mais durante a luta. Mantenha-se em movimento e deixe a mira automática limpar o enxame.',
  },
  spore: {
    name: 'Esporo',
    tagline: 'Casulo flutuante que estoura numa roda de orbes ao morrer.',
    lore: 'Um casulo inchado de gás vivo que deriva lentamente até o alvo. A morte é seu próprio ataque: a casca rompe e espalha orbes tóxicos em círculo.',
    tactic: 'Nunca o destrua colado em você. Os seis orbes saem em círculo e são lentos — abata-o de longe e passe pelos vãos entre eles.',
  },
  stinger: {
    name: 'Ferrão',
    tagline: 'Caçador que congela por um instante... e dá o bote.',
    lore: 'O predador da Colmeia. Aproxima-se em voo direto, trava no ar por um instante — e cruza o campo numa investida fulminante.',
    tactic: 'O brilho branco é o aviso do bote: quando ele congelar, mova-se para o lado, perpendicular à linha entre vocês. A investida não faz curva.',
  },
  weaver: {
    name: 'Tecelã',
    tagline: 'Orbita o alvo cuspindo leques de três orbes.',
    lore: 'Tece círculos pacientes ao redor da presa, mantendo distância enquanto cospe leques de ácido cristalizado.',
    tactic: 'O leque abre com a distância: perto dela os três orbes acertam juntos, longe há espaço para passar entre eles. Elimine-a antes que o círculo dela se feche sobre você.',
  },
  beetle: {
    name: 'Carrapaço',
    tagline: 'Muralha viva — blindado, pesado e implacável.',
    lore: 'Um besouro colossal de casco septenário, criado para proteger a Rainha. Quase imune a recuo, empurra o campo de batalha na sua direção passo a passo.',
    tactic: 'Trate-o como o Tanque da Ruína: nunca troque golpes de perto. É a melhor fonte de moedas e corações da Colmeia — priorize-o quando precisar de cura.',
  },
  queen: {
    name: 'Rainha da Colmeia',
    tagline: 'A mãe do enxame — chefe da Colmeia, ondas 15 e 20.',
    lore: 'O coração vivo da Colmeia. Não investe como o Colosso: ela tece espirais rotativas de orbes, fecha anéis ao redor da presa e chama as crias para lutarem por ela.',
    tactic: 'Três armas, três respostas: na espiral rotativa, ande em círculo acompanhando a rotação; nos anéis, atravesse pelos vãos antes que fechem; na invocação, elimine as crias antes que o enxame cresça. Abaixo de 35% de vida ela se enfurece — tudo acelera e a espiral ganha um braço extra.',
  },
  glyph: {
    name: 'Glifo',
    tagline: 'Fragmento de dado que avança em zigue-zague magnético.',
    lore: 'Um cursor vivo arrancado do Arquivo Magnético. Ele não caça em linha reta: desliza de lado como se fosse corrigido por trilhos invisíveis.',
    tactic: 'O deslocamento lateral atrapalha tiros em linha e fecha ângulos estranhos. Mantenha espaço para que a mira automática possa rastrear a oscilação.',
  },
  needle: {
    name: 'Agulha',
    tagline: 'Atiradora de precisão que mantém distância e dispara descargas rápidas.',
    lore: 'Uma lasca de railgun indexada pelo Arquivo. Ela orbita fora do seu alcance confortável e tenta perfurar a rota prevista da nave.',
    tactic: 'Ela recua quando você aproxima demais. Quebre a distância em diagonal e não fique parado quando ouvir a descarga magnética.',
  },
  pylon: {
    name: 'Pilar',
    tagline: 'Torre móvel que desenha cruzes de projéteis no campo.',
    lore: 'Um nó de processamento ambulante. Cada pulso abre uma pequena malha de fogo em quatro direções, como uma grade de segurança sendo escrita no chão.',
    tactic: 'Os disparos saem em cruz a partir da direção do alvo. Desvie pelos quadrantes diagonais em vez de fugir reto para trás.',
  },
  mine: {
    name: 'Mina Ímã',
    tagline: 'Deriva até perto e estoura em oito orbes acelerados.',
    lore: 'Um pacote de memória instável envolto por polos opostos. Quando se aproxima demais ou é destruído, toda a carga é expelida em anel.',
    tactic: 'Não deixe acumular perto do chefe. Detone-a de longe e passe entre os oito orbes; de perto, o anel quase não abre espaço.',
  },
  monolith: {
    name: 'Monólito',
    tagline: 'Unidade pesada que puxa a nave com pulsos magnéticos.',
    lore: 'Um bloco de armazenamento blindado, lento e quase imune a recuo. Seu campo tenta arrastar pilotos para dentro da massa de inimigos.',
    tactic: 'Quando o anel aparecer, corrija o movimento para fora dele. Como outros pesados, pode soltar coração e vale priorizar se a arena estiver congestionada.',
  },
  archivist: {
    name: 'Arquivista Magnético',
    tagline: 'Chefe do Arquivo — controla grades, feixes e minas indexadas.',
    lore: 'A entidade que cataloga cada rota de fuga. O Arquivista não ruge nem comanda uma colmeia: ele calcula, trava o espaço em padrões e semeia minas onde a nave tende a passar.',
    tactic: 'Na grade, procure os vãos entre as rajadas rotativas; no feixe, mova-se lateralmente assim que ele começar a brilhar; na indexação, limpe as Minas Ímã antes que a próxima fase aperte a arena. Abaixo de 35% de vida ele adiciona projéteis e minas extras.',
  },
  // — Setor 4: Estação Gélida —
  crystal: {
    name: 'Cristalino',
    tagline: 'Cristal hexaédrico que avança e cintila em rajadas curtas.',
    lore: 'Um fragmento de gelo cristalino animado pela assinatura fria da Ruína. Desliza em linha reta e, de vez em quando, dá um estalo seco e avança num salto repentino.',
    tactic: 'O avanço repentino pega desprevenido quem fica parado. Mantenha distância e movimento lateral constante — o salto dele é reto e não acompanha curvas.',
  },
  shard: {
    name: 'Estilhaço',
    tagline: 'Estilhaço perfurante que dispara em investidas telegrafadas.',
    lore: 'Uma lasca de gelo temperada pela pressão abissal da Estação. Ele para, brilha por um instante — e atravessa o campo num rasgo supersônico que solta fragmentos ao colidir.',
    tactic: 'O brilho é seu melhor aviso: quando ele congelar no lugar e ficar branco, saia da linha de tiro. A investida é reta e não desvia. Ao morrer, solta três fragmentos em leque — mantenha distância.',
  },
  flake: {
    name: 'Floco',
    tagline: 'Floco de gelo à deriva que dispara orbes congelantes.',
    lore: 'Um cristal de neve animado que vaga pelo campo rodopiando lentamente. Cada rotação cospe um orbe de gelo que gruda na fuselagem ebreve congela os propulsores.',
    tactic: 'Os orbes congelantes reduzem drasticamente sua velocidade — um único acerto pode deixar você lento o bastante para ser cercado. Priorize abater Flocos antes de outros inimigos; os orbes são lentos e dá para desviar.',
  },
  geyser: {
    name: 'Geiser',
    tagline: 'Torre de cristal que semeia poças de gelo no campo.',
    lore: 'Uma coluna de cristal alimentada por veios de gelo subterrâneos. Ela não caça: finca raízes no chão e expele poças de gelo que se espalham como manchas no campo de batalha.',
    tactic: 'As poças de gelo são quase invisíveis no calor do combate e machucam por contato. Quando um Geiser aparecer, elimine-o rápido — cada poça que ele planta tira espaço de manobra.',
  },
  glacier: {
    name: 'Glaciar',
    tagline: 'Bloco de gelo colossal que pulsa ondas de congelamento.',
    lore: 'O coração congelado de um antigo titã da Ruína. Avança devagar, mas é quase indestrutível, e cada batida do seu núcleo libera um anel de fragmentos que congelam tudo que tocam.',
    tactic: 'Como todo unitário pesado, nunca troque tiros de perto com ele. O anel de fragmentos que ele emite periodicamente se expande devagar — recue para passar entre os orbes gelados.',
  },
  zero: {
    name: 'Zero Absoluto',
    tagline: 'O núcleo congelado da Estação — chefe do setor 4.',
    lore: 'No centro da Estação Gélida, onde nem as estrelas chegam, o Zero Absoluto espera. Não é uma criatura: é a própria temperatura zero corporificada — um olho de furacão de gelo que alterna entre rajadas de orbes congelantes, geiseres que brotam do chão e um feixe contínuo que varre o campo.',
    tactic: 'Três fases, três respostas: na órbita, desvie dos orbes em zigue-zague; nos geiseres, fique atento ao brilho no chão e não pare em lugar nenhum; no feixe, mova-se lateralmente para escapar da varredura. Abaixo de 35% de vida, ele entra em fúria e começa a invocar Estilhaços durante a fase de órbita.',
  },
  // — Setor 5: Zona Tóxica —
  blight: {
    name: 'Blight',
    tagline: 'Inseto ácido que avança em zigue-zague e deixa poça ao morrer.',
    lore: 'Um inseto corrompido pelo rejeito químico da Ruína, criado em massa nos tanques de fermentação da Zona. Avança em linha irregular, mudando de direção como se estivesse fora de controle — porque está.',
    tactic: 'Individualmente frágil, mas mata-lo de perto enche o chão de poças de ácido. Prefira abate-lo à distância ou em movimento para não ficar cercado por hazards.',
  },
  vile: {
    name: 'Vile',
    tagline: 'Torre viva que cospe orbes de ácido em arco.',
    lore: 'Uma criatura inchada e bulbosa que fermenta toxina em seu interior. Não se aproxima: mantém distância e dispara glóbulos que corroem o chão onde caem.',
    tactic: 'O orbe de ácido descreve um arco visível — desvie enquanto ele voa, mas saiba que onde ele cair nasce uma poça. Ao morrer, explode em três poças de ácido em leque.',
  },
  ooze: {
    name: 'Ooze',
    tagline: 'Gosma que se divide em duas ao ser destruída.',
    lore: 'Um aglomerado instável de toxina semissólida. Sua membrana se rompe em duas crias menores quando a casca externa é violada.',
    tactic: 'Como o Fragmentador, mate-o à distância sempre que possível. As duas Mites que nascem são rápidas e deixam poças de ácido ao morrer.',
  },
  mite: {
    name: 'Mite',
    tagline: 'Cria do Ooze — pequena, rápida e deixa poça ao morrer.',
    lore: 'Uma gosma filha, instável e volátil, nascida apenas da destruição de um Ooze. Corre em linha reta e vibra até se desfazer.',
    tactic: 'HP baixíssimo, mas sempre aparece aos pares. Cada uma deixa uma poça de ácido ao morrer — não mate as duas no mesmo lugar.',
  },
  fume: {
    name: 'Fume',
    tagline: 'Bolsa de gás flutuante que pulsa toxina e queima por contato.',
    lore: 'Uma membrana distendida cheia de gás nervoso, mantida à deriva por correntes de ar tóxico da Zona. Ela não caça: preenche o espaço e castiga quem se aproxima.',
    tactic: 'Tem uma aura de dano passivo ao redor — não fique perto dela sem necessidade. A cada poucos segundos, pulsa um anel de gás que atinge uma área grande. O gás não deixa poça, mas o dano em área é traiçoeiro.',
  },
  crawler: {
    name: 'Crawler',
    tagline: 'Tanque químico que deixa um rastro de ácido por onde passa.',
    lore: 'Uma carapaça ambulante de metal e carne, apodrecida e reforçada, que expele toxina de cada poro. Anda devagar, mas cada passo envenena o chão que toca.',
    tactic: 'Lento como os outros pesados, mas seu rastro de ácido torna perigoso ficar atrás dele. Force-o a mudar de direção para que o rastro não bloqueie sua rota de fuga. Pode soltar coração ao morrer.',
  },
  miasma: {
    name: 'Miasma',
    tagline: 'O reator orgânico da Zona — chefe do setor 5.',
    lore: 'No centro da Zona Tóxica, onde o veneno é mais denso, o Miasma pulsa. Não é uma entidade que caça: é um núcleo de reator vivo que CORROMPE o espaço ao redor, enchendo a arena de ácido e gás até não sobrar chão seguro.',
    tactic: 'Duas fases, duas respostas: na saturação, desvie dos glóbulos de ácido e não deixe as poças acumularem; no vácuo tóxico, fique atento aos cones de gás e posicione-se nos vãos entre eles. Abaixo de 35% de vida, tudo acelera e os cones de gás dobram de largura.',
  },
  // — Setor 6: A Fundição —
  spark: {
    name: 'Fagulha',
    tagline: 'Centelha de metal fundido que salta sem direção certa.',
    lore: 'Uma lasca incandescente ejetada das forjas da Fundição. É instável por design: salta em zigue-zague e muda de direção sem aviso, como se fugisse do próprio calor que a mantém viva.',
    tactic: 'Frágil e imprevisível — o perigo é ser cercado. Ao morrer, deixa uma poça de metal derretido no chão; evite abatê-la perto da sua rota de fuga.',
  },
  cinder: {
    name: 'Brasa',
    tagline: 'Torre de calor que cospe glóbulos de metal fundido.',
    lore: 'Um carvão animado que fermenta magma em seu núcleo. Prefere manter distância, despejando glóbulos incandescentes que incendeiam o chão onde caem.',
    tactic: 'O glóbulo é mais lento que um projétil comum, mas deixa uma poça de fogo ao cair — desvie do glóbulo e da poça juntos. Ao morrer, explode em três poças em leque.',
  },
  cog: {
    name: 'Engrenagem',
    tagline: 'Roda dentada que avança e dispara em investidas retas.',
    lore: 'Uma engrenagem de aço forjado, despejada da linha de montagem ainda quente. Ela persegue o alvo em rolamento constante e, de repente, dispara numa investida cega que corta o campo.',
    tactic: 'O brilho no centro dela anuncia a investida: saia da linha reta assim que ela parar de acelerar. Ao morrer, estilhaça em seis fragmentos metálicos que voam em círculo.',
  },
  bellows: {
    name: 'Fornalha',
    tagline: 'Fole ambulante que pulsa ondas de calor e queima por contato.',
    lore: 'Um reservatório de ar superaquecido montado sobre pernas curtas, incapaz de perseguir qualquer coisa — mas preenche o espaço ao redor com calor sufocante.',
    tactic: 'Tem uma aura de dano passivo — não fique perto sem necessidade. A cada poucos segundos, solta um anel de calor que cobre uma área enorme. O anel não deixa poça, mas o dano em área é traiçoeiro.',
  },
  crusher: {
    name: 'Esmagador',
    tagline: 'Prensa hidráulica ambulante que pinga metal derretido.',
    lore: 'Um bloco de ferro e pistões mal calibrados, arrastado pelo chão da fábrica. Cada passo deixa uma poça de aço líquido, e seu peso é quase impossível de mover.',
    tactic: 'Lento como os outros pesados, mas o rastro de metal fundido torna perigoso ficar atrás dele. Force-o a mudar de direção para abrir espaço de manobra. Pode soltar coração ao morrer.',
  },
  titan: {
    name: 'Titã da Fundição',
    tagline: 'O golem de forja da Fundição — chefe do setor 6.',
    lore: 'No coração da Fundição, onde o calor é tão intenso que o ar treme, o Titã espera. Não é uma criatura: é uma prensa viva, um amálgama de sucata e alma de fogo que alterna entre rajadas de metal derretido, pancadas que estremecem o chão e chuvas de orbes incandescentes.',
    tactic: 'Três fases, três respostas: na forja orbital, desvie dos glóbulos em leque; na pancada, o Titã envia ondas de choque pelo chão — fique longe ou posicione-se nos vãos entre os anéis; na chuva de forja, orbes em expansão cobrem a arena — mova-se para as bordas do padrão. Abaixo de 35% de vida, tudo acelera e ele invoca Fagulhas durante a chuva de forja.',
  },
};

const ENEMY_ORDER: readonly EnemyKind[] = [
  'drone', 'dart', 'splitter', 'mini', 'wasp', 'tank', 'boss',
  'larva', 'spore', 'stinger', 'weaver', 'beetle', 'queen',
  'glyph', 'needle', 'pylon', 'mine', 'monolith', 'archivist',
  'crystal', 'shard', 'flake', 'geyser', 'glacier', 'zero',
  'blight', 'vile', 'ooze', 'mite', 'fume', 'crawler', 'miasma',
  'spark', 'cinder', 'cog', 'bellows', 'crusher', 'titan',
];

function waveAvailability(kind: EnemyKind): string {
  if (isBossKind(kind)) {
    const idx = SECTORS.findIndex((s) => s.boss.kind === kind);
    const first = idx * SECTOR_LEN + BAL.wave.bossEvery;
    return `Chefe do Setor ${idx + 1} — ondas ${first} e ${idx * SECTOR_LEN + SECTOR_LEN}`;
  }
  if (kind === 'mini') return 'Só nasce de um Fragmentador destruído';
  const found = firstWaveOf(kind);
  if (!found) return '—';
  return found.sector === 1
    ? `Aparece a partir da onda ${found.wave}`
    : `Setor ${found.sector} — a partir da onda ${found.wave}`;
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
  if (kind === 'weaver') {
    stats.push({ label: 'Dano por orbe do leque', value: String(Math.round(spec.dmg * 0.7)) });
  }
  if (kind === 'needle') {
    stats.push({ label: 'Dano da descarga', value: String(Math.round(spec.dmg * 0.82)) });
  }
  if (kind === 'pylon') {
    stats.push({ label: 'Rajada em cruz', value: `4 orbes (dano ${Math.round(spec.dmg * 0.62)} cada)` });
  }
  if (kind === 'spore') {
    stats.push({ label: 'Explosão ao morrer', value: `6 orbes (dano ${Math.round(spec.dmg * 0.7)} cada)` });
  }
  if (kind === 'mine') {
    stats.push({ label: 'Explosão magnética', value: `8 orbes (dano ${Math.round(spec.dmg * 0.68)} cada)` });
  }
  if (kind === 'stinger') {
    stats.push({ label: 'Velocidade da investida', value: '520' });
  }
  if (kind === 'shard') {
    stats.push({ label: 'Velocidade da investida', value: '560' });
    stats.push({ label: 'Fragmentos ao morrer', value: '3 projéteis em leque' });
  }
  if (kind === 'flake') {
    stats.push({ label: 'Orbe congelante (dano + lentidão)', value: `Dano ${Math.round(spec.dmg * 0.7)} + lentidão de 0.8s` });
  }
  if (kind === 'geyser') {
    stats.push({ label: 'Poça de gelo', value: `Dano ${Math.round(spec.dmg * 0.75)}, dura 3s` });
  }
  if (kind === 'glacier') {
    stats.push({ label: 'Anel congelante', value: `12 orbes (dano ${Math.round(spec.dmg * 0.4)} cada + lentidão)` });
  }
  if (kind === 'crystal') {
    stats.push({ label: 'Salto repentino', value: 'Avanço de 160px/s a cada ~2s' });
  }
  if (kind === 'blight') {
    stats.push({ label: 'Poça de ácido ao morrer', value: `Dano ${Math.round(spec.dmg * 0.4)}, dura 2.5s` });
  }
  if (kind === 'vile') {
    stats.push({ label: 'Orbe ácido (cria poça)', value: `Dano ${Math.round(spec.dmg * 0.7)} + poça de ${Math.round(spec.dmg * 0.6)} por 4s` });
    stats.push({ label: 'Morte explosiva', value: '3 poças de ácido em leque' });
  }
  if (kind === 'ooze') {
    stats.push({ label: 'Divisão ao morrer', value: '2 Mites (mini oozes)' });
  }
  if (kind === 'mite') {
    stats.push({ label: 'Poça de ácido ao morrer', value: `Dano ${Math.round(spec.dmg * 0.35)}, dura 2s` });
  }
  if (kind === 'fume') {
    stats.push({ label: 'Aura tóxica passiva', value: `Dano de ${Math.round(spec.dmg * 0.15)}/s em raio 60px` });
    stats.push({ label: 'Pulso de gás', value: `Dano ${Math.round(spec.dmg * 0.7)} em raio 180px` });
  }
  if (kind === 'crawler') {
    stats.push({ label: 'Rastro de ácido', value: 'Poças de dano 0.3x a cada ~1.5s' });
  }
  if (kind === 'spark') {
    stats.push({ label: 'Poça de metal ao morrer', value: `Dano ${Math.round(spec.dmg * 0.35)}, dura 2s` });
  }
  if (kind === 'cinder') {
    stats.push({ label: 'Glóbulo de metal (cria poça)', value: `Dano ${Math.round(spec.dmg * 0.7)} + poça de dano ${Math.round(spec.dmg * 0.6)} por 3.5s` });
    stats.push({ label: 'Morte explosiva', value: '3 poças de fogo em leque' });
  }
  if (kind === 'cog') {
    stats.push({ label: 'Velocidade da investida', value: '360' });
    stats.push({ label: 'Fragmentos ao morrer', value: '6 projéteis em círculo' });
  }
  if (kind === 'bellows') {
    stats.push({ label: 'Aura de calor passiva', value: `Dano de ${Math.round(spec.dmg * 0.12)}/s em raio 65px` });
    stats.push({ label: 'Pulso de calor', value: `Dano ${Math.round(spec.dmg * 0.65)} em raio 190px` });
  }
  if (kind === 'crusher') {
    stats.push({ label: 'Rastro de metal', value: 'Poças de dano 0.3x a cada ~1.5s' });
  }
  if (kind === 'tank' || kind === 'beetle' || kind === 'monolith' || kind === 'glacier' || kind === 'crusher') {
    stats.push({ label: 'Chance de soltar coração', value: pct(BAL.drops.heartChanceTank) });
  }
  if (kind === 'boss') {
    stats.push({ label: 'Vida na 1ª aparição (onda 5)', value: String(Math.round(BAL.wave.bossHp(5))) });
    stats.push({ label: 'Dano por projétil da rajada', value: String(Math.round(spec.dmg * 0.6)) });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}–${BAL.drops.bossCoins[1]} moedas + 1 coração` });
  }
  if (kind === 'queen') {
    stats.push({ label: 'Vida na 1ª aparição (onda 15)', value: String(Math.round((BAL.wave.bossHp(15) / 520) * spec.hp)) });
    stats.push({ label: 'Dano por orbe da espiral', value: String(Math.round(spec.dmg * 0.5)) });
    stats.push({ label: 'Invocação', value: '3 Larvas + 1 Esporo por ciclo' });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}–${BAL.drops.bossCoins[1]} moedas + 1 coração` });
  }
  if (kind === 'archivist') {
    stats.push({ label: 'Vida na 1ª aparição (onda 25)', value: String(Math.round((BAL.wave.bossHp(25) / 520) * spec.hp)) });
    stats.push({ label: 'Dano por orbe da grade', value: String(Math.round(spec.dmg * 0.48)) });
    stats.push({ label: 'Indexação', value: '3 Minas Ímã por ciclo (4 em fúria)' });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}-${BAL.drops.bossCoins[1]} moedas + 1 coracao` });
  }
  if (kind === 'zero') {
    stats.push({ label: 'Vida na 1ª aparição (onda 35)', value: String(Math.round((BAL.wave.bossHp(35) / 520) * spec.hp)) });
    stats.push({ label: 'Dano por orbe congelante', value: String(Math.round(spec.dmg * 0.45)) });
    stats.push({ label: 'Geiseres plantados por ciclo', value: '4 poças de gelo' });
    stats.push({ label: 'Feixe congelante', value: '5 orbes por rajada' });
    stats.push({ label: 'Invoca em fúria', value: '3 Estilhaços por ciclo' });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}-${BAL.drops.bossCoins[1]} moedas + 1 coração` });
  }
  if (kind === 'miasma') {
    stats.push({ label: 'Vida na 1ª aparição (onda 45)', value: String(Math.round((BAL.wave.bossHp(45) / 520) * spec.hp)) });
    stats.push({ label: 'Dano por glóbulo ácido', value: String(Math.round(spec.dmg * 0.38)) });
    stats.push({ label: 'Cones de gás por ciclo', value: '4 (120° cada, 180° em fúria)' });
    stats.push({ label: 'Glóbulos por salva', value: '4 (6 em fúria)' });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}-${BAL.drops.bossCoins[1]} moedas + 1 coração` });
  }
  if (kind === 'titan') {
    stats.push({ label: 'Vida na 1ª aparição (onda 55)', value: String(Math.round((BAL.wave.bossHp(55) / 520) * spec.hp)) });
    stats.push({ label: 'Dano por glóbulo de forja', value: String(Math.round(spec.dmg * 0.38)) });
    stats.push({ label: 'Glóbulos por salva', value: '4 (6 em fúria)' });
    stats.push({ label: 'Pancadas de choque por ciclo', value: '2 (3 em fúria)' });
    stats.push({ label: 'Orbes na chuva de forja', value: '8 (12 em fúria)' });
    stats.push({ label: 'Invoca em fúria', value: '3 Fagulhas por ciclo' });
    stats.push({ label: 'Recompensa ao cair', value: `${BAL.drops.bossCoins[0]}-${BAL.drops.bossCoins[1]} moedas + 1 coração` });
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
    tactic: 'Unidades pesadas (Tanque, Carrapaço) têm mais chance de derrubar moedas do que inimigos comuns, e todo chefe solta um bom punhado ao cair. Vale a pena buscar sobreviver mais ondas: o bônus por onda alcançada costuma valer mais que as moedas soltas em campo.',
    accent: '#ffc857',
    icon: spriteIcon(shapeSprite(COIN_SHAPE), 48),
    stats: [
      { label: 'Efeito', value: 'Compra melhorias permanentes no Hangar' },
      { label: 'Chance de queda (inimigo comum)', value: pct(BAL.drops.coinChance) },
      { label: 'Queda de unidade pesada', value: '3 moedas' },
      { label: 'Queda de chefe', value: `${BAL.drops.bossCoins[0]}–${BAL.drops.bossCoins[1]} moedas` },
      { label: 'Bônus por onda (fim de partida)', value: `${BAL.score.coinsPerWave} moedas por onda alcançada` },
    ],
  },
  {
    id: 'heart',
    name: 'Coração',
    tagline: 'Cura instantânea — recupera parte da sua vida máxima.',
    lore: 'Núcleo de energia vital deixado por inimigos mais resistentes ao caírem. Restaura parte da sua vida no instante em que é coletado.',
    tactic: 'Fique de olho na vida do chefe do setor: todo chefe solta um coração ao ser destruído, então não há problema em arriscar um pouco mais perto do fim da luta.',
    accent: '#ff5d73',
    icon: spriteIcon(heartSprite(), 48),
    stats: [
      { label: 'Efeito', value: 'Cura 25% da vida máxima' },
      { label: 'Queda de unidade pesada (Tanque, Carrapaço, Glaciar)', value: pct(BAL.drops.heartChanceTank) },
      { label: 'Queda de chefe', value: 'Sempre' },
    ],
  },
];

// ————— helper para renderizar ícone de skin —————

function skinCodexIcon(skin: typeof SKINS[number], size = 48): HTMLCanvasElement {
  return spriteIcon(shapeSprite({
    radius: 17, color: skin.color, points: skin.shape,
    fillAlpha: skin.fillAlpha ?? 0.3, innerDetail: skin.innerDetail,
  }), size);
}

const skinEntries: CodexEntry[] = SKINS.map((skin) => ({
  id: `skin-${skin.id}`,
  name: skin.name,
  tagline: skin.desc,
  lore: skin.price === 0
    ? 'A fuselagem padrão de fábrica, com assinatura ciano. Leve, equilibrada e responsiva — a escolha certa para qualquer missão, sem custo adicional.'
    : `Uma fuselagem de edição limitada, com geometria exclusiva e assinatura energética própria. Adquirida no Hangar por ${skin.price} moedas, ela altera não só a silhueta da nave, mas também a cor de cada disparo, o brilho das lâminas orbitais e o pulso da nova — uma identidade visual completa no campo de batalha.`,
  tactic: skin.price === 0
    ? 'Sempre disponível, sem custo. O desempenho é idêntico ao de qualquer outra fuselagem — a escolha é puramente estética.'
    : 'Cada fuselagem tem sua própria identidade visual, mas nenhuma oferece vantagem mecânica: a escolha é puramente estética. Compre no Hangar pela aba FUSELAGEM e equipe quantas quiser — a skin ativa persiste entre partidas.',
  accent: skin.color,
  icon: skinCodexIcon(skin, 52),
  stats: [
    { label: 'Preço', value: skin.price === 0 ? 'Grátis (padrão)' : `${skin.price} moedas` },
    { label: 'Cor do casco', value: skin.color },
    { label: 'Cor das balas', value: skin.bulletColor },
    { label: 'Cor das lâminas', value: skin.bladeColor },
    { label: 'Cor da nova', value: skin.novaColor },
  ],
}));

// ————— sistemas (ondas, combo, pontuação) —————

const systemEntries: CodexEntry[] = [
  {
    id: 'campaign',
    name: 'Modo Campanha',
    tagline: `${CAMPAIGN.length} fases fixas, cada uma com seu próprio desafio.`,
    lore: 'Fora da resistência sem fim do Modo Solo, o comando isolou confrontos específicos da Ruína para treinamento dirigido: fases curtas e desenhadas à mão, cada uma com sua própria composição de inimigos, objetivo e dificuldade.',
    tactic: 'Vencer uma fase destrava a seguinte — a progressão é linear. A nave usada é a mesma do Modo Solo, com todas as melhorias permanentes já compradas no Hangar, então cada fase pressupõe o poder de fogo que você já construiu até ali.',
    accent: '#ffc857',
    icon: paintIcon('power', '#ffc857', 48),
    stats: [
      { label: 'Fases', value: String(CAMPAIGN.length) },
      { label: 'Desbloqueio', value: 'Linear — termine uma fase para abrir a próxima' },
      { label: 'Objetivos', value: 'Sobreviver, abater um número de inimigos, ou derrotar um chefe' },
      { label: 'Progressão permanente', value: 'Usa as melhorias já compradas no Hangar' },
    ],
  },
  {
    id: 'coop',
    name: 'Operação em Dupla (CO-OP)',
    tagline: 'Duas naves, uma sala, um código — sobrevivam juntos.',
    lore: 'O comando autorizou operações em dupla: um piloto cria a sala, recebe um código curto e o parceiro entra com ele. A partida roda no servidor do comando — justa e idêntica para os dois — e a Ruína responde ao dobro de poder de fogo com enxames maiores e mais resistentes.',
    tactic: 'A experiência é individual: cada piloto enche a própria barra e escolhe suas melhorias sem pausar a batalha (com uma janela curta de invulnerabilidade). Se um cair, vira espectador e renasce no início da onda seguinte com metade da vida — a run só termina se os dois caírem na mesma onda. As moedas da dupla são somadas no fim e divididas igualmente.',
    accent: '#b45cff',
    icon: paintIcon('multi', '#b45cff', 48),
    stats: [
      { label: 'Pilotos', value: '2 (sala por código de 5 letras)' },
      { label: 'Vida dos inimigos', value: `+${Math.round((BAL.coop.hpMul - 1) * 100)}% (chefes +${Math.round((BAL.coop.bossHpMul - 1) * 100)}%)` },
      { label: 'Enxame', value: `+${Math.round((BAL.coop.maxAliveMul - 1) * 100)}% de inimigos simultâneos` },
      { label: 'Renascimento', value: `Onda seguinte, com ${pct(BAL.coop.reviveHpFrac)} da vida` },
      { label: 'Escolha de melhoria', value: `Sem pausa — ${BAL.coop.levelupInvuln}s de invulnerabilidade pessoal` },
      { label: 'Moedas', value: 'Pot da dupla dividido 50/50 no fim' },
      { label: 'Pontuação', value: 'Individual, por piloto' },
    ],
  },
  {
    id: 'sectors',
    name: 'Setores',
    tagline: `A rota do Modo Solo — a cada ${SECTOR_LEN} ondas, um mundo novo.`,
    lore: 'A cada dez ondas a partida viaja para um novo setor: outro cenário, outra trilha sonora, outros inimigos e um chefe próprio. O Campo da Ruína é só a porta de entrada: na onda 11, a Colmeia acorda; na onda 21, o Arquivo Magnético abre seus trilhos; na onda 31, a Estação Gélida congela o campo; na onda 41, a Zona Tóxica corrompe tudo; na onda 51, a Fundição acende suas forjas.',
    tactic: 'Cada setor tem seu próprio ecossistema de ameaças; as táticas que funcionavam no anterior podem não bastar. Quando a rota chega ao fim, ela recomeça do início — mas os inimigos voltam muito mais fortes.',
    accent: '#9dff2e',
    icon: paintIcon('thrusters', '#9dff2e', 48),
    stats: [
      { label: 'Duração de um setor', value: `${SECTOR_LEN} ondas` },
      ...SECTORS.map((s, i) => ({
        label: `Setor ${i + 1}`,
        value: `${s.name} — chefe: ${s.boss.name}`,
      })),
      { label: 'Depois do último setor', value: 'A rota recomeça, cada vez mais letal' },
    ],
  },
  {
    id: 'waves',
    name: 'Ondas',
    tagline: 'Cada onda tem uma leva fixa de inimigos — só acaba quando o último cai.',
    lore: 'Os inimigos daquela leva entram aos poucos, num ritmo que só acelera. A onda só termina quando todos eles forem abatidos; aí vem um respiro curto antes da próxima leva, mais forte, começar a aparecer.',
    tactic: `A cada ${BAL.wave.bossEvery} ondas, a leva regular é substituída por um confronto contra o chefe do setor atual, que precisa ser destruído para a progressão continuar.`,
    accent: '#35f0ff',
    icon: paintIcon('rate', '#35f0ff', 48),
    stats: [
      { label: 'Inimigos na onda 1', value: `${BAL.wave.quota(1)}` },
      { label: 'Como avança', value: 'Elimine todos os inimigos da leva' },
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

export const CODEX_INTRO = 'Referência completa de tudo que existe no Baluarte: nave, ameaças, poderes e recursos.';

export const CODEX: readonly CodexCategory[] = [
  { id: 'ship', label: 'Nave', intro: 'A única unidade ainda em campo contra a Ruína.', entries: [shipEntry, ...skinEntries] },
  { id: 'enemies', label: 'Ameaças', intro: 'Toda ameaça que você vai enfrentar, setor por setor: da Ruína ao Arquivo Magnético.', entries: enemyEntries },
  { id: 'upgrades', label: 'Combate', intro: 'Melhorias temporárias, escolhidas ao subir de nível durante a partida.', entries: upgradeEntries },
  { id: 'meta', label: 'Hangar', intro: 'Melhorias permanentes, compradas com moedas entre partidas.', entries: metaEntries },
  { id: 'resources', label: 'Recursos', intro: 'Tudo que você coleta no campo de batalha.', entries: resourceEntries },
  { id: 'systems', label: 'Sistemas', intro: 'Como a dificuldade, o combo e a pontuação funcionam.', entries: systemEntries },
];

/**
 * Joystick skins — each is a complete visual identity for the virtual
 * analog stick: ring color, knob color, glow, and UI accent.
 *
 * The default skin (Cibernético) is always free; the other six are
 * bought with coins in the Hangar and persist across runs.
 */

export interface JoystickSkinDef {
  id: string;
  name: string;
  desc: string;
  /** Purchase price in coins. 0 = always free (default). */
  price: number;
  /** Outer ring fill tint (idle). */
  ringColor: string;
  /** Outer ring fill alpha (idle). */
  ringFillIdle: number;
  /** Outer ring fill alpha (active/grabbed). */
  ringFillActive: number;
  /** Outer ring stroke alpha (idle). */
  ringStrokeIdle: number;
  /** Outer ring stroke alpha (active). */
  ringStrokeActive: number;
  /** Inner knob color. */
  knobColor: string;
  /** Knob fill alpha (idle). */
  knobIdle: number;
  /** Knob fill alpha (active). */
  knobActive: number;
  /** Shadow glow color when active. */
  glowColor: string;
  /** Accent used in HUD and UI elements. */
  accent: string;
}

/** All joystick skins available in the game. Index 0 is the default (always free). */
export const JOYSTICK_SKINS: readonly JoystickSkinDef[] = [
  // ── 0 · CIBERNÉTICO — padrão, sempre disponível ─────────────────
  {
    id: 'cibernetico',
    name: 'CIBERNÉTICO',
    desc: 'Analógico padrão. Assinatura ciano, traçado limpo e preciso.',
    price: 0,
    ringColor: '#7df3ff',
    ringFillIdle: 0.08,
    ringFillActive: 0.14,
    ringStrokeIdle: 0.26,
    ringStrokeActive: 0.5,
    knobColor: '#7df3ff',
    knobIdle: 0.4,
    knobActive: 0.85,
    glowColor: '#7df3ff',
    accent: '#7df3ff',
  },
  // ── 1 · MAGMA — lava / fogo ─────────────────────────────────────
  {
    id: 'magma',
    name: 'MAGMA',
    desc: 'Núcleo de lava. O calor do combate sob o polegar.',
    price: 450,
    ringColor: '#ff5d38',
    ringFillIdle: 0.07,
    ringFillActive: 0.15,
    ringStrokeIdle: 0.28,
    ringStrokeActive: 0.52,
    knobColor: '#ff9f43',
    knobIdle: 0.42,
    knobActive: 0.88,
    glowColor: '#ff5d38',
    accent: '#ff5d38',
  },
  // ── 2 · VOIDWALKER — púrpura / cósmico ──────────────────────────
  {
    id: 'voidwalker',
    name: 'VOIDWALKER',
    desc: 'Matéria escura. Um vórtice de energia violeta sob seus dedos.',
    price: 550,
    ringColor: '#b45cff',
    ringFillIdle: 0.06,
    ringFillActive: 0.13,
    ringStrokeIdle: 0.24,
    ringStrokeActive: 0.48,
    knobColor: '#e0aaff',
    knobIdle: 0.38,
    knobActive: 0.82,
    glowColor: '#b45cff',
    accent: '#b45cff',
  },
  // ── 3 · GLACIAL — gelo / cristal ─────────────────────────────────
  {
    id: 'glacial',
    name: 'GLACIAL',
    desc: 'Cristal perpétuo. O gelo da Estação Gélida no controle.',
    price: 600,
    ringColor: '#52ffa8',
    ringFillIdle: 0.08,
    ringFillActive: 0.16,
    ringStrokeIdle: 0.3,
    ringStrokeActive: 0.55,
    knobColor: '#35f0ff',
    knobIdle: 0.45,
    knobActive: 0.9,
    glowColor: '#52ffa8',
    accent: '#52ffa8',
  },
  // ── 4 · SOLARIS — dourado / sol ──────────────────────────────────
  {
    id: 'solaris',
    name: 'SOLARIS',
    desc: 'Força solar. Um sol em miniatura guiando sua nave.',
    price: 800,
    ringColor: '#ffc857',
    ringFillIdle: 0.09,
    ringFillActive: 0.17,
    ringStrokeIdle: 0.32,
    ringStrokeActive: 0.56,
    knobColor: '#ffe9b0',
    knobIdle: 0.48,
    knobActive: 0.92,
    glowColor: '#ffc857',
    accent: '#ffc857',
  },
  // ── 5 · NÉON — fluorescente / synthwave ──────────────────────────
  {
    id: 'neon',
    name: 'NÉON',
    desc: 'Onda dos anos 80. Traços fluorescentes numa explosão retrô.',
    price: 1000,
    ringColor: '#ff2e8a',
    ringFillIdle: 0.08,
    ringFillActive: 0.15,
    ringStrokeIdle: 0.28,
    ringStrokeActive: 0.52,
    knobColor: '#9dff2e',
    knobIdle: 0.44,
    knobActive: 0.88,
    glowColor: '#ff2e8a',
    accent: '#ff2e8a',
  },
  // ── 6 · OBSIDIANA — luxo / premium ──────────────────────────────
  {
    id: 'obsidiana',
    name: 'OBSIDIANA',
    desc: 'Luxo enegrecido. Ouro negro com detalhes prateados — para quem já venceu de tudo.',
    price: 1500,
    ringColor: '#8fa3c8',
    ringFillIdle: 0.05,
    ringFillActive: 0.11,
    ringStrokeIdle: 0.22,
    ringStrokeActive: 0.44,
    knobColor: '#eaf6ff',
    knobIdle: 0.36,
    knobActive: 0.78,
    glowColor: '#8fa3c8',
    accent: '#8fa3c8',
  },
];

/** Look up a joystick skin by ID; returns Cibernético (default) on unknown ID. */
export function joystickSkinById(id: string): JoystickSkinDef {
  return JOYSTICK_SKINS.find((s) => s.id === id) ?? JOYSTICK_SKINS[0];
}

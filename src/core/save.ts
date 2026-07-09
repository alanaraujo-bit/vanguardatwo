export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type BackgroundQuality = 'off' | 'low' | 'full';
/** 0 = sem limite. */
export type FpsCap = 0 | 30 | 60;
/**
 * 'free': touch starts anywhere on screen (today's behavior).
 * 'bottomHalf': touch must start in the screen's bottom half, so the thumb
 * (and the stick it draws) never covers the upper play field.
 */
export type ControlScheme = 'free' | 'bottomHalf';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  /** Multiplica o devicePixelRatio em Viewport.resize(). 0.5–1. */
  resolutionScale: number;
  /** Multiplica o cap de inimigos/gemas (só solo/campanha) e o de floaters (solo+coop). 0.4–1. */
  entityDensity: number;
  /** Alimenta Particles.quality diretamente. 0–1. */
  particleQuality: number;
  screenShake: boolean;
  /** Só o shadowBlur por-frame (combo HUD, seta do parceiro no coop) — glow assado em sprites nunca é gateado. */
  glow: boolean;
  background: BackgroundQuality;
  vignette: boolean;
  hitStop: boolean;
  fpsCap: FpsCap;
  fpsCounter: boolean;
}

export interface Settings {
  sfx: boolean;
  music: boolean;
  haptics: boolean;
  /** @deprecated Substituído por graphics.preset; só lido na migração de saves antigos. */
  lowFx: boolean;
  graphics: GraphicsSettings;
  controlScheme: ControlScheme;
}

const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, Omit<GraphicsSettings, 'preset'>> = {
  low: {
    resolutionScale: 0.75, entityDensity: 0.6, particleQuality: 0.35,
    screenShake: true, glow: false, background: 'low', vignette: false,
    hitStop: true, fpsCap: 30, fpsCounter: false,
  },
  medium: {
    resolutionScale: 0.85, entityDensity: 0.8, particleQuality: 0.6,
    screenShake: true, glow: true, background: 'low', vignette: true,
    hitStop: true, fpsCap: 60, fpsCounter: false,
  },
  high: {
    resolutionScale: 1, entityDensity: 1, particleQuality: 1,
    screenShake: true, glow: true, background: 'full', vignette: true,
    hitStop: true, fpsCap: 60, fpsCounter: false,
  },
  ultra: {
    resolutionScale: 1, entityDensity: 1, particleQuality: 1,
    screenShake: true, glow: true, background: 'full', vignette: true,
    hitStop: true, fpsCap: 0, fpsCounter: false,
  },
};

export function applyPreset(preset: Exclude<GraphicsPreset, 'custom'>): GraphicsSettings {
  return { ...GRAPHICS_PRESETS[preset], preset };
}

/**
 * Heurística de dispositivo pro primeiro boot (sem save nenhum de gráficos
 * ainda). Ultra nunca é auto-selecionado: é o único tier que pode piorar o
 * problema de lag em celular que essa feature existe pra resolver.
 */
function detectGraphicsPreset(): GraphicsSettings {
  // core/save.ts is reachable (type-only) from the Node-side Vercel functions
  // via net/protocol.ts, which has no DOM lib — go through globalThis with a
  // structural type instead of bare `window`/`matchMedia` identifiers so this
  // still type-checks there. Harmless: detectGraphicsPreset() is only ever
  // called client-side (see defaults()/parse() below).
  const g = globalThis as unknown as {
    matchMedia?: (query: string) => { matches: boolean };
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
    navigator?: { hardwareConcurrency?: number };
  };
  const coarse = typeof g.matchMedia === 'function' && g.matchMedia('(pointer: coarse)').matches;
  const cores = g.navigator?.hardwareConcurrency || 4;
  const dpr = Math.min(g.devicePixelRatio || 1, 3);
  const minDim = Math.min(g.innerWidth || 800, g.innerHeight || 600);

  if (!coarse) {
    // Mouse/trackpad primário = classe desktop/notebook.
    return applyPreset(cores <= 2 ? 'medium' : 'high');
  }
  // Toque primário: viés pra Médio/Baixo.
  if (cores <= 4 || minDim < 380) return applyPreset('low');
  if (cores <= 6 || dpr >= 3) return applyPreset('medium');
  return applyPreset('high'); // só tablets/celulares topo de linha
}

export interface SaveData {
  v: number;
  coins: number;
  bestWave: number;
  bestScore: number;
  /** Longest single-run survival, in seconds. */
  bestTime: number;
  /** Most coins earned in a single run. */
  bestCoins: number;
  runs: number;
  totalKills: number;
  /** Lifetime seconds survived across all runs. */
  totalTime: number;
  /** Public pilot name, chosen right after the tutorial ('' until then). */
  name: string;
  /** Whether the first-boot flow (tutorial → name → login) was completed. */
  onboarded: boolean;
  tutorialDone: boolean;
  meta: Record<string, number>;
  settings: Settings;
  /** Highest campaign level unlocked (1-based; 1 = only the first level). */
  campaignLevel: number;
  /** Best stars earned per campaign level ID (0 = unplayed, 1-3 = stars). */
  campaignStars: Record<string, number>;
  /** Equipped skin ID (default 'aegis'). */
  skin: string;
  /** Owned skin IDs (purchased with coins). */
  ownedSkins: string[];
}

const GUEST_KEY = 'vanguarda.save.v1';
const ACCOUNT_PREFIX = 'vanguarda.save.acct.';
const MERGED_FLAG = 'vanguarda.save.mergedToAccount';

function defaults(): SaveData {
  return {
    v: 3,
    coins: 0,
    bestWave: 0,
    bestScore: 0,
    bestTime: 0,
    bestCoins: 0,
    runs: 0,
    totalKills: 0,
    totalTime: 0,
    name: '',
    onboarded: false,
    tutorialDone: false,
    meta: {},
    settings: {
      sfx: true, music: true, haptics: true, lowFx: false,
      graphics: detectGraphicsPreset(), controlScheme: 'free',
    },
    campaignLevel: 1,
    campaignStars: {},
    skin: 'aegis',
    ownedSkins: [],
  };
}

function parse(raw: string): SaveData {
  const parsed = JSON.parse(raw) as Partial<SaveData>;
  const base = defaults();
  const savedGraphics = parsed.settings?.graphics;
  // Merge de 2 níveis só pra graphics: um merge raso (como o resto de
  // Settings usa) vazaria o objeto salvo inteiro por cima dos defaults,
  // então campos novos introduzidos depois nunca apareceriam pra quem já
  // tem um save. Migração pra quem nunca teve graphics: um "Modo
  // desempenho" (lowFx) explicitamente ligado é um sinal real, vira Baixo;
  // ausente/desligado não é sinal nenhum (a maioria nunca abriu
  // Configurações), então deixa a detecção de dispositivo decidir em vez
  // de assumir Alto.
  const graphics: GraphicsSettings = savedGraphics
    ? { ...base.settings.graphics, ...savedGraphics }
    : parsed.settings?.lowFx === true
      ? applyPreset('low')
      : detectGraphicsPreset();
  const data: SaveData = {
    ...base,
    ...parsed,
    meta: { ...(parsed.meta ?? {}) },
    campaignStars: (parsed.campaignStars ?? {}),
    skin: typeof parsed.skin === 'string' ? parsed.skin : 'aegis',
    ownedSkins: Array.isArray(parsed.ownedSkins) ? parsed.ownedSkins : [],
    settings: { ...base.settings, ...(parsed.settings ?? {}), graphics },
  };
  // v1 → v2: veterans never see the forced onboarding flow.
  if ((parsed.v ?? 1) < 2) {
    data.onboarded = (parsed.runs ?? 0) > 0 || parsed.tutorialDone === true;
    data.v = 2;
  }
  // v2 → v3: settings.graphics introduzido; já migrado campo-a-campo acima.
  if ((parsed.v ?? 1) < 3) {
    data.v = 3;
  }
  return data;
}

/**
 * All persistence, in localStorage. The guest save lives under a fixed key;
 * once a player logs in the system switches to a per-account key so two
 * people sharing a device never mix progress.
 */
export class SaveSystem {
  data: SaveData = defaults();

  /** Fired after every persist — cloud sync hooks in here (set in main.ts). */
  onPersist: (() => void) | null = null;

  private key = GUEST_KEY;

  load(): void {
    try {
      const raw = localStorage.getItem(this.key);
      this.data = raw ? parse(raw) : defaults();
    } catch {
      this.data = defaults();
    }
  }

  persist(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      // storage full or unavailable — the game keeps running, progress is just not saved
    }
    this.onPersist?.();
  }

  reset(): void {
    const settings = this.data.settings;
    const name = this.data.name;
    const onboarded = this.data.onboarded;
    this.data = defaults();
    this.data.settings = settings;
    this.data.name = name;
    this.data.onboarded = onboarded;
    this.persist();
  }

  /** Bind persistence to the logged-in player's own slot and load it. */
  switchToAccount(playerId: string): void {
    this.key = ACCOUNT_PREFIX + playerId;
    this.load();
  }

  /** Back to the device-local guest slot (logout). */
  switchToGuest(): void {
    this.key = GUEST_KEY;
    this.load();
  }

  get onAccountSlot(): boolean {
    return this.key !== GUEST_KEY;
  }

  /**
   * The guest save, if it was never merged into an account on this device.
   * Returns null after the first merge so a second person logging in on the
   * same device does not absorb someone else's guest progress.
   */
  guestDataForMerge(): SaveData | null {
    try {
      if (localStorage.getItem(MERGED_FLAG)) return null;
      const raw = localStorage.getItem(GUEST_KEY);
      return raw ? parse(raw) : null;
    } catch {
      return null;
    }
  }

  markGuestMerged(): void {
    try {
      localStorage.setItem(MERGED_FLAG, '1');
    } catch {
      // best effort
    }
  }

  /**
   * Wipe the device-local guest slot back to a clean sheet (keeping only
   * settings). Called right after a successful login merge — otherwise the
   * guest slot keeps whatever pre-login snapshot it had forever, and every
   * later logout on this device shows that stale progress instead of a
   * fresh local profile.
   */
  resetGuestSlot(): void {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      const prevSettings = raw ? parse(raw).settings : undefined;
      const fresh = defaults();
      if (prevSettings) fresh.settings = prevSettings;
      localStorage.setItem(GUEST_KEY, JSON.stringify(fresh));
      if (this.key === GUEST_KEY) this.data = fresh;
    } catch {
      // best effort
    }
  }
}

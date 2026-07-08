export interface Settings {
  sfx: boolean;
  music: boolean;
  haptics: boolean;
  lowFx: boolean;
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
}

const GUEST_KEY = 'vanguarda.save.v1';
const ACCOUNT_PREFIX = 'vanguarda.save.acct.';
const MERGED_FLAG = 'vanguarda.save.mergedToAccount';

function defaults(): SaveData {
  return {
    v: 2,
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
    settings: { sfx: true, music: true, haptics: true, lowFx: false },
    campaignLevel: 1,
  };
}

function parse(raw: string): SaveData {
  const parsed = JSON.parse(raw) as Partial<SaveData>;
  const base = defaults();
  const data: SaveData = {
    ...base,
    ...parsed,
    meta: { ...(parsed.meta ?? {}) },
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
  };
  // v1 → v2: veterans never see the forced onboarding flow.
  if ((parsed.v ?? 1) < 2) {
    data.onboarded = (parsed.runs ?? 0) > 0 || parsed.tutorialDone === true;
    data.v = 2;
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
}

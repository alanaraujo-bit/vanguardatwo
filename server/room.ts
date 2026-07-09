import type { WebSocket } from 'ws';
import { BAL } from '../src/game/balance';
import { applyRoomConfigToTuning, clampRoomConfig, type RoomConfig } from '../src/game/room-config';
import { SECTORS } from '../src/game/sectors';
import { CoopSim, statsForMeta, type CoopTuning } from '../src/game/sim';
import { UPGRADE_DEFS, type Stats } from '../src/game/upgrades';
import {
  MAX_PLAYERS, SIM_RATE, SNAP_RATE,
  type EndResult, type RoomPlayer, type ServerMsg,
} from '../src/net/realtime';
import { persistCoopResults } from './persist';
import { encodeSnap } from './snapshot';

const TICK_MS = 1000 / SIM_RATE;
const TICKS_PER_SNAP = Math.round(SIM_RATE / SNAP_RATE);
/** Hard cap on match length — a stuck room never leaks its interval. */
const MAX_MATCH_MS = 90 * 60 * 1000;
/** How long a finished room lingers before being destroyed. */
const LINGER_MS = 60 * 1000;


export interface Client {
  ws: WebSocket;
  name: string;
  guest: boolean;
  playerId: string | null;
  meta: Record<string, number>;
  room: Room | null;
  slot: number;
  /** Latest movement intent (server applies the freshest one each tick). */
  lastSeq: number;
  mx: number;
  my: number;
}

export function send(client: Client, msg: ServerMsg): void {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

const ROOM_ID_LISTS = {
  sectorIds: SECTORS.map((s) => s.id),
  upgradeIds: UPGRADE_DEFS.map((u) => u.id),
};

/** Full clamp against the real sector/upgrade id lists (never trust the client). */
export function clampRoomConfigStrict(raw: unknown): RoomConfig {
  return clampRoomConfig(raw, ROOM_ID_LISTS);
}

export class Room {
  state: 'lobby' | 'playing' | 'ended' = 'lobby';
  readonly createdAt = Date.now();

  private readonly slots: (Client | null)[] = new Array(MAX_PLAYERS).fill(null);
  private readonly readyFlags: boolean[] = new Array(MAX_PLAYERS).fill(false);
  private sim: CoopSim | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAt = 0;
  private startedAt = 0;

  constructor(
    readonly code: string,
    private readonly onDestroy: (room: Room) => void,
    /** Non-null = custom room (Sala Personalizada); rules already clamped. */
    private cfg: RoomConfig | null = null,
  ) {}

  get isCustom(): boolean {
    return this.cfg !== null;
  }

  get playerCount(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  get hostSlot(): number {
    return this.slots.findIndex((s) => s !== null);
  }

  isExpiredLobby(now: number): boolean {
    return this.state === 'lobby' && now - this.createdAt > 5 * 60 * 1000;
  }

  join(client: Client): boolean {
    if (this.state !== 'lobby') return false;
    const slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) return false;
    this.slots[slot] = client;
    this.readyFlags[slot] = false;
    client.room = this;
    client.slot = slot;
    send(client, { t: 'welcome', slot, guest: client.guest });
    this.broadcastRoom();
    return true;
  }

  leave(client: Client): void {
    if (this.slots[client.slot] !== client) return;
    this.slots[client.slot] = null;
    this.readyFlags[client.slot] = false;
    client.room = null;
    if (this.playerCount === 0) {
      this.destroy();
      return;
    }
    // Mid-match the departed pilot's ship simply goes idle (reconnection
    // support lands in a later phase); the partner plays on.
    this.broadcastRoom();
  }

  setReady(client: Client, ready: boolean): void {
    if (this.state !== 'lobby') return;
    this.readyFlags[client.slot] = ready;
    this.broadcastRoom();
  }

  /** Host replaces the rules of a custom room while still in the lobby. */
  setConfig(client: Client, raw: unknown): 'ok' | 'not_host' | 'bad_msg' {
    if (this.state !== 'lobby' || this.cfg === null) return 'bad_msg';
    if (client.slot !== this.hostSlot) return 'not_host';
    this.cfg = clampRoomConfigStrict(raw);
    this.broadcastRoom();
    return 'ok';
  }

  start(client: Client): 'ok' | 'not_host' | 'bad_msg' {
    if (this.state !== 'lobby') return 'bad_msg';
    if (client.slot !== this.hostSlot) return 'not_host';
    const present = this.slots.filter((s): s is Client => s !== null);
    if (!present.every((c) => this.readyFlags[c.slot] || c.slot === this.hostSlot)) return 'bad_msg';

    // Compact occupied slots into sim slots 0..n-1 (a lobby gap must not
    // become a ghost player).
    present.forEach((c, i) => {
      c.slot = i;
      this.slots[i] = c;
    });
    for (let i = present.length; i < MAX_PLAYERS; i++) this.slots[i] = null;

    const cfg = this.cfg;
    const base: Partial<CoopTuning> = present.length >= 2 ? BAL.coop : {};
    // Player-side multipliers wrap statsFor so every in-run recompute
    // (upgrade picks included) keeps the room rules applied.
    const scale = cfg
      ? (s: Stats): Stats => ({ ...s, maxHp: Math.round(s.maxHp * cfg.playerHpMul), damage: s.damage * cfg.playerDmgMul })
      : (s: Stats): Stats => s;
    const metaFns = present.map((c) => statsForMeta(c.meta));
    this.sim = new CoopSim({
      playerCount: present.length,
      statsFor: (slot, lv) => scale(metaFns[slot](slot, lv)),
      tuning: cfg ? applyRoomConfigToTuning(base, cfg) : base,
      waves: cfg
        ? {
            sectorLen: cfg.wavesPerSector,
            bossEvery: cfg.bossEvery,
            progression: cfg.progression,
            startSectorId: cfg.startSector === 'random' ? undefined : cfg.startSector,
          }
        : undefined,
      bannedUpgrades: cfg?.bannedUpgrades,
    });
    this.state = 'playing';
    this.startedAt = Date.now();
    this.broadcast({
      t: 'start',
      tick: 0,
      seed: Math.floor(Math.random() * 0xffffffff),
      sectorId: this.sim.currentSectorId,
      cfg: cfg ?? undefined,
    });
    this.nextTickAt = Date.now() + TICK_MS;
    this.timer = setTimeout(this.loop, TICK_MS);
    return 'ok';
  }

  applyInput(client: Client, seq: number, mx: number, my: number): void {
    if (!Number.isFinite(seq) || !Number.isFinite(mx) || !Number.isFinite(my)) return;
    if (seq <= client.lastSeq) return;
    client.lastSeq = seq;
    client.mx = Math.max(-1, Math.min(1, mx));
    client.my = Math.max(-1, Math.min(1, my));
  }

  applyPick(client: Client, offerId: number, upgradeId: string): void {
    this.sim?.applyPick(client.slot, offerId, upgradeId);
  }

  get simTick(): number {
    return this.sim?.tickNo ?? 0;
  }

  private readonly loop = (): void => {
    const sim = this.sim;
    if (!sim || this.state !== 'playing') return;

    this.tickOnce();

    if (sim.over || Date.now() - this.startedAt > MAX_MATCH_MS) {
      this.finish();
      return;
    }

    this.nextTickAt += TICK_MS;
    // If the event loop stalled badly, resync instead of bursting catch-up ticks.
    if (Date.now() - this.nextTickAt > 5 * TICK_MS) this.nextTickAt = Date.now();
    this.timer = setTimeout(this.loop, Math.max(0, this.nextTickAt - Date.now()));
  };

  private tickOnce(): void {
    const sim = this.sim!;
    for (const c of this.slots) {
      if (c) sim.setIntent(c.slot, c.mx, c.my);
    }
    sim.tick();

    for (const offer of sim.drainOffers()) {
      const c = this.slots[offer.slot];
      if (c) {
        send(c, {
          t: 'offer',
          offerId: offer.offerId,
          slot: offer.slot,
          choices: offer.choices,
          deadlineTick: offer.deadlineTick,
        });
      }
    }

    if (sim.tickNo % TICKS_PER_SNAP === 0) {
      const base = encodeSnap(sim);
      for (const c of this.slots) {
        if (c) send(c, { t: 'snap', s: { ...base, ack: c.lastSeq } });
      }
    }
  }

  private finish(): void {
    const sim = this.sim;
    if (!sim) return;
    this.state = 'ended';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const simResults = sim.results();

    // Custom rooms never touch the economy: no coin credit, no DB row, no
    // leaderboard trail — a friend can dial enemy HP to the floor and farm
    // nothing (permanent Hangar upgrades still applied to stats, unaffected).
    if (this.isCustom) {
      const results: EndResult[] = simResults.map((r) => ({
        ...r,
        coinsEarned: 0,
        name: this.slots[r.slot]?.name ?? '—',
        newCoinTotal: null,
      }));
      this.broadcast({ t: 'end', results });
      setTimeout(() => this.destroy(), LINGER_MS);
      return;
    }

    const roster = this.slots
      .filter((c): c is Client => c !== null)
      .map((c) => ({ slot: c.slot, playerId: c.playerId }));

    // Credit accounts first so the 'end' message can carry the new totals;
    // any DB hiccup degrades to local crediting on the client (null).
    void persistCoopResults(roster, simResults, roster.length)
      .catch((e) => {
        console.error('[room] persist falhou', e);
        return new Map<number, number | null>();
      })
      .then((totals) => {
        const results: EndResult[] = simResults.map((r) => ({
          ...r,
          name: this.slots[r.slot]?.name ?? '—',
          newCoinTotal: totals.get(r.slot) ?? null,
        }));
        this.broadcast({ t: 'end', results });
      });
    setTimeout(() => this.destroy(), LINGER_MS);
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const c of this.slots) {
      if (c) c.room = null;
    }
    this.slots.fill(null);
    this.onDestroy(this);
  }

  broadcastRoom(): void {
    const players: RoomPlayer[] = [];
    for (const c of this.slots) {
      if (c) players.push({ slot: c.slot, name: c.name, ready: this.readyFlags[c.slot], connected: true });
    }
    this.broadcast({ t: 'room', code: this.code, hostSlot: this.hostSlot, players, cfg: this.cfg ?? undefined });
  }

  private broadcast(msg: ServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const c of this.slots) {
      if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(raw);
    }
  }
}

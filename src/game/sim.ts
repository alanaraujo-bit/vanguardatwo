import { clamp, dist2, len } from '../core/utils';
import { SIM_DT, ENEMY_KINDS, type SimEvent } from '../net/realtime';
import { BAL } from './balance';
import { Enemies, isBossKind, type Enemy, type EnemyKind } from './enemies';
import { Pickups } from './pickups';
import { Player } from './player';
import { EnemyShots, PlayerShots } from './projectiles';
import { computeStats, rollChoices, UPGRADE_DEFS, type Stats } from './upgrades';
import { WaveDirector } from './waves';
import { Nova, Orbitals } from './weapons';
import type { AudioSink, FloaterSink, ParticleSink, World } from './world';
import type { SfxName } from '../audio/audio';

/**
 * The co-op match simulation: GameScene's gameplay core with the
 * presentation stripped out. Runs identically in the browser (local testing)
 * and on the game server (the authoritative copy). All output is state
 * (read by the snapshot encoder) plus a queue of SimEvents / SimOffers
 * drained once per snapshot window.
 */

export interface CoopTuning {
  /** Enemy HP/damage multipliers for party play. */
  hpMul: number;
  dmgMul: number;
  bossHpMul: number;
  /** Spawn budget multipliers (more simultaneous enemies, bigger batches). */
  maxAliveMul: number;
  batchMul: number;
  /** Revive HP fraction at the start of the next wave. */
  reviveHpFrac: number;
  /** Max seconds a level-up offer stays open (then auto-picks first choice). */
  levelupInvuln: number;
}

export const NEUTRAL_TUNING: CoopTuning = {
  hpMul: 1,
  dmgMul: 1,
  bossHpMul: 1,
  maxAliveMul: 1,
  batchMul: 1,
  reviveHpFrac: 0.5,
  levelupInvuln: 6,
};

export interface SimOffer {
  offerId: number;
  slot: number;
  choices: string[];
  deadlineTick: number;
}

export interface SimResult {
  slot: number;
  score: number;
  kills: number;
  wave: number;
  time: number;
  /** This player's share of the party coin pot (already split). */
  coinsEarned: number;
}

export interface CoopSimOpts {
  playerCount: number;
  /** Resolves a player's full stats from their meta + in-run upgrade levels. */
  statsFor: (slot: number, lv: (id: string) => number) => Stats;
  tuning?: Partial<CoopTuning>;
}

/** Fallback statsFor for players with no meta (guests, tests). */
export function statsForMeta(meta: Record<string, number>): (slot: number, lv: (id: string) => number) => Stats {
  const fakeSave = { meta } as Parameters<typeof computeStats>[0];
  return (_slot, lv) => computeStats(fakeSave, lv);
}

/** Spawn-time difficulty scaling for party play, without touching Enemies. */
class CoopEnemies extends Enemies {
  constructor(private readonly tuning: CoopTuning) {
    super();
  }

  override spawn(kind: EnemyKind, x: number, y: number, hpMul: number, dmgMul: number): Enemy {
    const hp = isBossKind(kind) ? this.tuning.bossHpMul : this.tuning.hpMul;
    return super.spawn(kind, x, y, hpMul * hp, dmgMul * this.tuning.dmgMul);
  }
}

const NOOP_PARTICLES: ParticleSink = { spawn() {}, burst() {}, ring() {} };
/** Nominal view rect used to place spawns just off-screen (world units). */
const VIEW_W = 1280;
const VIEW_H = 720;
const SPAWN_MARGIN = 48;
const MAX_EVENTS = 96;
const MAX_DMG_EVENTS = 24;
const MAX_SAME_SFX = 2;

export class CoopSim implements World {
  // — World contract —
  time = 0;
  runTime = 0;
  players: Player[] = [];
  enemies: Enemies;
  playerShots = new PlayerShots();
  enemyShots = new EnemyShots();
  pickups = new Pickups();
  particles = NOOP_PARTICLES;
  floaters: FloaterSink;
  audio: AudioSink;

  tickNo = 0;
  over = false;

  private readonly tuning: CoopTuning;
  private readonly statsFor: CoopSimOpts['statsFor'];
  private readonly upgLevels: Map<string, number>[] = [];
  private readonly combo: number[] = [];
  private readonly comboT: number[] = [];
  private readonly gemStreak: number[] = [];
  private readonly gemStreakT: number[] = [];
  private readonly kills: number[] = [];
  private readonly killScore: number[] = [];
  private readonly coins: number[] = [];
  private readonly openOffers: SimOffer[] = [];
  private readonly newOffers: SimOffer[] = [];
  private readonly ev: SimEvent[] = [];
  private nextOfferId = 1;
  private readonly waves: WaveDirector;

  /** One weapon set per player: levels come from that player's stats. */
  private readonly orbitals: Orbitals[] = [];
  private readonly novas: Nova[] = [];

  constructor(opts: CoopSimOpts) {
    this.tuning = { ...NEUTRAL_TUNING, ...opts.tuning };
    this.statsFor = opts.statsFor;
    this.enemies = new CoopEnemies(this.tuning);
    this.floaters = {
      spawn: (x, y, text) => {
        // Enemy damage numbers arrive here as plain integers; +coin/-hurt
        // floaters are covered by their own typed events.
        const v = Number(text);
        if (!Number.isInteger(v) || v <= 0) return;
        this.pushDmg(x, y, v);
      },
    };
    this.audio = {
      play: (name, pitch) => this.pushSfx(name, pitch),
    };

    for (let slot = 0; slot < opts.playerCount; slot++) {
      this.upgLevels.push(new Map());
      this.combo.push(0);
      this.comboT.push(0);
      this.gemStreak.push(0);
      this.gemStreakT.push(0);
      this.kills.push(0);
      this.killScore.push(0);
      this.coins.push(0);
      const p = new Player(this.statsFor(slot, this.lvFor(slot)));
      p.slot = slot;
      p.x = slot === 0 ? -60 : 60;
      p.y = 0;
      this.players.push(p);
      this.orbitals.push(new Orbitals());
      this.novas.push(new Nova());
    }

    this.waves = new WaveDirector({
      onWave: (wave) => {
        this.reviveDead();
        this.push({ e: 'wave', n: wave });
        this.pushSfx('wave');
      },
      onBossWarn: () => {
        this.reviveDead();
        this.push({ e: 'bossWarn' });
        this.pushSfx('warn');
      },
      onSector: (_sector, number) => {
        this.reviveDead();
        this.push({ e: 'sector', n: number });
        this.pushSfx('sector');
      },
    }, { maxAliveMul: this.tuning.maxAliveMul, batchMul: this.tuning.batchMul });

    // Welcome party, same as the solo opener: action from second zero.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
      this.enemies.spawn('drone', Math.cos(a) * 330, Math.sin(a) * 330, 1, 1);
    }
  }

  get wave(): number {
    return this.waves.wave;
  }

  private lvFor(slot: number): (id: string) => number {
    return (id) => this.upgLevels[slot].get(id) ?? 0;
  }

  setIntent(slot: number, mx: number, my: number): void {
    const p = this.players[slot];
    if (!p) return;
    const d = len(mx, my);
    const s = d > 1 ? 1 / d : 1;
    p.intent.mx = clamp(mx * s, -1, 1);
    p.intent.my = clamp(my * s, -1, 1);
  }

  tick(): void {
    if (this.over) return;
    this.tickNo++;
    this.time += SIM_DT;
    this.runTime += SIM_DT;

    for (let slot = 0; slot < this.players.length; slot++) {
      this.comboT[slot] -= SIM_DT;
      if (this.comboT[slot] <= 0) this.combo[slot] = 0;
      this.gemStreakT[slot] -= SIM_DT;
      if (this.gemStreakT[slot] <= 0) this.gemStreak[slot] = 0;
    }

    // Level-up offers: expire (auto-pick) and keep the chooser untouchable.
    for (let i = this.openOffers.length - 1; i >= 0; i--) {
      const offer = this.openOffers[i];
      const p = this.players[offer.slot];
      if (this.tickNo >= offer.deadlineTick) {
        this.applyPick(offer.slot, offer.offerId, offer.choices[0]);
        continue;
      }
      if (!p.dead) p.iframes = Math.max(p.iframes, SIM_DT * 2);
    }

    for (const p of this.players) p.update(SIM_DT, this);
    this.waves.update(SIM_DT, this);
    this.enemies.update(SIM_DT, this);
    // Player bolts travel ~19px per 30Hz tick — substep so they can't tunnel
    // through small hitboxes (the 60Hz solo loop never had this problem).
    this.playerShots.update(SIM_DT / 2, this);
    this.playerShots.update(SIM_DT / 2, this);
    this.enemyShots.update(SIM_DT, this);
    for (const p of this.players) {
      if (p.dead) continue;
      this.orbitals[p.slot].update(SIM_DT, this, p);
      this.novas[p.slot].update(SIM_DT, this, p);
    }
    this.pickups.update(SIM_DT, this);

    // Open a fresh offer for anyone with a level banked and none pending.
    for (const p of this.players) {
      if (p.dead || p.pendingLevels <= 0) continue;
      if (this.openOffers.some((o) => o.slot === p.slot)) continue;
      this.openOffer(p);
    }

    if (this.players.every((p) => p.dead)) this.over = true;
  }

  private openOffer(p: Player): void {
    p.pendingLevels--;
    const choices = rollChoices(this.lvFor(p.slot));
    if (choices.length === 0) {
      // Everything maxed — convert the level into survivability.
      p.heal(p.stats.maxHp * 0.3, this);
      return;
    }
    const offer: SimOffer = {
      offerId: this.nextOfferId++,
      slot: p.slot,
      choices: choices.map((c) => c.id),
      deadlineTick: this.tickNo + Math.round(this.tuning.levelupInvuln / SIM_DT),
    };
    this.openOffers.push(offer);
    this.newOffers.push(offer);
    this.push({ e: 'levelup', slot: p.slot });
    this.pushSfx('level');
  }

  /** Returns true when the pick was valid and applied. */
  applyPick(slot: number, offerId: number, upgradeId: string): boolean {
    const idx = this.openOffers.findIndex((o) => o.slot === slot && o.offerId === offerId);
    if (idx < 0) return false;
    const offer = this.openOffers[idx];
    if (!offer.choices.includes(upgradeId)) return false;
    if (!UPGRADE_DEFS.some((d) => d.id === upgradeId)) return false;
    this.openOffers.splice(idx, 1);

    const p = this.players[slot];
    const levels = this.upgLevels[slot];
    levels.set(upgradeId, (levels.get(upgradeId) ?? 0) + 1);
    const next = this.statsFor(slot, this.lvFor(slot));
    p.applyStats(next);
    if (upgradeId === 'vital') p.heal(next.maxHp * 0.35, this);
    this.pushSfx('confirm');
    return true;
  }

  private reviveDead(): void {
    for (const p of this.players) {
      if (!p.dead) continue;
      const anchor = this.nearestPlayer(p.x, p.y);
      p.dead = false;
      p.hp = p.stats.maxHp * this.tuning.reviveHpFrac;
      p.iframes = 2;
      p.vx = 0;
      p.vy = 0;
      if (anchor) {
        p.x = anchor.x + (p.slot === 0 ? -52 : 52);
        p.y = anchor.y;
      }
      this.push({ e: 'revive', slot: p.slot });
      this.pushSfx('heart');
    }
  }

  // ————— output drains (called once per snapshot window) —————

  drainEvents(): SimEvent[] {
    const out = this.ev.slice();
    this.ev.length = 0;
    return out;
  }

  drainOffers(): SimOffer[] {
    const out = this.newOffers.slice();
    this.newOffers.length = 0;
    return out;
  }

  isChoosing(slot: number): boolean {
    return this.openOffers.some((o) => o.slot === slot);
  }

  statFor(slot: number): { kills: number; score: number; coins: number } {
    return { kills: this.kills[slot], score: this.killScore[slot], coins: this.coins[slot] };
  }

  /** Final numbers: individual score, party coin pot split evenly (host keeps the odd coin). */
  results(): SimResult[] {
    const wave = this.waves.wave;
    const pot = this.coins.reduce((a, b) => a + b, 0) + wave * BAL.score.coinsPerWave;
    const share = Math.floor(pot / this.players.length);
    const remainder = pot - share * this.players.length;
    return this.players.map((p) => ({
      slot: p.slot,
      score: this.killScore[p.slot]
        + wave * BAL.score.perWave
        + Math.round(this.runTime * BAL.score.perSecond),
      kills: this.kills[p.slot],
      wave,
      time: this.runTime,
      coinsEarned: share + (p.slot === 0 ? remainder : 0),
    }));
  }

  // ————— World callbacks —————

  nearestPlayer(x: number, y: number): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (p.dead) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Perimeter of a nominal screen rect centered on a random living player. */
  randomSpawnPos(): [number, number] {
    const alive = this.players.filter((p) => !p.dead);
    const c = alive.length > 0 ? alive[Math.floor(Math.random() * alive.length)] : this.players[0];
    const w = VIEW_W + SPAWN_MARGIN * 2;
    const h = VIEW_H + SPAWN_MARGIN * 2;
    let d = Math.random() * 2 * (w + h);
    let x = -SPAWN_MARGIN;
    let y = -SPAWN_MARGIN;
    if (d < w) {
      x += d;
    } else if ((d -= w) < h) {
      x += w;
      y += d;
    } else if ((d -= h) < w) {
      x += w - d;
      y += h;
    } else {
      y += h - (d - w);
    }
    return [c.x - VIEW_W / 2 + x, c.y - VIEW_H / 2 + y];
  }

  shake(): void {}

  hitStop(): void {}

  onEnemyKilled(e: Enemy, killer: Player | null): void {
    if (killer) {
      this.kills[killer.slot]++;
      this.killScore[killer.slot] += e.score;
      this.combo[killer.slot]++;
      this.comboT[killer.slot] = BAL.combo.window;
      const frag = killer.stats.fragLevel;
      if (frag > 0) {
        this.enemies.queueAoe(e.x, e.y, 52 + 16 * frag, killer.stats.damage * 0.35 * frag, killer);
      }
    }
    this.push({ e: 'kill', x: Math.round(e.x), y: Math.round(e.y), k: ENEMY_KINDS.indexOf(e.kind) });
  }

  onBossDefeated(_e: Enemy): void {
    this.push({ e: 'bossDown' });
    this.pushSfx('bossDie');
  }

  onGemCollected(value: number, collector: Player): void {
    const slot = collector.slot;
    this.gemStreak[slot]++;
    this.gemStreakT[slot] = 0.9;
    this.pushSfx('gem', Math.pow(2, Math.min(this.gemStreak[slot], 12) * 0.08));
    const mult = 1 + Math.min(this.combo[slot], BAL.combo.maxStack) * BAL.combo.xpPerStack;
    collector.addXp(value * mult);
    this.push({ e: 'gem', slot });
  }

  onCoinCollected(value: number, collector: Player): void {
    const gained = Math.max(1, Math.round(value * collector.stats.coinMult));
    this.coins[collector.slot] += gained;
    this.pushSfx('coin');
    this.push({ e: 'coin', slot: collector.slot, v: gained });
  }

  onPlayerDeath(p: Player): void {
    this.push({ e: 'death', slot: p.slot });
    this.pushSfx('dieBig');
  }

  // ————— event queue helpers —————

  private push(event: SimEvent): void {
    if (this.ev.length >= MAX_EVENTS) return;
    this.ev.push(event);
  }

  private pushSfx(name: SfxName, pitch?: number): void {
    let same = 0;
    for (const e of this.ev) {
      if (e.e === 'sfx' && e.s === name && ++same >= MAX_SAME_SFX) return;
    }
    this.push(pitch !== undefined ? { e: 'sfx', s: name, p: Math.round(pitch * 100) / 100 } : { e: 'sfx', s: name });
  }

  private pushDmg(x: number, y: number, v: number): void {
    let count = 0;
    for (const e of this.ev) {
      if (e.e === 'dmg' && ++count >= MAX_DMG_EVENTS) return;
    }
    this.push({ e: 'dmg', x: Math.round(x), y: Math.round(y), v, c: 0 });
  }
}

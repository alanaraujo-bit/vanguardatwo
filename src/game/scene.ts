import type { Game, Scene } from '../core/game';
import type { Input } from '../core/input';
import type { SaveSystem } from '../core/save';
import { damp, rand, randomId } from '../core/utils';
import type { AudioEngine } from '../audio/audio';
import type { Music } from '../audio/music';
import { Background } from '../fx/background';
import { Floaters } from '../fx/floaters';
import { Particles } from '../fx/particles';
import { glowDot, type Sprite } from '../fx/sprites';
import { BAL } from './balance';
import { Enemies, type Enemy } from './enemies';
import { Hud, type HudView } from './hud';
import { Pickups } from './pickups';
import { Player } from './player';
import { EnemyShots, PlayerShots } from './projectiles';
import { S } from '../i18n/strings';
import type { RunSubmission } from '../net/protocol';
import { TutorialDirector, type TutorialHooks } from './tutorial';
import { computeStats, rollChoices, type Stats } from './upgrades';
import { WaveDirector, type Director } from './waves';
import { Nova, Orbitals } from './weapons';
import type { World } from './world';
import type { RunStats, UI } from '../ui/ui';

export interface GameDeps {
  game: Game;
  save: SaveSystem;
  ui: UI;
  audio: AudioEngine;
  music: Music;
  /** Present = guided-tutorial match: scripted spawns, revive on death, no records. */
  tutorial?: TutorialHooks;
  /** Fired once per real run with the final numbers (leaderboard submission). */
  onRunEnd?: (run: RunSubmission) => void;
}

type RunState = 'playing' | 'levelup' | 'paused' | 'dying' | 'over';

export class GameScene implements Scene, World {
  // — World contract —
  time = 0;
  runTime = 0;
  stats: Stats;
  input: Input;
  player: Player;
  enemies = new Enemies();
  playerShots = new PlayerShots();
  enemyShots = new EnemyShots();
  pickups = new Pickups();
  particles = new Particles();
  floaters = new Floaters();
  audio: AudioEngine;

  state: RunState = 'playing';

  private kills = 0;
  private killScore = 0;
  private coinsRun = 0;
  private combo = 0;
  private comboT = 0;
  private gemStreak = 0;
  private gemStreakT = 0;
  private camX = 0;
  private camY = 0;
  private trauma = 0;
  private deathT = 0;
  private tutorialActive = false;

  private readonly upgLevels = new Map<string, number>();
  private readonly waves: Director;
  private readonly tutorialDir: TutorialDirector | null = null;
  private readonly hud = new Hud();
  private readonly bg = new Background();
  private readonly orbitals = new Orbitals();
  private readonly nova = new Nova();
  private readonly deathDot: Sprite;
  private readonly hudView: HudView = {
    hp: 0, maxHp: 1, level: 1, xp: 0, xpNeed: 1,
    wave: 1, runTime: 0, coins: 0, combo: 0, boss: null,
  };

  constructor(private readonly deps: GameDeps) {
    this.audio = deps.audio;
    this.input = deps.game.input;
    this.stats = computeStats(deps.save.data, this.lv);
    this.player = new Player(this.stats);
    this.particles.quality = deps.save.data.settings.lowFx ? 0.45 : 1;
    this.deathDot = glowDot(10, '#9ff2ff');
    if (deps.tutorial) {
      this.tutorialDir = new TutorialDirector({ ui: deps.ui, save: deps.save, hooks: deps.tutorial });
      this.waves = this.tutorialDir;
    } else {
      this.waves = new WaveDirector({
        onWave: (wave) => {
          this.deps.ui.banner(`ONDA ${wave}`);
          this.audio.play('wave');
          this.deps.music.intensity = Math.min(1, wave / 12);
        },
        onBossWarn: () => {
          this.deps.ui.banner('COLOSSO DA RUÍNA', 'ELE SENTIU SUA PRESENÇA', true);
          this.audio.play('warn');
          this.deps.music.intensity = 1;
        },
      });
    }
  }

  get isTutorial(): boolean {
    return this.tutorialDir !== null;
  }

  private readonly lv = (id: string): number => this.upgLevels.get(id) ?? 0;

  enter(): void {
    this.deps.music.setMode('game');
    this.deps.music.intensity = 0;
    // The guided tutorial stages its own arena and announcements.
    if (this.tutorialDir) return;
    this.deps.ui.banner('ONDA 1');
    if (!this.deps.save.data.tutorialDone) {
      this.tutorialActive = true;
      this.deps.ui.showTutorial();
    }
    // Welcome party: a first wave already closing in, so the opening
    // seconds have action instead of an empty arena.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
      this.enemies.spawn('drone', Math.cos(a) * 330, Math.sin(a) * 330, 1, 1);
    }
  }

  exit(): void {
    this.deps.game.timeScale = 1;
    this.deps.ui.hideTutorial();
    this.deps.ui.hideTutorialBubble();
    this.deps.ui.hideTutorialSkip();
    this.particles.clear();
    this.floaters.clear();
    this.enemies.clear();
    this.playerShots.clear();
    this.enemyShots.clear();
    this.pickups.clear();
  }

  update(dt: number): void {
    this.time = this.deps.game.time;

    if (this.state === 'paused' || this.state === 'levelup' || this.state === 'over') return;

    if (this.state === 'dying') {
      // Ease time back up while the explosion settles, then show results.
      this.deps.game.timeScale += (1 - this.deps.game.timeScale) * damp(1.4, dt);
      this.deathT -= dt;
      this.particles.update(dt);
      this.floaters.update(dt);
      this.updateCamera(dt);
      if (this.deathT <= 0) this.finalize();
      return;
    }

    this.runTime += dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    this.gemStreakT -= dt;
    if (this.gemStreakT <= 0) this.gemStreak = 0;

    this.player.update(dt, this);
    this.waves.update(dt, this);
    this.enemies.update(dt, this);
    this.playerShots.update(dt, this);
    this.enemyShots.update(dt, this);
    this.orbitals.update(dt, this);
    this.nova.update(dt, this);
    this.pickups.update(dt, this);
    this.particles.update(dt);
    this.floaters.update(dt);
    this.updateCamera(dt);

    if (this.tutorialActive && this.runTime > 5 && this.input.hasMoved) {
      this.tutorialActive = false;
      this.deps.save.data.tutorialDone = true;
      this.deps.save.persist();
      this.deps.ui.hideTutorial();
    }

    if (this.state === 'playing' && this.player.pendingLevels > 0) {
      this.openLevelUp();
    }
  }

  private updateCamera(dt: number): void {
    const k = damp(8, dt);
    this.camX += (this.player.x - this.camX) * k;
    this.camY += (this.player.y - this.camY) * k;
    this.trauma = Math.max(0, this.trauma - 2.4 * dt);
  }

  // — World callbacks —

  /** Random point on the edge of an expanded screen rectangle (world coords). */
  randomSpawnPos(): [number, number] {
    const vp = this.deps.game.vp;
    const margin = 48;
    const w = vp.w + margin * 2;
    const h = vp.h + margin * 2;
    let d = Math.random() * 2 * (w + h);
    let x = -margin;
    let y = -margin;
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
    return [this.camX - vp.w / 2 + x, this.camY - vp.h / 2 + y];
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount / 100);
  }

  hitStop(seconds: number, scale = 0.08): void {
    this.deps.game.hitStop(seconds, scale);
  }

  onEnemyKilled(e: Enemy): void {
    this.kills++;
    this.killScore += e.score;
    this.combo++;
    this.comboT = BAL.combo.window;
    this.tutorialDir?.noteKill();
    const frag = this.stats.fragLevel;
    if (frag > 0) {
      this.enemies.queueAoe(e.x, e.y, 52 + 16 * frag, this.stats.damage * 0.35 * frag);
    }
  }

  onBossDefeated(_e: Enemy): void {
    this.audio.play('bossDie');
    this.hitStop(0.4, 0.05);
    this.shake(42);
    this.deps.ui.banner('COLOSSO DESTRUÍDO', 'A Ruína recua... por enquanto');
  }

  onGemCollected(value: number): void {
    this.gemStreak++;
    this.gemStreakT = 0.9;
    this.tutorialDir?.noteGem();
    this.audio.play('gem', Math.pow(2, Math.min(this.gemStreak, 12) * 0.08));
    const mult = 1 + Math.min(this.combo, BAL.combo.maxStack) * BAL.combo.xpPerStack;
    this.player.addXp(value * mult);
  }

  onCoinCollected(value: number): void {
    const gained = Math.max(1, Math.round(value * this.stats.coinMult));
    this.coinsRun += gained;
    this.audio.play('coin');
    this.tutorialDir?.noteCoin();
    this.floaters.spawn(this.player.x, this.player.y - 26, `+${gained}`, {
      color: '#ffc857', size: 13, bold: true,
    });
  }

  onPlayerDeath(): void {
    // Training has no permadeath: restore the ship, shove the swarm back and
    // let the pilot keep learning.
    if (this.tutorialDir) {
      this.player.dead = false;
      this.player.hp = this.stats.maxHp;
      this.player.iframes = 2.5;
      for (const e of this.enemies.list) {
        const a = Math.atan2(e.y - this.player.y, e.x - this.player.x);
        e.kvx += Math.cos(a) * 620;
        e.kvy += Math.sin(a) * 620;
      }
      this.particles.ring(this.player.x, this.player.y, '#35f0ff', 12, 520, 0.6, 6);
      this.audio.play('heart');
      this.deps.ui.banner(S.tutReviveTitle, S.tutReviveSub);
      return;
    }
    this.state = 'dying';
    this.deathT = 0.6;
    this.deps.game.timeScale = 0.25;
    this.hitStop(0.28, 0.04);
    this.shake(60);
    this.audio.play('dieBig');
    this.particles.burst(this.deathDot, this.player.x, this.player.y, {
      count: 26, speed: 260, size: 1.8, life: 0.8,
    });
    this.particles.ring(this.player.x, this.player.y, '#35f0ff', 12, 520, 0.6, 6);
    this.particles.ring(this.player.x, this.player.y, '#ffffff', 6, 380, 0.45, 3);
    this.deps.ui.hideTutorial();
  }

  private finalize(): void {
    this.state = 'over';
    this.deps.game.timeScale = 1;
    const save = this.deps.save;
    const wave = this.waves.wave;
    const score = this.killScore
      + wave * BAL.score.perWave
      + Math.round(this.runTime * BAL.score.perSecond);
    const coins = this.coinsRun + wave * BAL.score.coinsPerWave;
    const records = {
      wave: wave > save.data.bestWave,
      score: score > save.data.bestScore,
      time: this.runTime > save.data.bestTime,
      coins: coins > save.data.bestCoins,
    };
    const newRecord = records.wave || records.score || records.time || records.coins;

    save.data.coins += coins;
    save.data.bestWave = Math.max(save.data.bestWave, wave);
    save.data.bestScore = Math.max(save.data.bestScore, score);
    save.data.bestTime = Math.max(save.data.bestTime, this.runTime);
    save.data.bestCoins = Math.max(save.data.bestCoins, coins);
    save.data.runs++;
    save.data.totalKills += this.kills;
    save.data.totalTime += this.runTime;
    save.persist();

    this.deps.onRunEnd?.({
      runId: randomId(),
      wave,
      score,
      kills: this.kills,
      time: this.runTime,
      coins,
    });

    this.audio.play(newRecord ? 'record' : 'over');
    this.deps.music.setMode('menu');

    const stats: RunStats = {
      wave,
      kills: this.kills,
      time: this.runTime,
      score,
      coins,
      records,
    };
    this.deps.ui.showGameOver(stats);
  }

  private openLevelUp(): void {
    this.state = 'levelup';
    this.player.pendingLevels--;
    this.audio.play('level');
    this.particles.ring(this.player.x, this.player.y, '#52ffa8', 10, 460, 0.5, 4);

    const choices = rollChoices(this.lv);
    if (choices.length === 0) {
      // Everything maxed — convert the level into survivability.
      this.player.heal(this.stats.maxHp * 0.3, this);
      this.state = 'playing';
      return;
    }
    this.deps.ui.showLevelUp(choices, this.lv, (def) => {
      this.tutorialDir?.notePick();
      this.upgLevels.set(def.id, this.lv(def.id) + 1);
      const next = computeStats(this.deps.save.data, this.lv);
      this.player.applyStats(next);
      this.stats = next;
      if (def.id === 'vital') this.player.heal(next.maxHp * 0.35, this);
      this.audio.play('confirm');
      if (this.player.pendingLevels > 0) {
        this.openLevelUp();
      } else {
        this.state = 'playing';
      }
    });
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.deps.ui.showPause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
  }

  render(ctx: CanvasRenderingContext2D): void {
    const vp = this.deps.game.vp;
    const { w, h } = vp;
    const time = this.deps.game.time;

    const s = this.trauma * this.trauma;
    const sx = (Math.random() * 2 - 1) * 13 * s;
    const sy = (Math.random() * 2 - 1) * 13 * s;

    this.bg.render(ctx, this.camX - w / 2 + sx, this.camY - h / 2 + sy, w, h, time);

    ctx.save();
    ctx.translate(w / 2 - this.camX + sx, h / 2 - this.camY + sy);
    this.pickups.render(ctx, time);
    this.enemyShots.render(ctx, time);
    this.enemies.render(ctx, time);
    this.orbitals.render(ctx, this);
    this.nova.render(ctx, this, time);
    this.player.render(ctx, time);
    this.playerShots.render(ctx);
    this.particles.render(ctx);
    this.floaters.render(ctx);
    this.tutorialDir?.renderWorld(ctx, this, time);
    ctx.restore();

    this.bg.renderVignette(ctx, w, h);
    this.renderJoystick(ctx);

    const hv = this.hudView;
    hv.hp = this.player.hp;
    hv.maxHp = this.stats.maxHp;
    hv.level = this.player.level;
    hv.xp = this.player.xp;
    hv.xpNeed = this.player.xpNeed;
    hv.wave = this.waves.wave;
    hv.runTime = this.runTime;
    hv.coins = this.coinsRun;
    hv.combo = this.combo;
    const boss = this.enemies.boss;
    hv.boss = boss ? { hp: boss.hp, maxHp: boss.maxHp } : null;
    this.hud.render(ctx, hv, vp, time);
  }

  private renderJoystick(ctx: CanvasRenderingContext2D): void {
    const input = this.input;
    if (!input.stickActive || this.state !== 'playing') return;
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#7df3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(input.stickOX, input.stickOY, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7df3ff';
    ctx.beginPath();
    ctx.arc(
      input.stickOX + input.moveX * 34,
      input.stickOY + input.moveY * 34,
      13, 0, Math.PI * 2,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Ambient backdrop rendered behind the DOM menus. */
export class MenuScene implements Scene {
  private readonly bg = new Background();
  private readonly particles = new Particles();
  private readonly motes: Sprite[];
  private t = 0;
  private camX = 0;
  private camY = 0;

  constructor(private readonly game: Game) {
    this.motes = [glowDot(4, '#3ec6ff'), glowDot(5, '#b45cff'), glowDot(3, '#52ffa8')];
  }

  enter(): void {}

  exit(): void {
    this.particles.clear();
  }

  update(dt: number): void {
    this.t += dt;
    this.camX += 16 * dt;
    this.camY = Math.sin(this.t * 0.13) * 70;
    this.particles.update(dt);

    const { w, h } = this.game.vp;
    if (Math.random() < dt * 5) {
      const mote = this.motes[Math.floor(Math.random() * this.motes.length)];
      this.particles.spawn(
        mote,
        this.camX + rand(-w / 2, w / 2),
        this.camY + rand(-h / 2, h / 2),
        rand(-8, 8), rand(-26, -10),
        rand(2, 4), rand(0.6, 1.4), 0.1,
      );
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.game.vp;
    this.bg.render(ctx, this.camX - w / 2, this.camY - h / 2, w, h, this.t);
    ctx.save();
    ctx.translate(w / 2 - this.camX, h / 2 - this.camY);
    this.particles.render(ctx);
    ctx.restore();
    this.bg.renderVignette(ctx, w, h);
  }
}

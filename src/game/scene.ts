import type { Game, Scene } from '../core/game';
import type { Input } from '../core/input';
import type { SaveSystem } from '../core/save';
import { damp, dist2, rand, randomId } from '../core/utils';
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
import type { LevelDef } from './campaign';
import { LevelDirector } from './level-director';
import { SECTORS, sectorForWave } from './sectors';
import { TutorialDirector, type TutorialHooks } from './tutorial';
import { computeStats, rollChoices } from './upgrades';
import { WaveDirector, type Director } from './waves';
import { Nova, Orbitals } from './weapons';
import type { World } from './world';
import type { LevelStats, RunStats, UI } from '../ui/ui';

export interface GameDeps {
  game: Game;
  save: SaveSystem;
  ui: UI;
  audio: AudioEngine;
  music: Music;
  /** Present = guided-tutorial match: scripted spawns, revive on death, no records. */
  tutorial?: TutorialHooks;
  /** Present = campaign match: a fixed hand-authored level, no leaderboard, unlocks the next level on clear. */
  campaign?: { level: LevelDef; index: number };
  /** Fired once per real run with the final numbers (leaderboard submission). */
  onRunEnd?: (run: RunSubmission) => void;
}

type RunState = 'playing' | 'levelup' | 'paused' | 'dying' | 'winning' | 'over';

export class GameScene implements Scene, World {
  // — World contract —
  time = 0;
  runTime = 0;
  players: Player[];
  enemies = new Enemies();
  playerShots = new PlayerShots();
  enemyShots = new EnemyShots();
  pickups = new Pickups();
  particles = new Particles();
  floaters = new Floaters();
  audio: AudioEngine;

  // — solo-run plumbing (not part of the World contract) —
  readonly player: Player;
  private readonly input: Input;

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
  private winT = 0;
  private tutorialActive = false;
  /** Sector-transition screen flash: 1 → 0 over ~a second. */
  private sectorFlash = 0;
  private sectorFlashColor = '#ffffff';

  private readonly upgLevels = new Map<string, number>();
  private readonly waves: Director;
  private readonly tutorialDir: TutorialDirector | null = null;
  private readonly levelDir: LevelDirector | null = null;
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
    this.player = new Player(computeStats(deps.save.data, this.lv));
    this.players = [this.player];
    this.particles.quality = deps.save.data.settings.graphics.particleQuality;
    this.deathDot = glowDot(10, '#9ff2ff');
    if (deps.tutorial) {
      this.tutorialDir = new TutorialDirector({ ui: deps.ui, save: deps.save, hooks: deps.tutorial });
      this.waves = this.tutorialDir;
    } else if (deps.campaign) {
      this.levelDir = new LevelDirector(deps.campaign.level, deps.campaign.index, { ui: deps.ui, audio: this.audio });
      this.waves = this.levelDir;
    } else {
      this.waves = new WaveDirector({
        onWave: (wave) => {
          this.deps.ui.banner(`ONDA ${wave}`);
          this.audio.play('wave');
          this.deps.music.intensity = Math.min(1, wave / 12);
        },
        onBossWarn: (sector) => {
          this.deps.ui.banner(sector.boss.name.toUpperCase(), sector.boss.warnSub, true);
          this.audio.play('warn');
          this.deps.music.setTheme(sector.music.bossMusic ?? sector.music);
          this.deps.music.intensity = 1;
        },
        onSector: (sector, number) => {
          this.deps.ui.banner(`SETOR ${number} — ${sector.name}`, sector.subtitle, true);
          this.audio.play('sector');
          this.bg.setTheme(sector.background);
          this.deps.music.setTheme(sector.music);
          this.deps.music.intensity = 0.35;
          this.sectorFlash = 1;
          this.sectorFlashColor = sector.accent;
          this.shake(24);
        },
      });
    }
    this.applyGraphicsDensity(deps.save.data.settings.graphics.entityDensity);
  }

  /** Setting de gráficos (densidade de entidades) — cap de inimigos/gemas/floaters. */
  applyGraphicsDensity(mul: number): void {
    this.waves.densityMul = mul;
    this.pickups.setDensity(mul);
    this.floaters.setDensity(mul);
  }

  get isTutorial(): boolean {
    return this.tutorialDir !== null;
  }

  private readonly lv = (id: string): number => this.upgLevels.get(id) ?? 0;

  enter(): void {
    this.deps.music.setMode('game');
    this.deps.music.intensity = 0;
    if (this.deps.campaign) {
      const { level } = this.deps.campaign;
      this.deps.music.setTheme(level.sector.music);
      this.bg.setTheme(level.sector.background);
      this.deps.ui.banner(level.name, level.subtitle, true);
      this.audio.play('sector');
      return;
    }
    this.deps.music.setTheme(SECTORS[0].music);
    this.bg.setTheme(SECTORS[0].background);
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

    if (this.state === 'winning') {
      this.winT -= dt;
      this.particles.update(dt);
      this.floaters.update(dt);
      this.updateCamera(dt);
      if (this.winT <= 0) this.finalize();
      return;
    }

    this.runTime += dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    this.gemStreakT -= dt;
    if (this.gemStreakT <= 0) this.gemStreak = 0;

    // The sim only ever sees intents; the joystick stops here.
    const mv = this.input.sample();
    this.player.intent.mx = mv.mx;
    this.player.intent.my = mv.my;

    this.player.update(dt, this);
    this.waves.update(dt, this);
    if (this.state === 'playing' && this.waves.cleared) this.beginVictory();
    this.enemies.update(dt, this);
    this.playerShots.update(dt, this);
    this.enemyShots.update(dt, this);
    this.orbitals.update(dt, this, this.player);
    this.nova.update(dt, this, this.player);
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
    this.sectorFlash = Math.max(0, this.sectorFlash - 0.9 * dt);
  }

  // — World callbacks —

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
    if (!this.deps.save.data.settings.graphics.screenShake) return;
    this.trauma = Math.min(1, this.trauma + amount / 100);
  }

  hitStop(seconds: number, scale = 0.08): void {
    if (!this.deps.save.data.settings.graphics.hitStop) return;
    this.deps.game.hitStop(seconds, scale);
  }

  onEnemyKilled(e: Enemy, killer: Player | null): void {
    this.kills++;
    this.killScore += e.score;
    this.combo++;
    this.comboT = BAL.combo.window;
    this.tutorialDir?.noteKill();
    this.levelDir?.noteKill();
    const frag = killer ? killer.stats.fragLevel : 0;
    if (killer && frag > 0) {
      this.enemies.queueAoe(e.x, e.y, 52 + 16 * frag, killer.stats.damage * 0.35 * frag, killer);
    }
  }

  onBossDefeated(_e: Enemy): void {
    this.audio.play('bossDie');
    this.hitStop(0.4, 0.05);
    this.shake(42);
    const boss = this.waves.bossInfo?.() ?? sectorForWave(this.waves.wave).boss;
    const music = this.deps.campaign?.level.sector.music ?? sectorForWave(this.waves.wave).music;
    this.deps.music.setTheme(music);
    this.deps.music.intensity = Math.min(1, this.waves.wave / 12);
    this.deps.ui.banner(boss.defeatTitle, boss.defeatSub);
  }

  onGemCollected(value: number, collector: Player): void {
    this.gemStreak++;
    this.gemStreakT = 0.9;
    this.tutorialDir?.noteGem();
    this.audio.play('gem', Math.pow(2, Math.min(this.gemStreak, 12) * 0.08));
    const mult = 1 + Math.min(this.combo, BAL.combo.maxStack) * BAL.combo.xpPerStack;
    collector.addXp(value * mult);
  }

  onCoinCollected(value: number, collector: Player): void {
    const gained = Math.max(1, Math.round(value * collector.stats.coinMult));
    this.coinsRun += gained;
    this.audio.play('coin');
    this.tutorialDir?.noteCoin();
    this.floaters.spawn(collector.x, collector.y - 26, `+${gained}`, {
      color: '#ffc857', size: 13, bold: true,
    });
  }

  onPlayerDeath(p: Player): void {
    // Training has no permadeath: restore the ship, shove the swarm back and
    // let the pilot keep learning.
    if (this.tutorialDir) {
      p.dead = false;
      p.hp = p.stats.maxHp;
      p.iframes = 2.5;
      for (const e of this.enemies.list) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.kvx += Math.cos(a) * 620;
        e.kvy += Math.sin(a) * 620;
      }
      this.particles.ring(p.x, p.y, '#35f0ff', 12, 520, 0.6, 6);
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
    this.particles.burst(this.deathDot, p.x, p.y, {
      count: 26, speed: 260, size: 1.8, life: 0.8,
    });
    this.particles.ring(p.x, p.y, '#35f0ff', 12, 520, 0.6, 6);
    this.particles.ring(p.x, p.y, '#ffffff', 6, 380, 0.45, 3);
    this.deps.ui.hideTutorial();
  }

  private beginVictory(): void {
    this.state = 'winning';
    this.winT = 1.2;
    this.hitStop(0.3, 0.06);
    this.shake(20);
    this.audio.play('record');
  }

  private finalize(): void {
    this.state = 'over';
    this.deps.game.timeScale = 1;
    if (this.deps.campaign) {
      this.finalizeCampaign();
      return;
    }
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

  private finalizeCampaign(): void {
    const { index } = this.deps.campaign!;
    const cleared = this.waves.cleared === true;
    const save = this.deps.save;

    if (cleared) {
      save.data.coins += this.coinsRun;
      save.data.campaignLevel = Math.max(save.data.campaignLevel, index + 2);
      save.persist();
    }

    this.deps.music.setMode('menu');
    const stats: LevelStats = {
      levelIndex: index,
      kills: this.kills,
      time: this.runTime,
      coins: this.coinsRun,
      cleared,
    };
    this.deps.ui.showLevelComplete(stats);
  }

  private openLevelUp(): void {
    this.state = 'levelup';
    this.player.pendingLevels--;
    this.audio.play('level');
    this.particles.ring(this.player.x, this.player.y, '#52ffa8', 10, 460, 0.5, 4);

    const choices = rollChoices(this.lv);
    if (choices.length === 0) {
      // Everything maxed — convert the level into survivability.
      this.player.heal(this.player.stats.maxHp * 0.3, this);
      this.state = 'playing';
      return;
    }
    this.deps.ui.showLevelUp(choices, this.lv, (def) => {
      this.tutorialDir?.notePick();
      this.upgLevels.set(def.id, this.lv(def.id) + 1);
      const next = computeStats(this.deps.save.data, this.lv);
      this.player.applyStats(next);
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

    const gfx = this.deps.save.data.settings.graphics;
    const s = this.trauma * this.trauma;
    const sx = (Math.random() * 2 - 1) * 13 * s;
    const sy = (Math.random() * 2 - 1) * 13 * s;

    this.bg.render(ctx, this.camX - w / 2 + sx, this.camY - h / 2 + sy, w, h, time, gfx.background);

    ctx.save();
    ctx.translate(w / 2 - this.camX + sx, h / 2 - this.camY + sy);
    this.pickups.render(ctx, time, this.camX, this.camY, w, h);
    this.enemyShots.render(ctx, time, this.camX, this.camY, w, h);
    this.enemies.render(ctx, time, this.camX, this.camY, w, h);
    this.orbitals.render(ctx, this.player);
    this.nova.render(ctx, this.player, time);
    this.player.render(ctx, time);
    this.playerShots.render(ctx, this.camX, this.camY, w, h);
    this.particles.render(ctx);
    this.floaters.render(ctx);
    this.tutorialDir?.renderWorld(ctx, this, time);
    ctx.restore();

    if (gfx.vignette) this.bg.renderVignette(ctx, w, h);

    // Sector-transition flash: covers the theme swap, fades right out.
    if (this.sectorFlash > 0) {
      ctx.globalAlpha = Math.pow(this.sectorFlash, 1.6) * 0.5;
      ctx.fillStyle = this.sectorFlashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    this.input.renderStick(ctx, gfx.glow, this.state === 'playing');

    const hv = this.hudView;
    hv.hp = this.player.hp;
    hv.maxHp = this.player.stats.maxHp;
    hv.level = this.player.level;
    hv.xp = this.player.xp;
    hv.xpNeed = this.player.xpNeed;
    hv.wave = this.waves.wave;
    hv.remaining = this.waves.remaining?.(this.enemies.list.length) ?? null;
    hv.runTime = this.runTime;
    hv.coins = this.coinsRun;
    hv.combo = this.combo;
    hv.hideWave = this.tutorialDir !== null;
    const boss = this.enemies.boss;
    hv.boss = boss
      ? { hp: boss.hp, maxHp: boss.maxHp, name: (this.waves.bossInfo?.() ?? sectorForWave(this.waves.wave).boss).name }
      : null;
    this.hud.render(ctx, hv, vp, time, gfx.glow);
  }
}

/** Ambient backdrop rendered behind the DOM menus. */
export class MenuScene implements Scene {
  private readonly bg = new Background();
  readonly particles = new Particles();
  private readonly motes: Sprite[];
  private t = 0;
  private camX = 0;
  private camY = 0;

  constructor(private readonly game: Game, private readonly save: SaveSystem) {
    this.motes = [glowDot(4, '#3ec6ff'), glowDot(5, '#b45cff'), glowDot(3, '#52ffa8')];
    this.particles.quality = save.data.settings.graphics.particleQuality;
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
    const gfx = this.save.data.settings.graphics;
    this.bg.render(ctx, this.camX - w / 2, this.camY - h / 2, w, h, this.t, gfx.background);
    ctx.save();
    ctx.translate(w / 2 - this.camX, h / 2 - this.camY);
    this.particles.render(ctx);
    ctx.restore();
    if (gfx.vignette) this.bg.renderVignette(ctx, w, h);
  }
}

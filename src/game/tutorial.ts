import type { SaveSystem } from '../core/save';
import { TAU } from '../core/utils';
import { S } from '../i18n/strings';
import type { UI } from '../ui/ui';
import type { Director } from './waves';
import type { World } from './world';

export interface TutorialHooks {
  /** Fired once, after the graduation step finishes. */
  onComplete(): void;
}

interface TutorialDeps {
  ui: UI;
  save: SaveSystem;
  hooks: TutorialHooks;
}

const TUTORIAL_REWARD = 25;
const TRIAL_DURATION = 30;

interface TutStep {
  id: string;
  title: string;
  sub?: string;
  enter?(w: World, t: TutorialDirector): void;
  /** Returns true when the step's goal is met. */
  done(dt: number, w: World, t: TutorialDirector): boolean;
}

/**
 * Scripted, hand-holding replacement for WaveDirector used on the very first
 * match (and on tutorial replays). Runs a linear step machine: each step
 * shows a message bubble, optionally stages the arena (gentle scripted
 * spawns, bonus pickups) and waits for a concrete player action before
 * advancing. GameScene forwards kill/gem/coin/upgrade events via the note*()
 * methods, revives the player instead of ending the run, and never submits
 * tutorial results anywhere.
 */
export class TutorialDirector implements Director {
  wave = 1;

  private stepIndex = -1;
  private stepT = 0;
  private moveT = 0;
  private trickleT = 0;
  private trickleLeft = 0;
  private trialShown = -1;
  private completed = false;

  private kills = 0;
  private gems = 0;
  private coins = 0;
  private picks = 0;

  private readonly steps: TutStep[] = [
    {
      id: 'boasVindas',
      title: S.tutWelcomeTitle,
      sub: S.tutWelcomeSub,
      done: (_dt, _w, t) => t.stepT >= 3,
    },
    {
      id: 'mover',
      title: S.tutMoveTitle,
      sub: S.tutMoveSub,
      done: (dt, w, t) => {
        if (w.players[0].intentMag > 0.2) t.moveT += dt;
        return t.moveT >= 1.5;
      },
    },
    {
      id: 'tiroAuto',
      title: S.tutAutoTitle,
      sub: S.tutAutoSub,
      enter: (w) => spawnEdge(w, 'drone', 0.5, 0.5),
      done: (_dt, _w, t) => t.kills >= 1,
    },
    {
      id: 'abates',
      title: S.tutKillsTitle,
      sub: S.tutKillsSub,
      enter: (_w, t) => {
        t.trickleLeft = 4;
        t.trickleT = 0.4;
      },
      done: (dt, w, t) => {
        t.trickleT -= dt;
        if (t.trickleLeft > 0 && t.trickleT <= 0) {
          t.trickleT = 1;
          t.trickleLeft--;
          spawnEdge(w, 'drone', 0.6, 0.5);
        }
        return t.kills >= 5;
      },
    },
    {
      id: 'gemas',
      title: S.tutGemsTitle,
      sub: S.tutGemsSub,
      enter: (w) => {
        // A few bonus gems just outside the magnet radius, so walking to
        // them demonstrates the pull.
        const p = w.players[0];
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + Math.random();
          w.pickups.spawnGems(p.x + Math.cos(a) * 110, p.y + Math.sin(a) * 110, 1);
        }
      },
      done: (_dt, _w, t) => t.gems >= 6,
    },
    {
      id: 'melhoria',
      title: S.tutUpgradeTitle,
      sub: S.tutUpgradeSub,
      done: (_dt, _w, t) => t.picks >= 1,
    },
    {
      id: 'moedas',
      title: S.tutCoinsTitle,
      sub: S.tutCoinsSub,
      enter: (w) => {
        const p = w.players[0];
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + Math.random();
          w.pickups.spawnCoins(p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, 1);
        }
      },
      done: (_dt, _w, t) => t.coins >= 1,
    },
    {
      id: 'ondas',
      title: S.tutWavesTitle,
      sub: S.tutWavesSub,
      enter: (_w, t) => t.deps.ui.banner('ONDA 1'),
      done: (_dt, _w, t) => t.stepT >= 4,
    },
    {
      id: 'prova',
      title: S.tutTrialTitle,
      sub: S.tutTrialSub,
      enter: (_w, t) => {
        t.trickleT = 1;
        t.trialShown = -1;
      },
      done: (dt, w, t) => {
        t.trickleT -= dt;
        if (t.trickleT <= 0) {
          t.trickleT = 1.6;
          spawnEdge(w, Math.random() < 0.3 ? 'dart' : 'drone', 0.8, 0.6);
        }
        const left = Math.max(0, Math.ceil(TRIAL_DURATION - t.stepT));
        if (left !== t.trialShown) {
          t.trialShown = left;
          t.deps.ui.tutorialSub(S.tutTrialLeft.replace('{s}', String(left)));
        }
        return t.stepT >= TRIAL_DURATION;
      },
    },
    {
      id: 'formatura',
      title: S.tutGradTitle,
      sub: S.tutGradSub,
      enter: (w, t) => {
        const p = w.players[0];
        w.enemies.clear();
        w.enemyShots.clear();
        w.particles.ring(p.x, p.y, '#52ffa8', 12, 520, 0.7, 5);
        w.audio.play('record');
        t.deps.save.data.coins += TUTORIAL_REWARD;
        t.deps.save.persist();
        w.floaters.spawn(p.x, p.y - 30, `+${TUTORIAL_REWARD}`, {
          color: '#ffc857', size: 16, bold: true,
        });
        t.deps.ui.banner(S.tutDoneBanner, S.tutDoneSub);
      },
      done: (_dt, _w, t) => t.stepT >= 3,
    },
  ];

  constructor(readonly deps: TutorialDeps) {}

  update(dt: number, world: World): void {
    if (this.completed) return;

    if (this.stepIndex < 0) {
      this.advance(world);
      return;
    }

    this.stepT += dt;
    const step = this.steps[this.stepIndex];
    if (step.done(dt, world, this)) this.advance(world);
  }

  private advance(world: World): void {
    this.stepIndex++;
    this.stepT = 0;
    const step = this.steps[this.stepIndex];
    if (!step) {
      this.completed = true;
      this.deps.hooks.onComplete();
      return;
    }
    this.deps.ui.tutorialSay(step.title, step.sub);
    step.enter?.(world, this);
  }

  // ————— event notes, forwarded by GameScene —————

  noteKill(): void {
    this.kills++;
  }

  noteGem(): void {
    this.gems++;
  }

  noteCoin(): void {
    this.coins++;
  }

  notePick(): void {
    this.picks++;
  }

  /** Pulsing ring highlights, drawn in world space under the current step. */
  renderWorld(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    if (step.id === 'tiroAuto' || step.id === 'abates') {
      for (const e of world.enemies.list) {
        if (!e.dead) ring(ctx, e.x, e.y, e.radius + 14, time, '#ff8aa5');
      }
    } else if (step.id === 'gemas') {
      const pl = world.players[0];
      const p = world.pickups.nearestOfKind('gem', pl.x, pl.y);
      if (p) ring(ctx, p[0], p[1], 22, time, '#52ffa8');
    } else if (step.id === 'moedas') {
      const pl = world.players[0];
      const p = world.pickups.nearestOfKind('coin', pl.x, pl.y);
      if (p) ring(ctx, p[0], p[1], 22, time, '#ffc857');
    }
  }
}

function spawnEdge(w: World, kind: 'drone' | 'dart', hpMul: number, dmgMul: number): void {
  const [x, y] = w.randomSpawnPos();
  w.enemies.spawn(kind, x, y, hpMul, dmgMul);
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, time: number, color: string,
): void {
  const pulse = 1 + Math.sin(time * 5) * 0.12;
  ctx.globalAlpha = 0.5 + Math.sin(time * 5) * 0.2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

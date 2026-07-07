import { Game } from './core/game';
import { Input, isTyping } from './core/input';
import { SaveSystem } from './core/save';
import { Viewport } from './core/viewport';
import { AudioEngine } from './audio/audio';
import { Music } from './audio/music';
import { GameScene, MenuScene } from './game/scene';
import { session } from './net/session';
import { sync } from './net/sync';
import { UI, type UiActions } from './ui/ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const vp = new Viewport(canvas);
const input = new Input(canvas);
const game = new Game(canvas, vp, input);

const save = new SaveSystem();
save.load();
session.init(save);
sync.init(save);

const audio = new AudioEngine();
const music = new Music(audio);

function applySettings(): void {
  const cfg = save.data.settings;
  audio.sfxOn = cfg.sfx;
  audio.musicOn = cfg.music;
  audio.hapticsOn = cfg.haptics;
  music.sync();
  if (run) run.particles.quality = cfg.lowFx ? 0.45 : 1;
}

let run: GameScene | null = null;
const menuScene = new MenuScene(game);

/**
 * After the guided tutorial (finished or skipped), first-timers pick a name
 * and are offered the Google login; replays go straight back to the menu.
 */
function endTutorial(): void {
  run = null;
  music.setMode('menu');
  game.setScene(menuScene);
  ui.hideGameOverlay();
  ui.hideTutorialBubble();
  ui.hideTutorialSkip();

  if (save.data.onboarded) {
    ui.showMenu();
    return;
  }
  ui.showNamePrompt({
    initial: save.data.name,
    onDone: async (name) => {
      save.data.name = name;
      save.data.tutorialDone = true;
      save.data.onboarded = true;
      save.persist();
      ui.showLogin({
        onDone: () => ui.showMenu(),
        onSkip: () => ui.showMenu(),
      });
      return null;
    },
  });
}

const actions: UiActions = {
  startRun() {
    run = new GameScene({
      game, save, ui, audio, music,
      onRunEnd: (result) => sync.submitRun(result),
    });
    game.setScene(run);
    ui.hideAll();
    ui.showGameOverlay();
  },
  startTutorial() {
    run = new GameScene({
      game, save, ui, audio, music,
      tutorial: { onComplete: endTutorial },
    });
    game.setScene(run);
    ui.hideAll();
    ui.showGameOverlay();
    ui.showTutorialSkip(endTutorial);
  },
  pauseRun() {
    run?.pause();
  },
  resumeRun() {
    run?.resume();
  },
  restartRun() {
    if (run?.isTutorial) actions.startTutorial();
    else actions.startRun();
  },
  quitToMenu() {
    if (run?.isTutorial) {
      endTutorial();
      return;
    }
    run = null;
    music.setMode('menu');
    game.setScene(menuScene);
    ui.hideGameOverlay();
    ui.showMenu();
  },
  applySettings,
};

const ui = new UI(save, audio, actions);

applySettings();
music.setMode('menu');
game.setScene(menuScene);
if (save.data.onboarded) {
  ui.showMenu();
} else {
  actions.startTutorial();
}
game.start();

// Restore a logged-in session in the background; the menu re-renders when it
// lands (account chip, cloud records).
session.onChange(() => {
  applySettings();
  ui.refreshMenu();
});
void session.restore();

// Mobile browsers require a user gesture before audio can start.
window.addEventListener('pointerdown', () => {
  audio.unlock();
  music.sync();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    run?.pause();
    audio.suspend();
  } else {
    audio.resume();
  }
});

window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  if (e.code === 'Escape' || e.code === 'KeyP') run?.pause();
});

// Block iOS pinch zoom / double-tap zoom inside the game.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

// Fade out the boot splash now that everything is live.
const boot = document.getElementById('boot');
if (boot) {
  boot.classList.add('off');
  setTimeout(() => boot.remove(), 700);
}

// Offline support (PWA) — disabled temporarily for debugging.
// const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
// if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocal)) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('sw.js').catch(() => {
//       // offline support is a bonus, never a blocker
//     });
//   });
// }

// Cleanup: a Service Worker registered by an earlier deploy stays active
// across deploys (browsers only re-check a SW script if its bytes change),
// so it can keep serving a stale/corrupted cached main.js forever even
// after we disable registration above. Force it off for every visitor.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
}
if ('caches' in window) {
  caches.keys().then((keys) => {
    for (const key of keys) caches.delete(key);
  });
}

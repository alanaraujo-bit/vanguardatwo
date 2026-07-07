import { Game } from './core/game';
import { Input } from './core/input';
import { SaveSystem } from './core/save';
import { Viewport } from './core/viewport';
import { AudioEngine } from './audio/audio';
import { Music } from './audio/music';
import { GameScene, MenuScene } from './game/scene';
import { UI, type UiActions } from './ui/ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const vp = new Viewport(canvas);
const input = new Input(canvas);
const game = new Game(canvas, vp, input);

const save = new SaveSystem();
save.load();

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

const actions: UiActions = {
  startRun() {
    run = new GameScene({ game, save, ui, audio, music });
    game.setScene(run);
    ui.hideAll();
    ui.showGameOverlay();
  },
  pauseRun() {
    run?.pause();
  },
  resumeRun() {
    run?.resume();
  },
  restartRun() {
    actions.startRun();
  },
  quitToMenu() {
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
ui.showMenu();
game.start();

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

// Offline support (PWA) — disabled temporarily for debugging
// const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
// if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocal)) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('sw.js').catch(() => {
//       // offline support is a bonus, never a blocker
//     });
//   });
// }

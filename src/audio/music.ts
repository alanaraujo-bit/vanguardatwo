import type { AudioEngine } from './audio';

export type MusicMode = 'menu' | 'game';

const STEPS_PER_BAR = 16;
const BARS = 4;

/** A sector's soundtrack: tempo, harmony and lead voice for the sequencer. */
export interface MusicTheme {
  bpm: number;
  /** One bass root per bar (played an octave up). */
  bass: readonly [number, number, number, number];
  /** One chord (3 voices) per bar. */
  chords: ReadonlyArray<readonly number[]>;
  /** Waveform of the in-game arp lead. */
  lead: OscillatorType;
}

// A minor synthwave progression: Am — F — C — G
export const DEFAULT_MUSIC_THEME: MusicTheme = {
  bpm: 118,
  bass: [55, 43.65, 65.41, 49],
  chords: [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [261.63, 329.63, 392],
    [196, 246.94, 293.66],
  ],
  lead: 'square',
};

/**
 * Procedural soundtrack: a lookahead step sequencer over Web Audio.
 * The menu plays a sparse ambient variation; in-game the beat kicks in and
 * layers (hats, snare, faster arps) fade in with `intensity` as waves climb.
 * Sectors swap in their own theme; the switch lands on the next bar line so
 * the transition stays musical.
 */
export class Music {
  intensity = 0;

  private wanted: MusicMode | null = null;
  private theme: MusicTheme = DEFAULT_MUSIC_THEME;
  private pendingTheme: MusicTheme | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private stepTime = 0;
  private delaySend: GainNode | null = null;
  private delayNode: DelayNode | null = null;

  constructor(private readonly engine: AudioEngine) {}

  setMode(mode: MusicMode | null): void {
    this.wanted = mode;
    this.sync();
  }

  /** Swaps the soundtrack at the next bar line (immediate when stopped). */
  setTheme(theme: MusicTheme): void {
    if (theme === this.theme && !this.pendingTheme) return;
    if (this.timer === null) {
      this.applyTheme(theme);
    } else {
      this.pendingTheme = theme;
    }
  }

  private applyTheme(theme: MusicTheme): void {
    this.theme = theme;
    this.pendingTheme = null;
    if (this.delayNode) this.delayNode.delayTime.value = this.stepDur * 3;
  }

  private get stepDur(): number {
    return 60 / this.theme.bpm / 4; // 16th notes
  }

  /** Reconciles scheduler state with settings + unlock status. */
  sync(): void {
    const shouldPlay = this.wanted !== null && this.engine.musicOn && this.engine.ctx !== null;
    if (shouldPlay && this.timer === null) {
      const ctx = this.engine.ctx!;
      this.buildDelay(ctx);
      this.step = 0;
      this.stepTime = ctx.currentTime + 0.08;
      this.timer = setInterval(() => this.tick(), 25);
    } else if (!shouldPlay && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private buildDelay(ctx: AudioContext): void {
    if (this.delaySend || !this.engine.musicBus) return;
    const send = ctx.createGain();
    send.gain.value = 0.5;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = this.stepDur * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    send.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.engine.musicBus);
    this.delaySend = send;
    this.delayNode = delay;
  }

  private tick(): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    while (this.stepTime < ctx.currentTime + 0.16) {
      this.scheduleStep(this.step, this.stepTime);
      this.step++;
      this.stepTime += this.stepDur;
    }
  }

  private scheduleStep(step: number, t: number): void {
    if (this.pendingTheme && step % STEPS_PER_BAR === 0) {
      this.applyTheme(this.pendingTheme);
    }
    // The menu always plays the home theme, whatever sector a run ended in.
    const mode = this.wanted ?? 'menu';
    const theme = mode === 'menu' ? DEFAULT_MUSIC_THEME : this.theme;
    const { bass, chords, lead } = theme;
    const STEP = this.stepDur;

    const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
    const s = step % STEPS_PER_BAR;
    const heat = this.intensity;

    if (mode === 'menu') {
      if (s === 0) {
        this.note(t, bass[bar] * 2, STEP * 15, 'sawtooth', 0.07, 0.06, 340);
        for (const f of chords[bar]) {
          this.note(t, f, STEP * 15.5, 'sawtooth', 0.035, 0.9, 750, true);
        }
      }
      if (s % 4 === 2) {
        const idx = Math.floor(step / 4) % 3;
        this.note(t, chords[bar][idx] * 2, 0.22, 'triangle', 0.045, 0.005, undefined, false, true);
      }
      return;
    }

    // — game mode —
    if (s % 2 === 0) {
      this.note(t, bass[bar] * 2, STEP * 1.6, 'sawtooth', 0.11, 0.004, 300 + heat * 500);
    }
    if (s % 4 === 0) this.kick(t);
    if (s % 2 === 1) {
      this.hat(t, 0.022 + heat * 0.03);
    }
    if ((s === 4 || s === 12) && heat > 0.3) this.snare(t);
    if (s === 0) {
      for (const f of chords[bar]) {
        this.note(t, f, STEP * 15.5, 'sawtooth', 0.03, 0.8, 800, true);
      }
    }
    if (s % 2 === 0) {
      const seq = [0, 1, 2, 1];
      const idx = seq[Math.floor(step / 2) % 4];
      const octave = heat > 0.55 && s % 8 === 6 ? 4 : 2;
      this.note(t, chords[bar][idx] * octave, 0.14, lead, 0.035 + heat * 0.015, 0.004, undefined, false, true);
    }
  }

  private note(
    t: number, freq: number, dur: number, type: OscillatorType,
    vol: number, attack: number, lowpass?: number, detune = false, echo = false,
  ): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.musicBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = (Math.random() - 0.5) * 14;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);

    let head: AudioNode = osc;
    if (lowpass !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      head.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(bus);
    if (echo && this.delaySend) g.connect(this.delaySend);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private kick(t: number): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.musicBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private hat(t: number, vol: number): void {
    this.noiseBurst(t, 0.03, vol, 'highpass', 6500);
  }

  private snare(t: number): void {
    this.noiseBurst(t, 0.09, 0.09, 'bandpass', 1900);
  }

  private noiseBurst(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.musicBus;
    const buf = this.engine.noise;
    if (!ctx || !bus || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}

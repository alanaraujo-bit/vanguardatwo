export type SfxName =
  | 'shoot' | 'hit' | 'die' | 'dieBig' | 'gem' | 'coin' | 'heart' | 'hurt'
  | 'level' | 'pick' | 'nova' | 'blade' | 'shotE' | 'wave' | 'warn' | 'bossDie'
  | 'tap' | 'confirm' | 'deny' | 'buy' | 'over' | 'record'
  | 'spit' | 'lunge' | 'burst' | 'summon' | 'sector';

interface ToneOptions {
  f0: number;
  f1?: number;
  type?: OscillatorType;
  dur: number;
  vol: number;
  attack?: number;
  when?: number;
}

interface NoiseOptions {
  dur: number;
  vol: number;
  from?: number;
  to?: number;
  filter?: BiquadFilterType;
  q?: number;
  when?: number;
}

/** Minimum re-trigger gap per effect, so rapid fire never becomes noise soup. */
const THROTTLE: Partial<Record<SfxName, number>> = {
  shoot: 0.045, hit: 0.03, die: 0.04, gem: 0.03, blade: 0.09, shotE: 0.06, coin: 0.03,
  spit: 0.07, lunge: 0.08, burst: 0.06,
};

/**
 * Web Audio synthesizer. Every sound in the game is generated at runtime —
 * no audio files. The context is created lazily on the first user gesture
 * (mobile autoplay policy).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  musicBus: GainNode | null = null;

  sfxOn = true;
  musicOn = true;
  hapticsOn = true;

  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly lastAt = new Map<SfxName, number>();

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    type AudioContextCtor = new () => AudioContext;
    const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 6;
    compressor.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(compressor);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.42;
    this.musicBus.connect(master);

    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.ctx = ctx;
  }

  get noise(): AudioBuffer | null {
    return this.noiseBuf;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  vibrate(pattern: number | number[]): void {
    if (!this.hapticsOn) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // not supported — fine
    }
  }

  private tone(o: ToneOptions): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const t = o.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.f0), t);
    if (o.f1 !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    }
    const g = ctx.createGain();
    const attack = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  private noiseHit(o: NoiseOptions): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.noiseBuf) return;
    const t = o.when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter ?? 'lowpass';
    filter.Q.value = o.q ?? 0.8;
    filter.frequency.setValueAtTime(o.from ?? 3000, t);
    if (o.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t + o.dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filter).connect(g).connect(bus);
    src.start(t);
    src.stop(t + o.dur + 0.05);
  }

  /** @param pitch frequency multiplier — used e.g. for rising pickup streaks */
  play(name: SfxName, pitch = 1): void {
    if (!this.sfxOn || !this.ctx) return;
    const now = this.ctx.currentTime;
    const gap = THROTTLE[name];
    if (gap !== undefined) {
      const last = this.lastAt.get(name) ?? -1;
      if (now - last < gap) return;
      this.lastAt.set(name, now);
    }
    const jitter = 0.96 + Math.random() * 0.08;
    const p = pitch * jitter;

    switch (name) {
      case 'shoot':
        this.tone({ f0: 640 * p, f1: 170, type: 'square', dur: 0.08, vol: 0.055 });
        break;
      case 'hit':
        this.tone({ f0: 240 * p, f1: 90, type: 'triangle', dur: 0.06, vol: 0.1 });
        this.noiseHit({ dur: 0.04, vol: 0.06, from: 4200, to: 1500 });
        break;
      case 'die':
        this.tone({ f0: 330 * p, f1: 55, type: 'sawtooth', dur: 0.17, vol: 0.1 });
        this.noiseHit({ dur: 0.16, vol: 0.13, from: 2600, to: 240 });
        break;
      case 'dieBig':
        this.tone({ f0: 180 * p, f1: 38, type: 'sawtooth', dur: 0.3, vol: 0.18 });
        this.noiseHit({ dur: 0.32, vol: 0.2, from: 1800, to: 120 });
        break;
      case 'gem':
        this.tone({ f0: 620 * p, f1: 930 * p, type: 'sine', dur: 0.09, vol: 0.08 });
        break;
      case 'coin':
        this.tone({ f0: 1318, dur: 0.06, vol: 0.07, type: 'square' });
        this.tone({ f0: 1760, dur: 0.09, vol: 0.06, type: 'square', when: this.ctx.currentTime + 0.05 });
        break;
      case 'heart':
        this.tone({ f0: 523, dur: 0.1, vol: 0.12 });
        this.tone({ f0: 784, dur: 0.16, vol: 0.12, when: this.ctx.currentTime + 0.08 });
        break;
      case 'hurt':
        this.tone({ f0: 140, f1: 42, type: 'sawtooth', dur: 0.28, vol: 0.26 });
        this.noiseHit({ dur: 0.2, vol: 0.2, from: 900, to: 120 });
        this.vibrate(60);
        break;
      case 'level':
        [523, 659, 784, 1047].forEach((f, i) => {
          this.tone({ f0: f, dur: 0.14, vol: 0.13, when: this.ctx!.currentTime + i * 0.07 });
        });
        this.vibrate([20, 30, 20]);
        break;
      case 'pick':
        this.tone({ f0: 880, f1: 1320, dur: 0.12, vol: 0.12 });
        this.tone({ f0: 440, dur: 0.18, vol: 0.08, type: 'triangle' });
        break;
      case 'nova':
        this.tone({ f0: 90, f1: 44, type: 'sine', dur: 0.35, vol: 0.24 });
        this.noiseHit({ dur: 0.4, vol: 0.12, from: 300, to: 4200, filter: 'bandpass', q: 1.4 });
        break;
      case 'blade':
        this.tone({ f0: 950 * p, f1: 480, type: 'triangle', dur: 0.05, vol: 0.04 });
        break;
      case 'shotE':
        this.tone({ f0: 320, f1: 140, type: 'square', dur: 0.1, vol: 0.05 });
        break;
      case 'wave':
        this.tone({ f0: 660, f1: 990, dur: 0.16, vol: 0.1 });
        this.tone({ f0: 330, dur: 0.24, vol: 0.07, type: 'triangle' });
        break;
      case 'warn':
        this.tone({ f0: 196, dur: 0.22, vol: 0.16, type: 'square' });
        this.tone({ f0: 196, dur: 0.34, vol: 0.16, type: 'square', when: this.ctx.currentTime + 0.3 });
        this.vibrate([40, 60, 40]);
        break;
      case 'bossDie':
        this.tone({ f0: 220, f1: 28, type: 'sawtooth', dur: 0.7, vol: 0.24 });
        this.noiseHit({ dur: 0.7, vol: 0.24, from: 2400, to: 60 });
        this.vibrate([60, 40, 100]);
        break;
      case 'tap':
        this.tone({ f0: 700, f1: 560, dur: 0.05, vol: 0.05 });
        break;
      case 'confirm':
        this.tone({ f0: 440, f1: 880, dur: 0.12, vol: 0.1 });
        break;
      case 'deny':
        this.tone({ f0: 220, f1: 160, dur: 0.14, vol: 0.1, type: 'square' });
        break;
      case 'buy':
        this.tone({ f0: 587, dur: 0.08, vol: 0.1 });
        this.tone({ f0: 880, dur: 0.14, vol: 0.1, when: this.ctx.currentTime + 0.07 });
        break;
      case 'over':
        [392, 330, 262, 196].forEach((f, i) => {
          this.tone({ f0: f, dur: 0.22, vol: 0.14, type: 'sawtooth', when: this.ctx!.currentTime + i * 0.17 });
        });
        break;
      case 'record':
        [523, 659, 784, 1047, 1319].forEach((f, i) => {
          this.tone({ f0: f, dur: 0.18, vol: 0.12, when: this.ctx!.currentTime + i * 0.09 });
        });
        break;
      case 'spit':
        // Wet organic zap — the hive's answer to 'shotE'.
        this.tone({ f0: 520 * p, f1: 190, type: 'sawtooth', dur: 0.09, vol: 0.05 });
        this.noiseHit({ dur: 0.05, vol: 0.03, from: 1400, to: 500, filter: 'bandpass', q: 2 });
        break;
      case 'lunge':
        // Rising whoosh for the stinger's dash.
        this.tone({ f0: 170, f1: 460, type: 'triangle', dur: 0.16, vol: 0.08 });
        this.noiseHit({ dur: 0.14, vol: 0.08, from: 600, to: 3200, filter: 'bandpass', q: 1.2 });
        break;
      case 'burst':
        // Spore pod rupturing into a ring of orbs.
        this.tone({ f0: 300 * p, f1: 68, type: 'sawtooth', dur: 0.2, vol: 0.11 });
        this.noiseHit({ dur: 0.18, vol: 0.11, from: 2800, to: 320 });
        break;
      case 'summon':
        // The Queen calling her brood: eerie parallel rise.
        this.tone({ f0: 220, f1: 470, type: 'triangle', dur: 0.34, vol: 0.1 });
        this.tone({ f0: 330, f1: 700, type: 'triangle', dur: 0.34, vol: 0.07, when: this.ctx.currentTime + 0.06 });
        this.vibrate([30, 40, 30]);
        break;
      case 'sector':
        // Sector-transition sting: a big riser chord plus sweeping air.
        [130.81, 196, 261.63, 392].forEach((f, i) => {
          this.tone({ f0: f, dur: 0.55, vol: 0.11, type: 'sawtooth', attack: 0.05, when: this.ctx!.currentTime + i * 0.09 });
        });
        this.noiseHit({ dur: 0.7, vol: 0.09, from: 400, to: 6000, filter: 'bandpass', q: 1 });
        this.vibrate([30, 50, 80]);
        break;
    }
  }
}

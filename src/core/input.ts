import type { ControlScheme } from './save.js';
import { clamp, len } from './utils';

const STICK_RADIUS = 46;
const DEAD_ZONE = 5;
/** 'bottomHalf' pad: how far a touch may land from the anchor and still grab the stick. Generous, so thumbs don't need to look. */
const FIXED_HIT_RADIUS = 72;
const FIXED_RING_RADIUS = 50;
const FIXED_KNOB_TRAVEL = 36;
const FIXED_KNOB_RADIUS = 16;
const FLOAT_RING_RADIUS = 44;
const FLOAT_KNOB_TRAVEL = 34;
const FLOAT_KNOB_RADIUS = 13;

/** True while the event targets a text field (name entry, login forms). */
export function isTyping(e: Event): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

/**
 * One-thumb virtual joystick: touch (within the active zone) anywhere, drag
 * to move. The origin trails behind the finger when it travels past the
 * stick radius, which keeps the control responsive on direction reversals.
 * Keyboard (WASD/arrows) is supported for desktop play.
 */
export class Input {
  /** Normalized movement vector, magnitude in [0,1]. */
  moveX = 0;
  moveY = 0;
  magnitude = 0;

  stickActive = false;
  stickOX = 0;
  stickOY = 0;
  stickX = 0;
  stickY = 0;

  /** True once the player has produced any movement (used by the tutorial). */
  hasMoved = false;

  /** Which zone of the screen accepts the initial touch. Settings-driven. */
  scheme: ControlScheme = 'free';

  /**
   * Anchor for the 'bottomHalf' pad — always bottom-center, kept in sync with
   * the viewport by main.ts on every resize. Unused in 'free' scheme.
   */
  anchorX = 0;
  anchorY = 0;

  private pointerId: number | null = null;
  private readonly keys = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      if (this.scheme === 'bottomHalf') {
        // Fixed pad: the origin never moves, only touches that land near it grab the stick.
        if (len(e.clientX - this.anchorX, e.clientY - this.anchorY) > FIXED_HIT_RADIUS) return;
        this.stickOX = this.anchorX;
        this.stickOY = this.anchorY;
      } else {
        this.stickOX = e.clientX;
        this.stickOY = e.clientY;
      }
      this.pointerId = e.pointerId;
      this.stickActive = true;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      if (this.scheme === 'bottomHalf') return; // origin stays pinned to the anchor
      const dx = this.stickX - this.stickOX;
      const dy = this.stickY - this.stickOY;
      const d = len(dx, dy);
      if (d > STICK_RADIUS) {
        // Drag the origin along so the stick never feels "pinned" far away.
        const excess = d - STICK_RADIUS;
        this.stickOX += (dx / d) * excess;
        this.stickOY += (dy / d) * excess;
      }
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.stickActive = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Called once per frame by the game loop before the scene updates. */
  update(): void {
    let x = 0;
    let y = 0;

    if (this.stickActive) {
      const dx = this.stickX - this.stickOX;
      const dy = this.stickY - this.stickOY;
      const d = len(dx, dy);
      if (d > DEAD_ZONE) {
        const m = clamp((d - DEAD_ZONE) / (STICK_RADIUS - DEAD_ZONE), 0, 1);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    } else {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
      const d = len(x, y);
      if (d > 1) {
        x /= d;
        y /= d;
      }
    }

    this.moveX = x;
    this.moveY = y;
    this.magnitude = clamp(len(x, y), 0, 1);
    if (this.magnitude > 0.2) this.hasMoved = true;
  }

  /**
   * Movement intent for the simulation, quantized to 2 decimals so the local
   * sim consumes exactly the same numbers that travel over the wire in co-op.
   */
  sample(): { mx: number; my: number } {
    return {
      mx: Math.round(this.moveX * 100) / 100,
      my: Math.round(this.moveY * 100) / 100,
    };
  }

  /**
   * Draws the on-screen stick, shared by solo and co-op scenes.
   * 'free': only while a touch is active, following the finger.
   * 'bottomHalf': a small pad stays anchored bottom-center at all times, so
   * players build muscle memory for exactly where to rest their thumb.
   */
  renderStick(ctx: CanvasRenderingContext2D, glow: boolean, visible: boolean): void {
    if (!visible) return;
    if (this.scheme === 'bottomHalf') this.renderFixedPad(ctx, glow);
    else if (this.stickActive) this.renderFloatingStick(ctx);
  }

  private renderFloatingStick(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#7df3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.stickOX, this.stickOY, FLOAT_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7df3ff';
    ctx.beginPath();
    ctx.arc(this.stickOX + this.moveX * FLOAT_KNOB_TRAVEL, this.stickOY + this.moveY * FLOAT_KNOB_TRAVEL, FLOAT_KNOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Always-on pad: faint pill when idle, brightens and glows once a thumb grabs it. */
  private renderFixedPad(ctx: CanvasRenderingContext2D, glow: boolean): void {
    const { anchorX: ox, anchorY: oy, stickActive: active } = this;

    ctx.globalAlpha = active ? 0.14 : 0.08;
    ctx.fillStyle = '#7df3ff';
    ctx.beginPath();
    ctx.arc(ox, oy, FIXED_RING_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = active ? 0.5 : 0.26;
    ctx.strokeStyle = '#7df3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, FIXED_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    if (glow && active) {
      ctx.shadowColor = '#7df3ff';
      ctx.shadowBlur = 16;
    }
    ctx.globalAlpha = active ? 0.85 : 0.4;
    ctx.fillStyle = '#7df3ff';
    ctx.beginPath();
    ctx.arc(ox + this.moveX * FIXED_KNOB_TRAVEL, oy + this.moveY * FIXED_KNOB_TRAVEL, FIXED_KNOB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

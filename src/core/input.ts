import { clamp, len } from './utils';

const STICK_RADIUS = 46;
const DEAD_ZONE = 5;

/** True while the event targets a text field (name entry, login forms). */
export function isTyping(e: Event): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

/**
 * One-thumb virtual joystick: touch anywhere, drag to move. The origin trails
 * behind the finger when it travels past the stick radius, which keeps the
 * control responsive on direction reversals. Keyboard (WASD/arrows) is
 * supported for desktop play.
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

  private pointerId: number | null = null;
  private readonly keys = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.stickActive = true;
      this.stickOX = this.stickX = e.clientX;
      this.stickOY = this.stickY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
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
}

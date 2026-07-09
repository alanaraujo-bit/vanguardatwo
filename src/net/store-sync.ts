import type { SaveSystem } from '../core/save';
import { api } from './api';
import { applyCloudToSave } from './protocol';

const PENDING_KEY = 'vanguarda.pendingPurchase.v1';
const POLL_MS = 4_000;
// Pix QR codes expire in well under this; the margin covers a slow bank transfer
// plus webhook delivery lag before we give up and call it expired.
const MAX_TRACK_MS = 20 * 60 * 1000;

type Resolution = 'approved' | 'rejected' | 'expired';

interface Pending {
  purchaseId: string;
  startedAt: number;
}

/**
 * Tracks a pending coin purchase across reloads. `api/save.ts` treats `coins`
 * as client-authoritative on every push — so if the webhook credits coins on
 * the server while the client's local save is still stale, the next ordinary
 * save push (triggered by literally any persist(), e.g. finishing a run)
 * would overwrite the server's higher balance right back down. Polling here
 * and adopting the result via applyCloudToSave+persist() the moment payment
 * is confirmed closes that window, whether or not the store screen is open.
 */
class StoreSync {
  private save: SaveSystem | null = null;
  private timer: number | null = null;
  private polling = false;
  private readonly listeners = new Set<(status: Resolution) => void>();

  init(save: SaveSystem): void {
    this.save = save;
    if (this.read()) this.poll();
  }

  onResolve(cb: (status: Resolution) => void): void {
    this.listeners.add(cb);
  }

  offResolve(cb: (status: Resolution) => void): void {
    this.listeners.delete(cb);
  }

  track(purchaseId: string): void {
    this.write({ purchaseId, startedAt: Date.now() });
    this.poll();
  }

  /** True while a purchase started on this device is still awaiting confirmation. */
  get isTracking(): boolean {
    return this.read() !== null;
  }

  private poll(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async (): Promise<void> => {
      const pending = this.read();
      if (!pending) {
        this.polling = false;
        return;
      }
      if (Date.now() - pending.startedAt > MAX_TRACK_MS) {
        this.clear();
        this.polling = false;
        this.notify('expired');
        return;
      }
      try {
        const res = await api.purchaseStatus(pending.purchaseId);
        if (res.status === 'approved') {
          if (res.save && this.save) {
            applyCloudToSave(this.save.data, res.save);
            this.save.persist();
          }
          this.clear();
          this.polling = false;
          this.notify('approved');
          return;
        }
        if (res.status === 'rejected' || res.status === 'expired') {
          this.clear();
          this.polling = false;
          this.notify(res.status);
          return;
        }
      } catch {
        // offline or a server hiccup — keep polling, same posture as sync.ts
      }
      this.timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
  }

  private notify(status: Resolution): void {
    for (const cb of this.listeners) cb(status);
  }

  private read(): Pending | null {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      return raw ? (JSON.parse(raw) as Pending) : null;
    } catch {
      return null;
    }
  }

  private write(p: Pending): void {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch {
      // best effort — worst case we just don't resume after a reload
    }
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // best effort
    }
  }
}

export const storeSync = new StoreSync();

import type { SaveSystem } from '../core/save';
import { api, ApiError } from './api';
import { applyCloudToSave, cloudFromSave, type RunSubmission } from './protocol';
import { session } from './session';

const QUEUE_KEY = 'vanguarda.pendingRuns.v1';
const PUSH_DELAY_MS = 2000;
const QUEUE_MAX = 20;

/**
 * Cloud persistence engine. Every local persist() schedules a debounced push
 * of the whole save; run results are submitted individually (they feed the
 * leaderboard) and are queued in localStorage when offline so no record is
 * ever lost to a bad connection. Guests sync nothing.
 */
class Sync {
  private save: SaveSystem | null = null;
  private pushTimer: number | null = null;
  private pushing = false;

  init(save: SaveSystem): void {
    this.save = save;
    save.onPersist = () => this.schedulePush();
    window.addEventListener('online', () => this.flushRuns());
    session.onChange(() => {
      if (session.authed) this.flushRuns();
    });
  }

  schedulePush(): void {
    if (!session.authed) return;
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = null;
      void this.pushNow();
    }, PUSH_DELAY_MS);
  }

  async pushNow(): Promise<void> {
    if (!session.authed || this.pushing || !this.save) return;
    this.pushing = true;
    try {
      const sent = cloudFromSave(this.save.data);
      const res = await api.putSave(sent);
      // Adopt the server-merged result only when it actually differs (e.g.
      // another device improved a record) — persisting reschedules exactly
      // one converging follow-up push.
      if (JSON.stringify(res.save) !== JSON.stringify(sent)) {
        applyCloudToSave(this.save.data, res.save);
        this.save.persist();
      }
    } catch {
      // offline or server hiccup — the next persist retries
    } finally {
      this.pushing = false;
    }
  }

  /** Fire-and-forget run submission (called from GameScene.finalize). */
  submitRun(run: RunSubmission): void {
    if (!session.authed) return;
    void this.postRun(run);
  }

  /** Retry submissions that failed while offline. */
  flushRuns(): void {
    if (!session.authed) return;
    const queue = this.readQueue();
    if (queue.length === 0) return;
    this.writeQueue([]);
    for (const run of queue) void this.postRun(run);
  }

  private async postRun(run: RunSubmission): Promise<void> {
    try {
      await api.postRun(run);
    } catch (e) {
      if (e instanceof ApiError && e.transient) {
        this.enqueue(run);
      }
      // 4xx (implausible/expired session): drop silently
    }
  }

  private enqueue(run: RunSubmission): void {
    const queue = this.readQueue();
    if (queue.some((r) => r.runId === run.runId)) return;
    queue.push(run);
    this.writeQueue(queue.slice(-QUEUE_MAX));
  }

  private readQueue(): RunSubmission[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as RunSubmission[]) : [];
    } catch {
      return [];
    }
  }

  private writeQueue(queue: RunSubmission[]): void {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
      // best effort
    }
  }
}

export const sync = new Sync();

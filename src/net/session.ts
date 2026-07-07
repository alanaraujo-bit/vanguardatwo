import type { SaveSystem } from '../core/save';
import { api } from './api';
import {
  applyCloudToSave,
  cloudFromSave,
  mergeCloudSaves,
  type CloudSave,
  type PlayerInfo,
} from './protocol';

export type SessionStatus = 'guest' | 'authed';

/**
 * Client-side account state. The server session lives in an HttpOnly cookie;
 * this mirrors who is logged in, switches the SaveSystem between the guest
 * and per-account slots, and merges local progress into the cloud on login.
 */
class Session {
  status: SessionStatus = 'guest';
  player: PlayerInfo | null = null;

  private save: SaveSystem | null = null;
  private readonly listeners = new Set<() => void>();

  init(save: SaveSystem): void {
    this.save = save;
  }

  get authed(): boolean {
    return this.status === 'authed' && this.player !== null;
  }

  /** Subscribe to login/logout/rename events (menu refresh, sync kicks). */
  onChange(cb: () => void): void {
    this.listeners.add(cb);
  }

  /** Boot: silently restore the cookie session, if one exists. */
  async restore(): Promise<void> {
    try {
      const res = await api.me();
      this.adopt(res.player, res.save);
    } catch {
      // no session / offline — stay guest, cookie (if any) gets retried next boot
    }
  }

  async loginWithGoogle(credential: string): Promise<void> {
    const save = this.save;
    if (!save) throw new Error('session not initialized');
    const guest = save.guestDataForMerge();
    const res = await api.authGoogle({
      credential,
      name: save.data.name || undefined,
      localSave: guest ? cloudFromSave(guest) : undefined,
    });
    if (guest) save.markGuestMerged();
    this.adopt(res.player, res.save);
  }

  async logout(): Promise<void> {
    try {
      await api.logout();
    } catch {
      // clear locally regardless — the cookie expires on its own
    }
    window.google?.accounts.id.disableAutoSelect();
    this.player = null;
    this.status = 'guest';
    this.save?.switchToGuest();
    this.notify();
  }

  /** Change the public name (and derived handle) on the server. */
  async rename(name: string): Promise<void> {
    const res = await api.patchName(name);
    this.player = res.player;
    if (this.save) {
      this.save.data.name = res.player.name;
      this.save.persist();
    }
    this.notify();
  }

  private adopt(player: PlayerInfo, cloud: CloudSave): void {
    const save = this.save;
    if (!save) return;
    save.switchToAccount(player.id);
    // Fold any offline progress from this device's account slot into the
    // cloud state; the next sync push sends the merged result back.
    const merged = mergeCloudSaves(cloud, cloudFromSave(save.data), 'max');
    applyCloudToSave(save.data, merged);
    save.data.name = player.name;
    save.data.onboarded = true;
    save.persist();
    this.player = player;
    this.status = 'authed';
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

export const session = new Session();

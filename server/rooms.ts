import type { RoomConfig } from '../src/game/room-config';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LEN } from '../src/net/realtime';
import { Room } from './room';

/** Registry of live rooms, keyed by short code. */
export class Rooms {
  private readonly byCode = new Map<string, Room>();

  constructor() {
    // Reap lobbies nobody ever started.
    setInterval(() => {
      const now = Date.now();
      for (const room of this.byCode.values()) {
        if (room.isExpiredLobby(now)) room.destroy();
      }
    }, 30_000).unref();
  }

  get size(): number {
    return this.byCode.size;
  }

  create(cfg: RoomConfig | null = null): Room {
    let code: string;
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
    } while (this.byCode.has(code));
    const room = new Room(code, (r) => this.byCode.delete(r.code), cfg);
    this.byCode.set(code, room);
    return room;
  }

  get(code: string): Room | null {
    return this.byCode.get(code) ?? null;
  }
}

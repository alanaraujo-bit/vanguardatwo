import type { PlayerInfo } from '../../src/net/protocol';
import type { Queryable } from './db';

export interface PlayerRow {
  id: string;
  handle: string;
  display_name: string;
  created_at: string | Date;
}

export const PLAYER_COLS = 'id, handle, display_name, created_at';

export function playerInfo(row: PlayerRow): PlayerInfo {
  return {
    id: row.id,
    handle: row.handle,
    name: row.display_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** First free handle derived from the name: base, base-2, base-3, … */
export async function allocateHandle(
  q: Queryable,
  base: string,
  excludePlayerId?: string,
): Promise<string> {
  for (let i = 1; i <= 60; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const taken = await q.query(
      excludePlayerId
        ? 'select 1 from players where handle = $1 and id <> $2'
        : 'select 1 from players where handle = $1',
      excludePlayerId ? [candidate, excludePlayerId] : [candidate],
    );
    if (taken.rows.length === 0) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

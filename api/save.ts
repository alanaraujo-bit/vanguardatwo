import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clampCloudSave, mergeCloudSaves, type CloudSave, type SaveResponse } from '../src/net/protocol';
import { cloudSaveFromRow, db, SAVE_COLS, writeCloudSave } from './_lib/db';
import { csrfOk, methodIs, sendError } from './_lib/http';
import { requireSession } from './_lib/session';

/**
 * PUT /api/save — cloud-save push. Records and aggregates merge
 * monotonically (max of both sides); coins follow the client, since
 * purchases legitimately lower them. Leaderboard columns are untouched.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'PUT')) return;
  if (!csrfOk(req, res)) return;
  const claims = await requireSession(req, res);
  if (!claims) return;

  const body = (req.body ?? {}) as { save?: unknown };
  if (typeof body.save !== 'object' || body.save === null) {
    sendError(res, 400, 'bad_request');
    return;
  }
  const pushed = clampCloudSave(body.save as Partial<CloudSave>);

  const client = await db().connect();
  try {
    await client.query('begin');
    const row = await client.query(
      `select ${SAVE_COLS} from saves where player_id = $1 for update`,
      [claims.playerId],
    );
    if (row.rows.length === 0) {
      await client.query('rollback');
      sendError(res, 401, 'unauthorized');
      return;
    }
    const merged = mergeCloudSaves(pushed, cloudSaveFromRow(row.rows[0]), 'a');
    await writeCloudSave(client, claims.playerId, merged);
    await client.query('commit');

    const response: SaveResponse = { save: merged };
    res.status(200).json(response);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    console.error('save failed', e);
    sendError(res, 500, 'internal');
  } finally {
    client.release();
  }
}

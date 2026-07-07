import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuth2Client } from 'google-auth-library';
import { nameError, handleFromName, sanitizeName } from '../../src/net/names';
import { clampCloudSave, mergeCloudSaves, type AuthResponse, type CloudSave } from '../../src/net/protocol';
import { cloudSaveFromRow, db, SAVE_COLS, writeCloudSave } from '../_lib/db';
import { csrfOk, methodIs, sendError } from '../_lib/http';
import { allocateHandle, playerInfo, PLAYER_COLS, type PlayerRow } from '../_lib/players';
import { setSessionCookie, signSession } from '../_lib/session';

const oauth = new OAuth2Client();

/**
 * POST /api/auth/google — body { credential, name?, localSave? }.
 * Verifies the Google ID token, upserts the player, merges the device's
 * guest progress into the cloud save (first login only — the client sends
 * localSave once) and issues the session cookie.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'POST')) return;
  if (!csrfOk(req, res)) return;

  const body = (req.body ?? {}) as { credential?: unknown; name?: unknown; localSave?: unknown };
  if (typeof body.credential !== 'string' || body.credential.length === 0) {
    sendError(res, 400, 'bad_request');
    return;
  }

  let sub: string;
  let email: string | null;
  let googleName: string;
  try {
    const ticket = await oauth.verifyIdToken({
      idToken: body.credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('no subject');
    sub = payload.sub;
    email = payload.email ?? null;
    googleName = payload.name ?? payload.given_name ?? '';
  } catch {
    sendError(res, 401, 'invalid_credential');
    return;
  }

  const client = await db().connect();
  let player: PlayerRow;
  let cloud: CloudSave;
  let isNew = false;
  try {
    await client.query('begin');

    const existing = await client.query(
      `select ${PLAYER_COLS} from players where google_sub = $1`,
      [sub],
    );
    if (existing.rows.length > 0) {
      player = existing.rows[0] as PlayerRow;
      await client.query(
        'update players set last_seen_at = now(), email = coalesce($2, email) where id = $1',
        [player.id, email],
      );
    } else {
      isNew = true;
      // Prefer the name chosen in-game; fall back to the Google profile name.
      const chosen = sanitizeName(typeof body.name === 'string' ? body.name : '');
      const fromGoogle = sanitizeName(googleName).slice(0, 16);
      const name =
        nameError(chosen) === null ? chosen
        : nameError(fromGoogle) === null ? fromGoogle
        : 'Piloto';
      const handle = await allocateHandle(client, handleFromName(name));
      const inserted = await client.query(
        `insert into players (google_sub, email, handle, display_name)
         values ($1, $2, $3, $4) returning ${PLAYER_COLS}`,
        [sub, email, handle, name],
      );
      player = inserted.rows[0] as PlayerRow;
      await client.query('insert into saves (player_id) values ($1)', [player.id]);
    }

    const saveRow = await client.query(
      `select ${SAVE_COLS} from saves where player_id = $1 for update`,
      [player.id],
    );
    cloud = cloudSaveFromRow(saveRow.rows[0]);
    if (body.localSave !== undefined && body.localSave !== null) {
      cloud = mergeCloudSaves(clampCloudSave(body.localSave as Partial<CloudSave>), cloud, 'max');
      await writeCloudSave(client, player.id, cloud);
    }

    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    console.error('auth/google failed', e);
    sendError(res, 500, 'internal');
    return;
  } finally {
    client.release();
  }

  setSessionCookie(res, await signSession(player.id, player.handle));
  const response: AuthResponse = { player: playerInfo(player), save: cloud, isNew };
  res.status(200).json(response);
}

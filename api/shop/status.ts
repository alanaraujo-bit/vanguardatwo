import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { PurchaseStatus, PurchaseStatusResponse } from '../../src/net/protocol.js';
import { cloudSaveFromRow, db, SAVE_COLS } from '../_lib/db.js';
import { sendDiscordNotification } from '../_lib/discord.js';
import { methodIs, queryParam, sendError } from '../_lib/http.js';
import { requireSession } from '../_lib/session.js';

/**
 * GET /api/shop/status?purchaseId=… — polled by the client while a Pix QR
 * is on screen (and by storeSync in the background after a reload). Returns
 * the current cloud save alongside 'approved' so the client can adopt the
 * authoritative coin total in the same round trip.
 *
 * When a pending purchase has passed its expires_at, this endpoint also
 * marks it 'expired' in the database (once) and sends a Discord notification.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;
  const claims = await requireSession(req, res);
  if (!claims) return;

  const purchaseId = queryParam(req, 'purchaseId');
  if (!purchaseId) {
    sendError(res, 400, 'bad_request');
    return;
  }

  try {
    const result = await db().query(
      `select
         case when status = 'pending' and expires_at < now() then 'expired' else status end as status
       from purchases where id = $1 and player_id = $2`,
      [purchaseId, claims.playerId],
    );
    if (result.rows.length === 0) {
      sendError(res, 404, 'not_found');
      return;
    }
    const status = result.rows[0].status as PurchaseStatus;

    // Se a compra expirou, atualiza o status no banco e notifica o Discord
    if (status === 'expired') {
      const updated = await db().query(
        `update purchases set status = 'expired' where id = $1 and status = 'pending'
         returning pack_id, amount_cents, coins, player_id`,
        [purchaseId],
      );
      if (updated.rows.length > 0) {
        const row = updated.rows[0] as { pack_id: string; amount_cents: number; coins: number; player_id: string };
        const player = await db().query(
          'select display_name, handle from players where id = $1',
          [row.player_id],
        );
        if (player.rows.length > 0) {
          sendDiscordNotification({
            type: 'expired',
            playerName: (player.rows[0] as { display_name: string; handle: string }).display_name,
            handle: (player.rows[0] as { display_name: string; handle: string }).handle,
            packId: row.pack_id,
            amountCents: row.amount_cents,
            coins: row.coins,
            purchaseId,
          }).catch((err) => console.error('discord notification failed', err));
        }
      }
    }

    if (status !== 'approved') {
      const response: PurchaseStatusResponse = { status };
      res.status(200).json(response);
      return;
    }

    const saveRow = await db().query(`select ${SAVE_COLS} from saves where player_id = $1`, [claims.playerId]);
    const response: PurchaseStatusResponse = { status, save: cloudSaveFromRow(saveRow.rows[0]) };
    res.status(200).json(response);
  } catch (e) {
    console.error('purchase status failed', e);
    sendError(res, 500, 'internal');
  }
}

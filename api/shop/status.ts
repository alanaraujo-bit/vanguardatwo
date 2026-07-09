import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { PurchaseStatus, PurchaseStatusResponse } from '../../src/net/protocol.js';
import { cloudSaveFromRow, db, SAVE_COLS } from '../_lib/db.js';
import { methodIs, queryParam, sendError } from '../_lib/http.js';
import { requireSession } from '../_lib/session.js';

/**
 * GET /api/shop/status?purchaseId=… — polled by the client while a Pix QR
 * is on screen (and by storeSync in the background after a reload). Returns
 * the current cloud save alongside 'approved' so the client can adopt the
 * authoritative coin total in the same round trip.
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

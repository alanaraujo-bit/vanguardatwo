import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/db.js';
import { methodIs, sendError } from '../_lib/http.js';
import { packById } from '../../src/game/store.js';

/**
 * GET /api/shop/daily-summary?secret=xxx — generates a sales summary for the
 * last 24 hours and sends it to the Discord webhook.
 *
 * Protected by a shared secret (DAILY_SUMMARY_SECRET env var) so only your
 * cron service (e.g. cron-job.org) can call it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;

  const secret = typeof req.query.secret === 'string' ? req.query.secret : null;
  const expected = process.env.DAILY_SUMMARY_SECRET;
  if (!secret || !expected || secret !== expected) {
    sendError(res, 401, 'forbidden');
    return;
  }

  try {
    // Vendas aprovadas nas últimas 24h
    const sales = await db().query(
      `select pack_id, coins, amount_cents, player_id, credited_at
       from purchases
       where status = 'approved' and credited_at > now() - interval '24 hours'
       order by credited_at desc`,
    );

    // Rejeições/expirados nas últimas 24h
    const failures = await db().query(
      `select status, count(*)::int as qty
       from purchases
       where status in ('rejected', 'expired') and created_at > now() - interval '24 hours'
       group by status`,
    );

    const rows = sales.rows as Array<{
      pack_id: string; coins: number; amount_cents: number; player_id: string;
    }>;

    // Métricas principais
    const totalPurchases = rows.length;
    const totalRevenueCents = rows.reduce((s, r) => s + r.amount_cents, 0);
    const totalCoinsSold = rows.reduce((s, r) => s + Number(r.coins), 0);
    const uniqueBuyers = new Set(rows.map((r) => r.player_id)).size;
    const avgTicketCents = totalPurchases > 0 ? Math.round(totalRevenueCents / totalPurchases) : 0;
    const coinsPerReal = totalRevenueCents > 0
      ? (totalCoinsSold / (totalRevenueCents / 100)).toFixed(1)
      : '—';

    // Contagem por pacote
    const packCounts: Record<string, number> = {};
    let topQty = 0;
    let topId = '';
    for (const r of rows) {
      packCounts[r.pack_id] = (packCounts[r.pack_id] || 0) + 1;
      if (packCounts[r.pack_id] > topQty) {
        topQty = packCounts[r.pack_id];
        topId = r.pack_id;
      }
    }
    const topPackName = topId ? (packById(topId)?.name ?? topId) : '—';

    // Lista de pacotes ordenados com barra visual
    const packBreakdown = Object.entries(packCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, qty]) => {
        const p = packById(id);
        const name = p?.name ?? id;
        const pct = totalPurchases > 0 ? ((qty / totalPurchases) * 100).toFixed(0) : '0';
        const filled = Math.round(Number(pct) / 10);
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, 10 - filled));
        return '`' + bar + '` **' + name + '**: ' + qty + 'x (' + pct + '%)';
      })
      .join('\n') || 'Nenhuma venda no período.';

    // Contagem de falhas
    const failMap: Record<string, number> = {};
    for (const r of failures.rows as Array<{ status: string; qty: number }>) {
      failMap[r.status] = r.qty;
    }
    const rejectedQty = failMap['rejected'] ?? 0;
    const expiredQty = failMap['expired'] ?? 0;

    // Intervalo de datas
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fmt = (d: Date): string =>
      d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
    const periodStr = fmt(start) + ' \u2192 ' + fmt(now);

    // Formatação monetária
    const fmtBRL = (cents: number): string =>
      (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const embed = {
      title: '\uD83D\uDCCA RESUMO DI\u00C1RIO DE VENDAS',
      color: 0x0066ff,
      description: [
        '\uD83D\uDCC5 **Per\u00EDodo:** ' + periodStr,
        '',
        totalPurchases > 0
          ? '\uD83C\uDF89 **' + totalPurchases + ' compra' + (totalPurchases !== 1 ? 's' : '') + '** realizada' + (totalPurchases !== 1 ? 's' : '') + ' no per\u00EDodo!'
          : '\uD83D\uDE34 Nenhuma venda registrada nas \u00FAltimas 24 horas.',
      ].join('\n'),
      fields: [
        {
          name: '\uD83D\uDCB0 Faturamento',
          value: '**Total:** ' + fmtBRL(totalRevenueCents) + '\n**Ticket m\u00E9dio:** ' + fmtBRL(avgTicketCents),
          inline: true,
        },
        {
          name: '\uD83E\uDE99 Moedas',
          value: '**Vendidas:** ' + totalCoinsSold.toLocaleString('pt-BR') + '\n**Custo/mil:** ' + coinsPerReal + ' moedas',
          inline: true,
        },
        {
          name: '\uD83D\uDC65 Clientes',
          value: '**Compradores:** ' + uniqueBuyers + '\n**Rejei\u00E7\u00F5es:** ' + rejectedQty + '\n**Expirados:** ' + expiredQty,
          inline: true,
        },
        {
          name: '\uD83D\uDCE6 Pacote mais vendido',
          value: '**' + topPackName + '** — ' + topQty + 'x' + (totalPurchases > 0 ? ' (' + Math.round((topQty / totalPurchases) * 100) + '%)' : ''),
          inline: true,
        },
        {
          name: '\uD83D\uDCC8 Distribui\u00E7\u00E3o por pacote',
          value: packBreakdown,
          inline: false,
        },
      ],
      timestamp: now.toISOString(),
      footer: { text: 'BALUARTE \u2014 Loja \u2022 Resumo autom\u00E1tico di\u00E1rio' },
    };

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      const discordRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!discordRes.ok) {
        const body = await discordRes.text().catch(() => '');
        console.error('daily-summary discord webhook returned ' + discordRes.status + ': ' + body);
      }
    }

    res.status(200).json({
      ok: true,
      summary: {
        period: { start: start.toISOString(), end: now.toISOString() },
        revenueCents: totalRevenueCents,
        coinsSold: totalCoinsSold,
        purchases: totalPurchases,
        uniqueBuyers,
        avgTicketCents,
        coinsPerReal: isNaN(Number(coinsPerReal)) ? null : Number(coinsPerReal),
        failures: { rejected: rejectedQty, expired: expiredQty },
        topPack: topId ? { id: topId, name: topPackName, count: topQty } : null,
      },
    });
  } catch (e) {
    console.error('daily-summary failed', e);
    sendError(res, 500, 'internal');
  }
}

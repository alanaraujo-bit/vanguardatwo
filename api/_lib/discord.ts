import { packById, formatBRL } from '../../src/game/store.js';

// --------------------------------------------------------------------------
// Discord notification via webhook (shared module)
// --------------------------------------------------------------------------

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  color: number;
  description?: string;
  fields: DiscordField[];
  timestamp: string;
  footer: { text: string; icon_url?: string };
}

export type DiscordNotificationType = 'approved' | 'rejected' | 'expired';

const NOTIFICATION_CONFIG: Record<DiscordNotificationType, {
  title: string;
  color: number;
  emoji: string;
  action: string;
  descriptionPrefix: string;
}> = {
  approved: {
    title: '💰 NOVA VENDA CONFIRMADA',
    color: 0x00ff88,
    emoji: '✅',
    action: 'comprou',
    descriptionPrefix: 'Pagamento aprovado com sucesso! As moedas já foram creditadas.',
  },
  rejected: {
    title: '❌ PAGAMENTO REJEITADO',
    color: 0xff4444,
    emoji: '🚫',
    action: 'tentou comprar',
    descriptionPrefix: 'O pagamento foi recusado pela operadora do banco. Nenhum valor foi cobrado.',
  },
  expired: {
    title: '⏰ PAGAMENTO EXPIRADO',
    color: 0xffaa00,
    emoji: '⌛',
    action: 'tentou comprar',
    descriptionPrefix: 'O QR Code Pix expirou antes da confirmação do pagamento. Nenhum valor foi cobrado.',
  },
};

/**
 * Formata uma data ISO para o fuso horário brasileiro (ex: "09/07/2025 às 14:32").
 */
function fmtBR(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * Envia um embed ricamente detalhado para o canal do Discord.
 * Fire-and-forget: o caller deve tratar o catch se quiser logs de erro.
 */
export async function sendDiscordNotification(opts: {
  type: DiscordNotificationType;
  playerName: string;
  handle: string;
  packId: string;
  amountCents: number;
  coins: number;
  purchaseId: string;
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('sendDiscordNotification: DISCORD_WEBHOOK_URL not configured, skipping notification');
    return;
  }

  const pack = packById(opts.packId);
  const packName = pack?.name ?? opts.packId;
  const amountBRL = formatBRL(opts.amountCents);
  const cfg = NOTIFICATION_CONFIG[opts.type];
  const coinsFormatted = opts.coins.toLocaleString('pt-BR');
  const now = new Date();
  const purchaseDate = fmtBR(now);

  // Calcula o custo por moeda (milheiro)
  const coinsPerReal = opts.amountCents > 0
    ? (opts.coins / (opts.amountCents / 100)).toFixed(1)
    : '—';

  const embed: DiscordEmbed = {
    title: cfg.title,
    color: cfg.color,
    description: [
      `**${cfg.descriptionPrefix}**`,
      '',
      `┌ ${cfg.emoji}  **${opts.playerName}** ${cfg.action} **${packName}**`,
      `└ 💳  ${amountBRL} → **+${coinsFormatted} moedas**`,
    ].join('\n'),
    fields: [
      // Coluna 1: Jogador
      { name: '👤 Jogador', value: [
        `**Nome:** ${opts.playerName}`,
        `**Handle:** @${opts.handle}`,
      ].join('\n'), inline: true },

      // Coluna 2: Pacote
      { name: '📦 Pacote', value: [
        `**Nome:** ${packName}`,
        `**Moedas:** ${coinsFormatted}`,
      ].join('\n'), inline: true },

      // Coluna 3: Valor (quebra linha após 2 inlines)
      { name: '💵 Financeiro', value: [
        `**Valor:** ${amountBRL}`,
        `**Custo/mil:** ${coinsPerReal} moedas`,
      ].join('\n'), inline: true },

      // Informações adicionais (full width)
      { name: '🔍 Detalhes da Transação', value: [
        `**ID da compra:** \`${opts.purchaseId.slice(0, 8)}…\``,
        `**Data:** ${purchaseDate}`,
      ].join('\n'), inline: false },
    ],
    timestamp: now.toISOString(),
    footer: {
      text: 'BALUARTE — Loja • Notificação automática',
    },
  };

  console.log(`sendDiscordNotification: sending ${opts.type} notification for ${opts.playerName} (${opts.packId}, ${opts.amountCents} cents)`);

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`discord webhook returned ${res.status}: ${body}`);
  }
}

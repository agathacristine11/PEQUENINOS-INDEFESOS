// ============================================================================
// POST /api/webhook/blackcat
// A Blackcat chama esse endpoint automaticamente quando o status de um Pix
// muda (ex: pagamento confirmado). Respondemos rápido com 200 para a
// Blackcat não ficar reenviando o webhook.
//
// OBS: O envio pra UTMify é feito diretamente pela própria Blackcat
// (integração nativa "Webhook + UTMify" configurada no painel deles).
// Por isso este arquivo NÃO chama a UTMify de novo — evita duplicar vendas.
// ============================================================================

import { Redis } from '@upstash/redis';
import { fbCapiSendEvent } from '../../lib/config.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const PAID_STATUSES = ['paid', 'approved', 'completed', 'complete', 'confirmed', 'success', 'succeeded'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ received: false });
  }

  try {
    const event = req.body && typeof req.body === 'object' ? req.body : {};
    const sale = event.data && typeof event.data === 'object' ? event.data : event;

    const transactionId = sale.transactionId || event.transactionId || event.id || null;
    const status = String(sale.status || event.status || '').toLowerCase();

    console.log(
      `📩 Webhook Blackcat recebido: event=${event.event || '?'} transactionId=${transactionId || '?'} status=${status || '?'}`
    );

    if (transactionId && PAID_STATUSES.includes(status)) {
      const raw = await redis.get(`tx:${transactionId}`);

      if (raw) {
        const txData = typeof raw === 'string' ? JSON.parse(raw) : raw;

        await fbCapiSendEvent(
          'Purchase',
          String(transactionId),
          Number(txData.amount || 0),
          {
            fbp: txData.fbp,
            fbc: txData.fbc,
            ip: txData.ip,
            userAgent: txData.userAgent,
          },
          txData.sourceUrl || ''
        );

        await redis.del(`tx:${transactionId}`); // Não precisamos mais guardar essa fichinha.
      } else {
        console.warn(`Facebook CAPI: fichinha da transação ${transactionId} não encontrada (Purchase não enviado).`);
      }
    }

    // TODO: aqui você pode, por exemplo:
    // - Marcar a doação como confirmada num banco de dados
    // - Atualizar o valor "Arrecadados" da barra de progresso do site
    // - Disparar um e-mail de agradecimento pro doador

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('webhook fatal:', error.message, error.stack);
    // Sempre 200 pra Blackcat não ficar reenviando o mesmo evento.
    return res.status(200).json({ received: true });
  }
}

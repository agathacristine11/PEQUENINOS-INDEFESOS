// ============================================================================
// GET /api/status/{transactionId}
// Usado pelo front-end (polling a cada 5s) para checar se o Pix já foi pago.
// Na Vercel, o nome do arquivo entre colchetes ([id].js) já cria essa rota
// dinâmica automaticamente — não precisa de .htaccess nem de reescrita.
// ============================================================================

import { PUBLIC_URL, blackcatRequest } from '../../lib/config.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', PUBLIC_URL || '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const rawId = req.query.id || '';
  const transactionId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '');

  if (!transactionId) {
    return res.status(400).json({ success: false, message: 'ID de transação inválido.' });
  }

  const result = await blackcatRequest('GET', `/sales/${transactionId}/status`);
  const data = result.data;

  if (!result.ok || !data?.success) {
    return res.status(result.status || 500).json({
      success: false,
      message: 'Não foi possível consultar o status.',
    });
  }

  return res.status(200).json({
    success: true,
    status: data.data?.status ?? null,
  });
}

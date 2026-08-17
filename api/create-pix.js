// ============================================================================
// POST /api/create-pix
//
// O navegador envia SOMENTE: { "amount": 20, "utm": {...}, "fb": {...} }
// Nome/e-mail/telefone/CPF ficam nas variáveis de ambiente da Vercel.
// Isso permite gerar o PIX sem mostrar o formulário ao doador.
// ============================================================================

import { randomBytes } from 'crypto';
import { Redis } from '@upstash/redis';
import {
  PUBLIC_URL,
  blackcatRequest,
  fbCapiSendEvent,
  onlyDigits,
  isValidEmail,
} from '../lib/config.js';
import { rateLimitCheck, clientIp } from '../lib/ratelimit.js';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', PUBLIC_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    // -----------------------------------------------------------
    // RATE LIMIT
    // -----------------------------------------------------------
    const ip = clientIp(req);

    const allowed = await rateLimitCheck('create_pix', ip, 15, 10 * 60);
    if (!allowed) {
      return res.status(429).json({
        success: false,
        message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};

    // -----------------------------------------------------------
    // VALOR
    // -----------------------------------------------------------
    const amountNumber = typeof body.amount === 'number' || !isNaN(Number(body.amount))
      ? Number(body.amount)
      : 0;

    if (!amountNumber || amountNumber < 1) {
      return res.status(400).json({ success: false, message: 'Valor de doação inválido.' });
    }

    if (amountNumber > 50000) {
      return res.status(400).json({
        success: false,
        message: 'Valor muito alto. Entre em contato para doações grandes.',
      });
    }

    const amountInCents = Math.round(amountNumber * 100);

    // -----------------------------------------------------------
    // UTM / RASTREAMENTO DE CAMPANHA (para UTMify, via metadata da Blackcat)
    // -----------------------------------------------------------
    const allowedUtmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'];
    const utm = {};
    const rawUtm = body.utm && typeof body.utm === 'object' ? body.utm : {};

    for (const key of allowedUtmKeys) {
      if (rawUtm[key] && typeof rawUtm[key] === 'string') {
        utm[key] = rawUtm[key].trim().slice(0, 255);
      }
    }

    // -----------------------------------------------------------
    // FACEBOOK: dados para a API de Conversões (rastreamento via servidor)
    // -----------------------------------------------------------
    const fbData = body.fb && typeof body.fb === 'object' ? body.fb : {};
    const fbp = typeof fbData.fbp === 'string' ? fbData.fbp.slice(0, 200) : null;
    const fbc = typeof fbData.fbc === 'string' ? fbData.fbc.slice(0, 200) : null;
    const initEventId = typeof fbData.initEventId === 'string' ? fbData.initEventId.slice(0, 100) : null;
    const sourceUrl = typeof fbData.sourceUrl === 'string' ? fbData.sourceUrl.slice(0, 500) : '';
    const userAgent = req.headers['user-agent'] || null;

    // -----------------------------------------------------------
    // DADOS DO CLIENTE
    // O usuário NÃO precisa preencher esses dados.
    // Eles vêm das variáveis de ambiente configuradas na Vercel.
    // -----------------------------------------------------------
    const name = (process.env.PIX_CUSTOMER_NAME || '').trim();
    const email = (process.env.PIX_CUSTOMER_EMAIL || '').trim();
    const phoneDigits = onlyDigits(process.env.PIX_CUSTOMER_PHONE || '');
    const cpfDigits = onlyDigits(process.env.PIX_CUSTOMER_CPF || '');

    if (!name || name.length < 3) {
      return res.status(500).json({
        success: false,
        message: 'Configure PIX_CUSTOMER_NAME nas variáveis de ambiente da Vercel.',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(500).json({
        success: false,
        message: 'Configure um PIX_CUSTOMER_EMAIL válido nas variáveis de ambiente da Vercel.',
      });
    }

    if (phoneDigits.length < 10) {
      return res.status(500).json({
        success: false,
        message: 'Configure um PIX_CUSTOMER_PHONE válido nas variáveis de ambiente da Vercel.',
      });
    }

    if (cpfDigits.length !== 11) {
      return res.status(500).json({
        success: false,
        message: 'Configure um CPF válido em PIX_CUSTOMER_CPF nas variáveis de ambiente da Vercel.',
      });
    }

    // -----------------------------------------------------------
    // BODY EXIGIDO PELA BLACKCAT
    // -----------------------------------------------------------
    const payload = {
      amount: amountInCents,
      currency: 'BRL',
      paymentMethod: 'pix',

      items: [
        {
          title: 'Doação - Pequenos Indefesos',
          quantity: 1,
          unitPrice: amountInCents,
          tangible: false,
        },
      ],

      customer: {
        name,
        email,
        phone: phoneDigits,
        document: {
          number: cpfDigits,
          type: 'cpf',
        },
      },

      pix: {
        expiresInDays: 1,
      },

      postbackUrl: `${PUBLIC_URL}/api/webhook/blackcat`,
      externalRef: `DOACAO-${Date.now()}-${randomBytes(4).toString('hex')}`,
      metadata: {
        description: 'Doação via site - Pequenos Indefesos',
        utm,
      },
    };

    // -----------------------------------------------------------
    // CHAMA A BLACKCAT
    // -----------------------------------------------------------
    const result = await blackcatRequest('POST', '/sales/create-sale', payload);
    const data = result.data;

    if (!result.ok) {
      console.error('Blackcat create-sale HTTP', result.status, JSON.stringify(data));

      let message = data?.message || 'A Blackcat recusou a criação do PIX.';
      if (data?.error) {
        message += ' ' + String(data.error);
      }

      return res.status(result.status >= 400 ? result.status : 502).json({
        success: false,
        message,
        httpStatus: result.status,
      });
    }

    if (!data?.success || !data?.data) {
      console.error('Resposta inesperada da Blackcat:', JSON.stringify(data));
      return res.status(502).json({
        success: false,
        message: 'A Blackcat respondeu, mas não retornou os dados do PIX.',
      });
    }

    const sale = data.data;
    const paymentData = sale.paymentData || {};

    const transactionId = sale.transactionId || null;
    const qrCodeBase64 = paymentData.qrCodeBase64 || null;
    // Algumas adquirentes mandam o código Pix no campo "qrCode" em vez de
    // "copyPaste" — aceitamos os dois nomes.
    const copyPaste = paymentData.copyPaste || paymentData.qrCode || null;
    const expiresAt = paymentData.expiresAt || null;

    if (!transactionId || !copyPaste) {
      console.error('Blackcat sem dados PIX completos:', JSON.stringify(data));
      return res.status(502).json({
        success: false,
        message: 'A cobrança foi criada, mas a Blackcat não retornou o código Pix.',
      });
    }

    // -----------------------------------------------------------
    // FACEBOOK: dispara o InitiateCheckout pelo servidor (deduplica com o
    // evento que o navegador já disparou usando o mesmo initEventId) e
    // guarda os dados (fbp/fbc/ip/utm) numa "fichinha" temporária no Vercel
    // KV, pro webhook.js usar depois quando o pagamento for confirmado
    // (Purchase). Expira sozinha em 24h, pra não acumular lixo.
    // -----------------------------------------------------------
    if (initEventId) {
      await fbCapiSendEvent(
        'InitiateCheckout',
        initEventId,
        amountNumber,
        { fbp, fbc, ip, userAgent },
        sourceUrl
      );
    }

    await redis.set(
      `tx:${transactionId}`,
      JSON.stringify({
        fbp,
        fbc,
        ip,
        userAgent,
        sourceUrl,
        amount: amountNumber,
        utm,
        createdAt: Date.now(),
      }),
      { ex: 60 * 60 * 24 }
    );

    // -----------------------------------------------------------
    // RESPOSTA LIMPA PARA O NAVEGADOR
    // -----------------------------------------------------------
    return res.status(200).json({
      success: true,
      transactionId,
      qrCodeBase64,
      copyPaste,
      expiresAt,
      amount: sale.amount ?? amountInCents,
    });
  } catch (error) {
    console.error('create-pix fatal:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Erro interno no servidor ao gerar o PIX.',
    });
  }
}

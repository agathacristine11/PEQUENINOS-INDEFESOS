// ============================================================================
// lib/config.js
// Equivalente ao lib/config.php original. Na Vercel, as variáveis de ambiente
// (antes no .env) ficam configuradas no painel do projeto (Settings >
// Environment Variables), não em um arquivo — por isso lemos direto de
// process.env, sem precisar de um "env.php" equivalente.
// ============================================================================

export const BLACKCAT_API_KEY = (process.env.BLACKCAT_API_KEY || '').trim();
export const BLACKCAT_BASE_URL = 'https://api.blackcatoficial.com/api';
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
export const FACEBOOK_PIXEL_ID = (process.env.FACEBOOK_PIXEL_ID || '').trim();
export const FACEBOOK_CAPI_TOKEN = (process.env.FACEBOOK_CAPI_TOKEN || '').trim();

export function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

/**
 * Chama a API da Blackcat. Equivalente ao blackcat_request() do PHP,
 * incluindo o mesmo header de autenticação (X-API-Key).
 */
export async function blackcatRequest(method, endpoint, body = null) {
  const url = BLACKCAT_BASE_URL + endpoint;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-API-Key': BLACKCAT_API_KEY,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const status = resp.status;
    let decoded = null;

    try {
      decoded = await resp.json();
    } catch (_) {
      return {
        ok: false,
        status: status || 502,
        data: { message: 'A Blackcat retornou uma resposta que não é JSON.' },
      };
    }

    return {
      ok: status >= 200 && status < 300,
      status: status || 500,
      data: decoded,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: 502,
      data: { message: 'Erro de conexão com a Blackcat: ' + error.message },
    };
  }
}

/**
 * Envia um evento pra API de Conversões do Facebook (rastreamento via servidor).
 * $eventId deve ser o MESMO usado no fbq('track', ..., {eventID}) do navegador,
 * para o Facebook deduplicar os dois envios (Pixel + servidor) automaticamente.
 * Nunca lança erro pro fluxo principal — só registra falhas no console.
 */
export async function fbCapiSendEvent(eventName, eventId, valueInReais, userData = {}, sourceUrl = '') {
  if (!FACEBOOK_PIXEL_ID || !FACEBOOK_CAPI_TOKEN) {
    return; // Integração ainda não configurada — ignora silenciosamente.
  }

  const userDataFiltered = {};
  // fbp/fbc NÃO são hasheados (já são identificadores anônimos).
  if (userData.fbp) userDataFiltered.fbp = userData.fbp;
  if (userData.fbc) userDataFiltered.fbc = userData.fbc;
  if (userData.ip) userDataFiltered.client_ip_address = userData.ip;
  if (userData.userAgent) userDataFiltered.client_user_agent = userData.userAgent;

  const data = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    user_data: userDataFiltered,
    custom_data: {
      value: valueInReais,
      currency: 'BRL',
      content_name: 'Doação Pequenos Indefesos',
    },
  };

  if (sourceUrl) {
    data.event_source_url = sourceUrl;
  }

  const url =
    `https://graph.facebook.com/v20.0/${FACEBOOK_PIXEL_ID}/events?access_token=` +
    encodeURIComponent(FACEBOOK_CAPI_TOKEN);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [data] }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Facebook CAPI: falha ao enviar ${eventName}. HTTP ${resp.status} ${text}`);
    }
  } catch (error) {
    console.error('Facebook CAPI erro:', error);
  }
}

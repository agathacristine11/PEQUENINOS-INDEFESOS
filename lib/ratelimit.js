// ============================================================================
// lib/ratelimit.js
// Equivalente ao lib/ratelimit.php original.
//
// IMPORTANTE: na Hostinger, o rate-limit era controlado com arquivos na pasta
// data/. Na Vercel isso NÃO funciona, porque cada chamada de API roda numa
// "função" isolada e temporária — nada gravado em arquivo local sobrevive
// entre uma chamada e outra. Por isso usamos o Vercel KV (um banco de dados
// tipo Redis, com camada gratuita), que guarda esse controle de verdade.
// ============================================================================

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

/**
 * @param {string} bucket - nome do grupo (ex: "create_pix")
 * @param {string} ip - IP do cliente
 * @param {number} maxAttempts - tentativas permitidas na janela de tempo
 * @param {number} windowSeconds - duração da janela, em segundos
 * @returns {Promise<boolean>} true se a requisição é permitida
 */
export async function rateLimitCheck(bucket, ip, maxAttempts, windowSeconds) {
  const safeIp = String(ip || 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '_');
  const key = `ratelimit:${bucket}:${safeIp}`;

  try {
    const count = await redis.incr(key);

    // Só define o tempo de expiração na primeira tentativa dessa janela.
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    return count <= maxAttempts;
  } catch (error) {
    // Se o Redis falhar por algum motivo, não bloqueia a doação por causa disso.
    console.error('rateLimitCheck erro:', error);
    return true;
  }
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

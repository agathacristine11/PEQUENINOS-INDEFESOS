// ============================================================================
// lib/redis.js
// Conexão com o Redis (Redis Cloud, via integração "Redis" da Vercel).
// A variável REDIS_URL é criada automaticamente pela integração e já vem no
// formato redis://usuario:senha@host:porta — não precisa editar nada aqui.
// ============================================================================

import Redis from 'ioredis';

let client = null;

export function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
    });

    client.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
  }

  return client;
}

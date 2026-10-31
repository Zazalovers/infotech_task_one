import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { DatabaseTimeoutError, type HealthRepository } from '../../src/data/repositories/healthRepository.js';
import { EmailService } from '../../src/services/emailService.js';
import { HealthService } from '../../src/services/healthService.js';
import { InMemoryEmailJobRepository } from '../fakes/inMemoryEmailJobRepository.js';

function appWith(health: HealthRepository) {
  return createApp({
    emailService: new EmailService(new InMemoryEmailJobRepository(), { maxAttempts: 4 }),
    healthService: new HealthService(health, { version: '1.2.3', dbTimeoutMs: 100 }),
    apiKey: 'test-api-key',
    logger: pino({ level: 'silent' }),
  });
}

describe('GET /health', () => {
  it('returns 200 with app and database status when the database is up', async () => {
    const res = await request(appWith({ ping: async () => 4 })).get('/health').expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      status: 'ok',
      app: { status: 'up', version: '1.2.3' },
      database: { status: 'up', latencyMs: 4 },
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const res = await request(
      appWith({
        ping: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
        },
      }),
    )
      .get('/health')
      .expect(503);

    expect(res.body).toMatchObject({ status: 'error', app: { status: 'up' }, database: { status: 'down' } });
    // Connection details must not leak.
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  it('reports a timeout as down', async () => {
    const res = await request(
      appWith({
        ping: async () => {
          throw new DatabaseTimeoutError(100);
        },
      }),
    )
      .get('/health')
      .expect(503);
    expect(res.body.database).toEqual({ status: 'down', error: 'timeout' });
  });

  it('needs no API key', async () => {
    await request(appWith({ ping: async () => 1 })).get('/health').expect(200);
  });
});

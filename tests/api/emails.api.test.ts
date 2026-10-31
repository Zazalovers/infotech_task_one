import { pino } from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { EmailService } from '../../src/services/emailService.js';
import { HealthService } from '../../src/services/healthService.js';
import { InMemoryEmailJobRepository } from '../fakes/inMemoryEmailJobRepository.js';

const API_KEY = 'test-api-key';

describe('/emails', () => {
  let repo: InMemoryEmailJobRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repo = new InMemoryEmailJobRepository();
    app = createApp({
      emailService: new EmailService(repo, { maxAttempts: 4 }),
      healthService: new HealthService({ ping: async () => 1 }, { version: 'test', dbTimeoutMs: 100 }),
      apiKey: API_KEY,
      logger: pino({ level: 'silent' }),
    });
  });

  const validBody = { to: 'delivered@resend.dev', subject: 'Hello', text: 'Hi there' };

  it('rejects requests without a valid API key', async () => {
    await request(app).post('/emails').send(validBody).expect(401);
    await request(app).post('/emails').set('x-api-key', 'wrong').send(validBody).expect(401);
  });

  it('enqueues a pending job and returns 202 without sending', async () => {
    const res = await request(app).post('/emails').set('x-api-key', API_KEY).send(validBody).expect(202);

    expect(res.body).toMatchObject({ to: 'delivered@resend.dev', subject: 'Hello', status: 'pending', attempts: 0 });
    expect(repo.jobs.get(res.body.id)).toMatchObject({ status: 'pending', textBody: 'Hi there', attempts: 0 });
  });

  it('returns field-level validation errors', async () => {
    const res = await request(app)
      .post('/emails')
      .set('x-api-key', API_KEY)
      .send({ to: 'not-an-email', subject: '' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['to', 'subject']));
  });

  it('requires html or text', async () => {
    const res = await request(app)
      .post('/emails')
      .set('x-api-key', API_KEY)
      .send({ to: 'a@example.com', subject: 'x' })
      .expect(400);
    expect(res.body.error.details[0].message).toMatch(/html or text/);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/emails')
      .set('x-api-key', API_KEY)
      .set('content-type', 'application/json')
      .send('{"to":')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('replays an idempotent request with 200 and the same job', async () => {
    const body = { ...validBody, idempotencyKey: 'signup-42' };
    const first = await request(app).post('/emails').set('x-api-key', API_KEY).send(body).expect(202);
    const second = await request(app).post('/emails').set('x-api-key', API_KEY).send(body).expect(200);
    expect(second.body.id).toBe(first.body.id);
    expect(repo.jobs.size).toBe(1);
  });

  it('gets a job by id, 404 for unknown, 400 for non-uuid', async () => {
    const created = await request(app).post('/emails').set('x-api-key', API_KEY).send(validBody);

    const res = await request(app).get(`/emails/${created.body.id}`).set('x-api-key', API_KEY).expect(200);
    expect(res.body.id).toBe(created.body.id);

    await request(app).get('/emails/7f6c9a7e-1111-4222-8333-944445555666').set('x-api-key', API_KEY).expect(404);
    await request(app).get('/emails/nope').set('x-api-key', API_KEY).expect(400);
  });

  it('lists jobs filtered by status', async () => {
    await request(app).post('/emails').set('x-api-key', API_KEY).send(validBody);
    const res = await request(app).get('/emails?status=pending&limit=5').set('x-api-key', API_KEY).expect(200);
    expect(res.body).toMatchObject({ limit: 5, offset: 0 });
    expect(res.body.items).toHaveLength(1);

    await request(app).get('/emails?status=bogus').set('x-api-key', API_KEY).expect(400);
  });
});

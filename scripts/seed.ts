import { config } from '../src/config/env.js';
import { createPool } from '../src/data/db.js';
import { PgEmailJobRepository } from '../src/data/repositories/emailJobRepository.js';
import type { EmailJobSeed } from '../src/models/emailJob.js';

// delivered@ / bounced@resend.dev are Resend test inboxes: they work without a verified domain.
const base = { htmlBody: null, maxAttempts: config.EMAIL_MAX_ATTEMPTS };

const seeds: EmailJobSeed[] = [
  {
    ...base,
    idempotencyKey: 'seed-welcome-1',
    toAddress: 'delivered@resend.dev',
    subject: 'Welcome to Mail Queue Service',
    htmlBody: '<h1>Welcome!</h1><p>This email was sent by the background worker.</p>',
    textBody: 'Welcome! This email was sent by the background worker.',
    status: 'pending',
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    sentAt: null,
  },
  {
    ...base,
    idempotencyKey: 'seed-digest-1',
    toAddress: 'delivered@resend.dev',
    subject: 'Your weekly digest',
    textBody: 'Nothing new this week.',
    status: 'pending',
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    sentAt: null,
  },
  {
    ...base,
    idempotencyKey: 'seed-bounce-1',
    toAddress: 'bounced@resend.dev',
    subject: 'This one will bounce',
    textBody: 'Resend accepts it, then reports a bounce.',
    status: 'pending',
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    sentAt: null,
  },
  {
    ...base,
    idempotencyKey: 'seed-history-sent',
    toAddress: 'delivered@resend.dev',
    subject: 'Historical sent email',
    textBody: 'Already delivered.',
    status: 'sent',
    attempts: 1,
    lastError: null,
    providerMessageId: 'seed-provider-id',
    sentAt: new Date(),
  },
  {
    ...base,
    idempotencyKey: 'seed-history-failed',
    toAddress: 'delivered@resend.dev',
    subject: 'Historical failed email',
    textBody: 'Gave up after all retries.',
    status: 'failed',
    attempts: config.EMAIL_MAX_ATTEMPTS,
    lastError: 'seed: simulated provider error',
    providerMessageId: null,
    sentAt: null,
  },
];

const pool = createPool();
const repo = new PgEmailJobRepository(pool);

try {
  let inserted = 0;
  for (const seed of seeds) {
    if (await repo.insertSeed(seed)) inserted++;
  }
  console.log(`Seed complete: ${inserted} inserted, ${seeds.length - inserted} already present`);
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}

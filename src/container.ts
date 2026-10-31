// Composition root: the only module (besides the entrypoints) that wires all layers together.
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { createPool } from './data/db.js';
import { PgEmailJobRepository } from './data/repositories/emailJobRepository.js';
import { PgHealthRepository } from './data/repositories/healthRepository.js';
import { EmailJobProcessor } from './services/emailJobProcessor.js';
import { EmailService } from './services/emailService.js';
import { HealthService } from './services/healthService.js';
import { MonitoringService } from './services/monitoringService.js';
import { AsniherHeartbeat } from './services/providers/asniherHeartbeat.js';
import { ResendEmailSender } from './services/providers/resendEmailSender.js';
import { Worker } from './worker/worker.js';

const HEALTH_DB_TIMEOUT_MS = 2000;

export function buildContainer() {
  const pool = createPool();
  const emailJobs = new PgEmailJobRepository(pool);

  const emailService = new EmailService(emailJobs, { maxAttempts: config.EMAIL_MAX_ATTEMPTS });
  const healthService = new HealthService(new PgHealthRepository(pool), {
    version: config.APP_VERSION,
    dbTimeoutMs: HEALTH_DB_TIMEOUT_MS,
  });

  function buildWorker(): Worker {
    if (!config.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required to run the worker');
    }
    const processor = new EmailJobProcessor(
      emailJobs,
      new ResendEmailSender(config.RESEND_API_KEY),
      {
        from: config.EMAIL_FROM,
        batchSize: config.WORKER_BATCH_SIZE,
        lockSeconds: config.WORKER_LOCK_SECONDS,
        retryBaseMs: config.EMAIL_RETRY_BASE_MS,
      },
      logger.child({ component: 'worker' }),
    );
    const heartbeat = config.ASNIHER_HEARTBEAT_URL ? new AsniherHeartbeat(config.ASNIHER_HEARTBEAT_URL) : null;
    const monitoring = new MonitoringService(heartbeat, config.HEARTBEAT_INTERVAL_MS, logger);
    return new Worker(
      processor,
      monitoring,
      { pollIntervalMs: config.WORKER_POLL_INTERVAL_MS, batchSize: config.WORKER_BATCH_SIZE },
      logger.child({ component: 'worker' }),
    );
  }

  return {
    emailService,
    healthService,
    buildWorker,
    close: () => pool.end(),
  };
}

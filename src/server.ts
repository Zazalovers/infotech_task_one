import { createApp } from './api/app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { buildContainer } from './container.js';
import { onShutdown } from './shutdown.js';

const container = buildContainer();
const app = createApp({
  emailService: container.emailService,
  healthService: container.healthService,
  apiKey: config.API_KEY,
  logger,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, workerEnabled: config.WORKER_ENABLED }, 'api.started');
});

const worker = config.WORKER_ENABLED ? container.buildWorker() : null;
worker?.start();

onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await worker?.stop();
  await container.close();
});

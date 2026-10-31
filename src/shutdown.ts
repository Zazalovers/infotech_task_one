import { logger } from './config/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Runs `cleanup` once on SIGTERM/SIGINT; forces exit if it takes longer than 10 s. */
export function onShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown.started');

    const force = setTimeout(() => {
      logger.error('shutdown.timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    cleanup()
      .then(() => {
        logger.info('shutdown.complete');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'shutdown.failed');
        process.exit(1);
      });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

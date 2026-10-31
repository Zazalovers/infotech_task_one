import type { Logger } from '../config/logger.js';
import type { EmailJobProcessor } from '../services/emailJobProcessor.js';
import type { MonitoringService } from '../services/monitoringService.js';

export interface DrainOptions {
  batchSize: number;
  /** Stop claiming new batches after this long, so a scheduled run never overlaps the next one. */
  maxDurationMs: number;
}

/**
 * One-shot worker run for schedulers (e.g. a Cloudflare Cron Trigger): process batches until the
 * queue has no more due jobs or the time budget is used up. Returns the number of jobs claimed.
 */
export async function drainQueue(
  processor: EmailJobProcessor,
  monitoring: MonitoringService,
  options: DrainOptions,
  logger: Logger,
): Promise<number> {
  const deadline = Date.now() + options.maxDurationMs;
  let total = 0;
  let claimed: number;
  do {
    claimed = await processor.processBatch();
    total += claimed;
  } while (claimed === options.batchSize && Date.now() < deadline);

  await monitoring.reportWorkerAlive();
  logger.info({ claimed: total }, 'worker.drain_complete');
  return total;
}

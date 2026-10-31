import type { Logger } from '../config/logger.js';
import type { EmailJobProcessor } from '../services/emailJobProcessor.js';
import type { MonitoringService } from '../services/monitoringService.js';

export interface WorkerOptions {
  pollIntervalMs: number;
  batchSize: number;
}

/** Poll loop: drains due jobs, then sleeps. Stops cleanly after the in-flight batch. */
export class Worker {
  private running = false;
  private loopDone: Promise<void> = Promise.resolve();
  private wakeUp: (() => void) | null = null;

  constructor(
    private readonly processor: EmailJobProcessor,
    private readonly monitoring: MonitoringService,
    private readonly options: WorkerOptions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info(this.options, 'worker.started');
    this.loopDone = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakeUp?.();
    await this.loopDone;
    this.logger.info('worker.stopped');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let claimed = 0;
      try {
        claimed = await this.processor.processBatch();
        await this.monitoring.reportWorkerAlive();
      } catch (err) {
        this.logger.error({ err }, 'worker.poll_failed');
      }
      // A full batch means there may be more due jobs: poll again right away.
      if (this.running && claimed < this.options.batchSize) {
        await this.sleep(this.options.pollIntervalMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakeUp = done;
    });
  }
}

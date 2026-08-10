import { Job, JobType, Prisma } from "@prisma/client";
import { jobService } from "../services/job-service.js";
import { logger } from "../config/logger.js";

export type JobHandler = (job: Job) => Promise<Prisma.InputJsonValue>;

export class JobExecutor {
  private readonly handlers = new Map<JobType, JobHandler>();

  register(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await jobService.failJob(job.id, `No handler registered for ${job.type}.`);
      return;
    }

    const started = Date.now();
    try {
      const result = await handler(job);
      await jobService.succeedJob(job.id, result);
      logger.info({ jobId: job.id, projectId: job.projectId, jobType: job.type, status: "SUCCEEDED", duration: Date.now() - started }, "job completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job error";
      await jobService.retryJob(job.id, message);
      logger.error({ jobId: job.id, projectId: job.projectId, jobType: job.type, status: "FAILED", duration: Date.now() - started, error: message }, "job failed");
    }
  }
}

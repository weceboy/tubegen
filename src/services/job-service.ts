import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { ConflictError, JobError, NotFoundError } from "../api/errors.js";

export interface EnqueueJobInput {
  projectId?: string;
  type: JobType;
  payload: Prisma.InputJsonValue;
  priority?: number;
  maxAttempts?: number;
  scheduledAt?: Date;
  idempotencyKey?: string;
}

export class JobService {
  async enqueueJob(input: EnqueueJobInput) {
    if (input.idempotencyKey) {
      const existing = await prisma.job.findFirst({
        where: {
          projectId: input.projectId,
          type: input.type,
          payload: { path: ["idempotencyKey"], equals: input.idempotencyKey },
        },
      });
      if (existing) return existing;
    }

    const payload = input.idempotencyKey
      ? { ...(input.payload as Record<string, unknown>), idempotencyKey: input.idempotencyKey }
      : input.payload;

    return prisma.job.create({
      data: {
        projectId: input.projectId,
        type: input.type,
        payload: payload as Prisma.InputJsonValue,
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 3,
        scheduledAt: input.scheduledAt,
      },
    });
  }

  async claimJob(): Promise<Awaited<ReturnType<typeof prisma.job.findUnique>> | null> {
    const now = new Date();
    const candidate = await prisma.job.findFirst({
      where: { status: JobStatus.QUEUED, OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, status: JobStatus.QUEUED },
      data: { status: JobStatus.RUNNING, startedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return prisma.job.findUnique({ where: { id: candidate.id } });
  }

  async succeedJob(jobId: string, result: Prisma.InputJsonValue) {
    const updated = await prisma.job.updateMany({
      where: { id: jobId, status: JobStatus.RUNNING },
      data: { status: JobStatus.SUCCEEDED, result, finishedAt: new Date(), errorMessage: null },
    });
    if (updated.count !== 1) throw new JobError(`Job ${jobId} is not running.`);
    return prisma.job.findUnique({ where: { id: jobId } });
  }

  async retryJob(jobId: string, errorMessage: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundError(`Job ${jobId} not found.`);
    if (job.status !== JobStatus.RUNNING) return job;

    const nextStatus = job.attempts < job.maxAttempts ? JobStatus.QUEUED : JobStatus.FAILED;
    return prisma.job.update({
      where: { id: jobId },
      data: { status: nextStatus, errorMessage, finishedAt: nextStatus === JobStatus.FAILED ? new Date() : null },
    });
  }

  async failJob(jobId: string, errorMessage: string) {
    const job = await this.retryJob(jobId, errorMessage);
    if (job.status !== JobStatus.FAILED) {
      return prisma.job.update({ where: { id: jobId }, data: { status: JobStatus.FAILED, finishedAt: new Date() } });
    }
    return job;
  }

  async cancelJob(jobId: string) {
    const result = await prisma.job.updateMany({
      where: { id: jobId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      data: { status: JobStatus.CANCELLED, finishedAt: new Date() },
    });
    if (result.count !== 1) throw new ConflictError(`Job ${jobId} cannot be cancelled.`);
    return prisma.job.findUnique({ where: { id: jobId } });
  }
}

export const jobService = new JobService();

import { JobType, Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { jobService } from "../../services/job-service.js";

const enqueueSchema = z.object({
  type: z.nativeEnum(JobType),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().positive().max(20).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export async function jobRoutes(app: FastifyInstance) {
  app.get("/projects/:id/jobs", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const jobs = await prisma.job.findMany({ where: { projectId: params.id }, orderBy: { createdAt: "desc" } });
    return { data: jobs };
  });

  app.post("/projects/:id/jobs", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = enqueueSchema.parse(request.body);
    const job = await jobService.enqueueJob({
      projectId: params.id,
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      priority: input.priority,
      maxAttempts: input.maxAttempts,
      idempotencyKey: input.idempotencyKey,
    });
    return reply.code(202).send({ projectId: params.id, jobId: job.id, status: job.status });
  });

  app.post("/jobs/:id/cancel", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return { data: await jobService.cancelJob(params.id) };
  });
}

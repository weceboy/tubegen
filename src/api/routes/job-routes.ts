import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { jobService } from "../../services/job-service.js";

export async function jobRoutes(app: FastifyInstance) {
  app.get("/projects/:id/jobs", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const jobs = await prisma.job.findMany({ where: { projectId: params.id }, orderBy: { createdAt: "desc" } });
    return { data: jobs };
  });

  app.post("/jobs/:id/cancel", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return { data: await jobService.cancelJob(params.id) };
  });
}

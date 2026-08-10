import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JobType, ApprovalStatus, PublicationStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { jobService } from "../../services/job-service.js";

const projectIdParams = z.object({ id: z.string().min(1) });

export async function pipelineRoutes(app: FastifyInstance) {
  app.post("/projects/:id/pipeline/start", async (request, reply) => {
    const { id } = projectIdParams.parse(request.params);
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Project not found." } });
    const job = await jobService.enqueueJob({ projectId: id, type: JobType.RESEARCH, payload: { projectId: id }, idempotencyKey: `pipeline:${id}:research` });
    await prisma.project.update({ where: { id }, data: { status: "RESEARCHING", currentStage: "RESEARCH" } });
    return reply.code(202).send({ data: { jobId: job.id, status: job.status, stage: "RESEARCH" } });
  });

  app.post("/projects/:id/approve", async (request, reply) => {
    const { id } = projectIdParams.parse(request.params);
    const body = z.object({ userId: z.string().min(1), stage: z.string().min(1), artifactId: z.string().optional(), comment: z.string().optional() }).parse(request.body);
    const approval = await prisma.approval.create({ data: { projectId: id, userId: body.userId, stage: body.stage, artifactId: body.artifactId, status: ApprovalStatus.APPROVED, comment: body.comment, decidedAt: new Date() } });
    if (body.stage === "FINAL_VIDEO" || body.stage === "PUBLICATION") await prisma.project.update({ where: { id }, data: { status: "READY", currentStage: "PUBLISHING" } });
    return reply.code(201).send({ data: approval });
  });

  app.post("/projects/:id/reject", async (request, reply) => {
    const { id } = projectIdParams.parse(request.params);
    const body = z.object({ userId: z.string().min(1), stage: z.string().min(1), artifactId: z.string().optional(), comment: z.string().optional() }).parse(request.body);
    const approval = await prisma.approval.create({ data: { projectId: id, userId: body.userId, stage: body.stage, artifactId: body.artifactId, status: ApprovalStatus.REJECTED, comment: body.comment, decidedAt: new Date() } });
    await prisma.project.update({ where: { id }, data: { status: "REVIEW", currentStage: body.stage } });
    return reply.code(201).send({ data: approval });
  });

  app.post("/projects/:id/publish", async (request, reply) => {
    const { id } = projectIdParams.parse(request.params);
    const body = z.object({ userId: z.string().min(1), title: z.string().min(1), description: z.string().optional(), visibility: z.string().default("private") }).parse(request.body);
    const approved = await prisma.approval.findFirst({ where: { projectId: id, userId: body.userId, stage: "PUBLICATION", status: ApprovalStatus.APPROVED }, orderBy: { decidedAt: "desc" } });
    if (!approved) return reply.code(409).send({ error: { code: "APPROVAL_REQUIRED", message: "Publication approval is required." } });
    const render = await prisma.render.findFirst({ where: { projectId: id, status: "SUCCEEDED" }, orderBy: { version: "desc" } });
    if (!render?.storageKey) return reply.code(409).send({ error: { code: "RENDER_REQUIRED", message: "A successful render is required." } });
    const channel = await prisma.project.findUniqueOrThrow({ where: { id }, include: { channel: true } });
    const publication = await prisma.publication.create({ data: { projectId: id, channelId: channel.channelId, title: body.title, visibility: body.visibility, status: PublicationStatus.PROCESSING, responseData: { provider: "mock-youtube" } } });
    const job = await jobService.enqueueJob({ projectId: id, type: JobType.YOUTUBE_UPLOAD, payload: { projectId: id, publicationId: publication.id, renderId: render.id, title: body.title, description: body.description, visibility: body.visibility }, idempotencyKey: `publication:${publication.id}` });
    return reply.code(202).send({ data: { publicationId: publication.id, jobId: job.id } });
  });
}

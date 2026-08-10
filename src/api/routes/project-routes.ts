import { ProjectStatus } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { projectService } from "../../services/project-service.js";

const createSchema = z.object({
  channelId: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(200),
  topic: z.string().min(1).max(1000),
  targetLanguage: z.string().min(2).max(10).optional(),
  targetDurationSec: z.number().int().positive().optional(),
  budgetCents: z.number().int().nonnegative().optional(),
});

const updateSchema = createSchema.partial().omit({ channelId: true, ownerId: true });
const transitionSchema = z.object({ status: z.nativeEnum(ProjectStatus) });

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async (request) => {
    const query = z.object({ ownerId: z.string().min(1).optional() }).parse(request.query);
    return { data: await projectService.list(query.ownerId) };
  });

  app.post("/projects", async (request, reply) => {
    const input = createSchema.parse(request.body);
    const project = await projectService.create(input);
    return reply.code(201).send({ data: project });
  });

  app.get("/projects/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return { data: await projectService.get(params.id) };
  });

  app.patch("/projects/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    return { data: await projectService.update(params.id, updateSchema.parse(request.body)) };
  });

  app.delete("/projects/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await projectService.remove(params.id);
    return reply.code(204).send();
  });

  app.post("/projects/:id/transition", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = transitionSchema.parse(request.body);
    return { data: await projectService.transition(params.id, input.status) };
  });
}

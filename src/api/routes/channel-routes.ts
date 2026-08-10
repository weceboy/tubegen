import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { NotFoundError } from "../errors.js";

const createSchema = z.object({
  ownerId: z.string().min(1),
  name: z.string().min(1).max(200),
  handle: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  language: z.string().min(2).max(10).optional(),
  niche: z.string().max(200).optional(),
});

export async function channelRoutes(app: FastifyInstance) {
  app.get("/channels", async (request) => {
    const query = z.object({ ownerId: z.string().min(1).optional() }).parse(request.query);
    return { data: await prisma.channel.findMany({ where: query.ownerId ? { ownerId: query.ownerId } : undefined, orderBy: { createdAt: "desc" } }) };
  });

  app.post("/channels", async (request, reply) => {
    const input = createSchema.parse(request.body);
    const channel = await prisma.channel.create({ data: input });
    return reply.code(201).send({ data: channel });
  });

  app.get("/channels/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const channel = await prisma.channel.findUnique({ where: { id: params.id } });
    if (!channel) throw new NotFoundError(`Channel ${params.id} not found.`);
    return { data: channel };
  });

  app.patch("/channels/:id", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = createSchema.partial().omit({ ownerId: true }).parse(request.body);
    const exists = await prisma.channel.findUnique({ where: { id: params.id } });
    if (!exists) throw new NotFoundError(`Channel ${params.id} not found.`);
    return { data: await prisma.channel.update({ where: { id: params.id }, data: input }) };
  });

  app.delete("/channels/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const exists = await prisma.channel.findUnique({ where: { id: params.id } });
    if (!exists) throw new NotFoundError(`Channel ${params.id} not found.`);
    await prisma.channel.delete({ where: { id: params.id } });
    return reply.code(204).send();
  });
}

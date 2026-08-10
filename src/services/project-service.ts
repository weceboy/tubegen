import { ProjectStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { NotFoundError } from "../api/errors.js";
import { pipelineService } from "../domain/pipeline/pipeline-service.js";

export interface CreateProjectInput {
  channelId: string;
  ownerId: string;
  name: string;
  topic: string;
  targetLanguage?: string;
  targetDurationSec?: number;
  budgetCents?: number;
}

export class ProjectService {
  async create(input: CreateProjectInput) {
    return prisma.project.create({
      data: {
        channelId: input.channelId,
        ownerId: input.ownerId,
        name: input.name,
        topic: input.topic,
        targetLanguage: input.targetLanguage ?? "en",
        targetDurationSec: input.targetDurationSec,
        budgetCents: input.budgetCents,
      },
    });
  }

  async list(ownerId?: string) {
    return prisma.project.findMany({
      where: ownerId ? { ownerId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string) {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError(`Project ${id} not found.`);
    return project;
  }

  async update(id: string, input: { name?: string; topic?: string; targetLanguage?: string; targetDurationSec?: number; budgetCents?: number }) {
    await this.get(id);
    return prisma.project.update({ where: { id }, data: input });
  }

  async remove(id: string) {
    await this.get(id);
    await prisma.project.delete({ where: { id } });
  }

  async transition(id: string, to: ProjectStatus) {
    const project = await this.get(id);
    pipelineService.assertTransition(project.status, to);
    return prisma.project.update({
      where: { id },
      data: { status: to, currentStage: to },
    });
  }
}

export const projectService = new ProjectService();

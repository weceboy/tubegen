import { JobType, Prisma, PublicationStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { jobService } from "../services/job-service.js";
import { pipelineService } from "../services/pipeline-service.js";
import { MockLLMProvider, MockResearchProvider } from "../providers/mock/mock-providers.js";
import { MockPublishingProvider, MockVoiceProvider } from "../providers/mock/media-providers.js";

const llm = new MockLLMProvider();
const researchProvider = new MockResearchProvider();
const voiceProvider = new MockVoiceProvider();
const publishingProvider = new MockPublishingProvider();

type Job = Awaited<ReturnType<typeof prisma.job.findUnique>>;
function projectIdOf(job: Job) { if (!job?.projectId) throw new Error(`Job ${job?.id ?? "unknown"} has no project.`); return job.projectId; }

export async function handleJob(job: NonNullable<Job>) {
  const projectId = projectIdOf(job);
  const payload = (job.payload ?? {}) as Record<string, any>;
  switch (job.type) {
    case JobType.RESEARCH: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      const sources = await researchProvider.search(project.topic); const retrieved = await Promise.all(sources.map((s) => researchProvider.retrieve(s.url)));
      return pipelineService.research(projectId, { ...(await researchProvider.analyze({ topic: project.topic, sources: retrieved })), sources: retrieved });
    }
    case JobType.GENERATE_BRIEF: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { research: true } });
      const generated = await llm.generateStructuredOutput<any>({ prompt: `Create a concise YouTube content brief for ${project.topic}. Research: ${JSON.stringify(project.research)}`, schema: {} }); const o = generated.output;
      return pipelineService.brief(projectId, { title: o.title ?? project.topic, hook: o.hook ?? `What you need to know about ${project.topic}`, promise: o.promise ?? `A clear explanation of ${project.topic}`, audience: o.audience ?? "general viewers", structure: o.structure ?? { sections: ["Hook", "Context", "Key points", "Conclusion"] } });
    }
    case JobType.GENERATE_SCRIPT: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { contentBrief: true } });
      const generated = await llm.generateText({ prompt: `Write a YouTube script for ${project.topic}. Brief: ${JSON.stringify(project.contentBrief)}`, language: project.targetLanguage });
      return pipelineService.script(projectId, { title: project.contentBrief?.title ?? project.topic, language: project.targetLanguage, body: generated.text, targetDurationSec: project.targetDurationSec ?? undefined });
    }
    case JobType.BREAKDOWN_SCENES: {
      const script = await prisma.script.findUniqueOrThrow({ where: { id: payload.scriptId } }); const chunks = script.body.split(/(?<=[.!?])\s+/).filter(Boolean);
      const scenes = (chunks.length ? chunks : [script.body]).map((narration, i) => ({ sceneNumber: i + 1, title: `Scene ${i + 1}`, narration, durationMs: Math.max(2000, Math.ceil(narration.split(/\s+/).length * 450)), imagePrompt: `Cinematic visual illustrating: ${narration.slice(0, 300)}`, videoPrompt: `Subtle motion for: ${narration.slice(0, 300)}`, motionPrompt: `Text emphasis for scene ${i + 1}` }));
      return pipelineService.scenes(projectId, script.id, scenes);
    }
    case JobType.GENERATE_VOICEOVER: { const script = await prisma.script.findFirstOrThrow({ where: { projectId }, orderBy: { version: "desc" } }); const generated = await voiceProvider.synthesize({ text: script.body, language: script.language }); return pipelineService.voiceover(projectId, generated.transcript, generated.durationMs, generated.audioStorageKey); }
    case JobType.GENERATE_VISUAL: return pipelineService.visuals(projectId);
    case JobType.BUILD_TIMELINE: return pipelineService.timeline(projectId);
    case JobType.RENDER: {
      const result = await pipelineService.render(projectId, payload.timelineId);
      return jobService.enqueueJob({ projectId, type: JobType.QA, payload: { projectId, renderId: result.id }, idempotencyKey: `pipeline:${projectId}:qa:${result.id}` });
    }
    case JobType.GENERATE_THUMBNAIL: { const version = ((await prisma.thumbnail.findFirst({ where: { projectId }, orderBy: { version: "desc" } }))?.version ?? 0) + 1; return prisma.thumbnail.create({ data: { projectId, version, status: "APPROVED", titleText: payload.title ?? "TubeGen" } }); }
    case JobType.GENERATE_METADATA: { const version = ((await prisma.videoMetadata.findFirst({ where: { projectId }, orderBy: { version: "desc" } }))?.version ?? 0) + 1; return prisma.videoMetadata.create({ data: { projectId, version, title: payload.title ?? "TubeGen Video", description: payload.description ?? "", tags: (payload.tags ?? []) as Prisma.InputJsonValue, status: "APPROVED" } }); }
    case JobType.QA: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { scenes: true, renders: { orderBy: { version: "desc" }, take: 1 } } });
      const passed = project.scenes.length > 0 && project.renders.length > 0 && project.renders[0].status === "SUCCEEDED";
      if (!passed) { await prisma.project.update({ where: { id: projectId }, data: { status: "FAILED", currentStage: "QA" } }); return { passed, checks: { hasScenes: project.scenes.length > 0, hasRender: project.renders.length > 0, renderSucceeded: false } }; }
      await prisma.project.update({ where: { id: projectId }, data: { status: "READY", currentStage: "APPROVAL" } });
      const metadataJob = await jobService.enqueueJob({ projectId, type: JobType.GENERATE_METADATA, payload: { projectId }, idempotencyKey: `pipeline:${projectId}:metadata` });
      const thumbnailJob = await jobService.enqueueJob({ projectId, type: JobType.GENERATE_THUMBNAIL, payload: { projectId }, idempotencyKey: `pipeline:${projectId}:thumbnail` });
      return { passed: true, checks: { hasScenes: true, hasRender: true, renderSucceeded: true }, metadataJobId: metadataJob.id, thumbnailJobId: thumbnailJob.id };
    }
    case JobType.YOUTUBE_UPLOAD: {
      const publication = await prisma.publication.findUniqueOrThrow({ where: { id: payload.publicationId } });
      const render = await prisma.render.findUniqueOrThrow({ where: { id: payload.renderId } });
      const uploaded = await publishingProvider.upload({ title: payload.title, description: payload.description, storageKey: render.storageKey!, visibility: payload.visibility });
      return prisma.publication.update({ where: { id: publication.id }, data: { externalVideoId: uploaded.externalVideoId, status: PublicationStatus.PUBLISHED, publishedAt: new Date(), responseData: uploaded.responseData as Prisma.InputJsonValue } });
    }
    default: throw new Error(`No handler registered for ${job.type}`);
  }
}

export async function processOneJob() {
  const job = await jobService.claimJob(); if (!job) return false;
  try { await jobService.succeedJob(job.id, (await handleJob(job)) as Prisma.InputJsonValue); }
  catch (error) { await jobService.retryJob(job.id, error instanceof Error ? error.message : String(error)); }
  return true;
}

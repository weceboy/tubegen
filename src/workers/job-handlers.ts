import { JobType, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { jobService } from "../services/job-service.js";
import { pipelineService } from "../services/pipeline-service.js";
import { MockLLMProvider, MockResearchProvider } from "../providers/mock/mock-providers.js";
import { MockVoiceProvider } from "../providers/mock/media-providers.js";

const llm = new MockLLMProvider();
const researchProvider = new MockResearchProvider();
const voiceProvider = new MockVoiceProvider();

type Job = Awaited<ReturnType<typeof prisma.job.findUnique>>;

function projectIdOf(job: Job) {
  if (!job?.projectId) throw new Error(`Job ${job?.id ?? "unknown"} has no project.`);
  return job.projectId;
}

export async function handleJob(job: NonNullable<Job>) {
  const projectId = projectIdOf(job);
  const payload = (job.payload ?? {}) as Record<string, any>;
  switch (job.type) {
    case JobType.RESEARCH: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      const sources = await researchProvider.search(project.topic);
      const retrieved = await Promise.all(sources.map((s) => researchProvider.retrieve(s.url)));
      const analysis = await researchProvider.analyze({ topic: project.topic, sources: retrieved });
      return pipelineService.research(projectId, { ...analysis, sources: retrieved });
    }
    case JobType.GENERATE_BRIEF: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { research: true } });
      const generated = await llm.generateStructuredOutput<{ title: string; hook: string; promise: string; audience: string; structure: unknown }>({ prompt: `Create a concise YouTube content brief for ${project.topic}. Research: ${JSON.stringify(project.research)}`, schema: {} });
      const o = generated.output;
      return pipelineService.brief(projectId, { title: o.title ?? project.topic, hook: o.hook ?? `What you need to know about ${project.topic}`, promise: o.promise ?? `A clear explanation of ${project.topic}`, audience: o.audience ?? "general viewers", structure: o.structure ?? { sections: ["Hook", "Context", "Key points", "Conclusion"] } });
    }
    case JobType.GENERATE_SCRIPT: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { contentBrief: true } });
      const generated = await llm.generateText({ prompt: `Write a YouTube script for ${project.topic}. Brief: ${JSON.stringify(project.contentBrief)}`, language: project.targetLanguage });
      return pipelineService.script(projectId, { title: project.contentBrief?.title ?? project.topic, language: project.targetLanguage, body: generated.text, targetDurationSec: project.targetDurationSec ?? undefined });
    }
    case JobType.BREAKDOWN_SCENES: {
      const script = await prisma.script.findUniqueOrThrow({ where: { id: payload.scriptId } });
      const chunks = script.body.split(/(?<=[.!?])\s+/).filter(Boolean);
      const scenes = (chunks.length ? chunks : [script.body]).map((narration, i) => ({ sceneNumber: i + 1, title: `Scene ${i + 1}`, narration, durationMs: Math.max(2000, Math.ceil(narration.split(/\s+/).length * 450)), imagePrompt: `Cinematic visual illustrating: ${narration.slice(0, 300)}`, videoPrompt: `Subtle motion for: ${narration.slice(0, 300)}`, motionPrompt: `Text emphasis for scene ${i + 1}` }));
      return pipelineService.scenes(projectId, script.id, scenes);
    }
    case JobType.GENERATE_VOICEOVER: {
      const script = await prisma.script.findFirstOrThrow({ where: { projectId }, orderBy: { version: "desc" } });
      const generated = await voiceProvider.synthesize({ text: script.body, language: script.language });
      return pipelineService.voiceover(projectId, generated.transcript, generated.durationMs, generated.audioStorageKey);
    }
    case JobType.GENERATE_VISUAL:
      return pipelineService.visuals(projectId);
    case JobType.BUILD_TIMELINE:
      return pipelineService.timeline(projectId);
    case JobType.RENDER:
      return pipelineService.render(projectId, payload.timelineId);
    case JobType.GENERATE_THUMBNAIL: {
      const version = ((await prisma.thumbnail.findFirst({ where: { projectId }, orderBy: { version: "desc" } }))?.version ?? 0) + 1;
      return prisma.thumbnail.create({ data: { projectId, version, status: "APPROVED", titleText: payload.title ?? "TubeGen" } });
    }
    case JobType.GENERATE_METADATA: {
      const version = ((await prisma.videoMetadata.findFirst({ where: { projectId }, orderBy: { version: "desc" } }))?.version ?? 0) + 1;
      return prisma.videoMetadata.create({ data: { projectId, version, title: payload.title ?? "TubeGen Video", description: payload.description ?? "", tags: (payload.tags ?? []) as Prisma.InputJsonValue, status: "APPROVED" } });
    }
    case JobType.QA: {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { scenes: true, renders: { orderBy: { version: "desc" }, take: 1 } } });
      const passed = project.scenes.length > 0 && project.renders.length > 0 && project.renders[0].status === "SUCCEEDED";
      await prisma.project.update({ where: { id: projectId }, data: { status: passed ? "READY" : "FAILED", currentStage: passed ? "APPROVAL" : "QA" } });
      return { passed, checks: { hasScenes: project.scenes.length > 0, hasRender: project.renders.length > 0, renderSucceeded: project.renders[0]?.status === "SUCCEEDED" } };
    }
    case JobType.YOUTUBE_UPLOAD:
      throw new Error("Publishing is approval-gated; use the publication service endpoint.");
    default:
      throw new Error(`No handler registered for ${job.type}`);
  }
}

export async function processOneJob() {
  const job = await jobService.claimJob();
  if (!job) return false;
  try {
    const result = await handleJob(job);
    await jobService.succeedJob(job.id, result as Prisma.InputJsonValue);
  } catch (error) {
    await jobService.retryJob(job.id, error instanceof Error ? error.message : String(error));
  }
  return true;
}

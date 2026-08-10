import { JobType, Prisma } from "@prisma/client";
import { loadConfig } from "./config/env.js";
import { disconnectDatabase } from "./db/prisma.js";
import { jobService } from "./services/job-service.js";
import { JobExecutor } from "./jobs/job-executor.js";
import { MockLLMProvider } from "./providers/mock/mock-providers.js";
import { logger } from "./config/logger.js";

const config = loadConfig();
const executor = new JobExecutor();
const llm = new MockLLMProvider();

const mockResult = async (job: { type: JobType; payload: Prisma.JsonValue }): Promise<Prisma.InputJsonValue> => ({
  jobType: job.type,
  provider: "mock",
  result: job.payload,
});

for (const type of Object.values(JobType)) {
  executor.register(type, async (job) => {
    if (type === JobType.GENERATE_SCRIPT) {
      const prompt = typeof job.payload === "object" && job.payload !== null && "prompt" in job.payload
        ? String((job.payload as Record<string, unknown>).prompt)
        : "Generate a script";
      const response = await llm.generateText({ prompt });
      return { provider: "mock", model: response.model, text: response.text };
    }
    return mockResult(job);
  });
}

let stopping = false;

async function loop() {
  while (!stopping) {
    const job = await jobService.claimJob();
    if (job) {
      await executor.executeJob(job);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
  }
}

loop().catch(async (error) => {
  logger.error(error, "worker stopped unexpectedly");
  await disconnectDatabase();
  process.exit(1);
});

const shutdown = async () => {
  stopping = true;
  await disconnectDatabase();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

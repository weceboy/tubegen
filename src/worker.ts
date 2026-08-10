import { processOneJob } from "./workers/job-handlers.js";

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000);
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function run() {
  while (!stopping) {
    const processed = await processOneJob();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

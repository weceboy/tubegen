import { loadConfig } from "./config/env.js";
import { disconnectDatabase } from "./db/prisma.js";
import { processOneJob } from "./workers/job-handlers.js";
import { logger } from "./config/logger.js";

const config=loadConfig();
let stopping=false;
async function loop(){while(!stopping){const processed=await processOneJob();if(!processed)await new Promise(r=>setTimeout(r,config.WORKER_POLL_INTERVAL_MS));}}
loop().catch(async(error)=>{logger.error(error,"worker stopped unexpectedly");await disconnectDatabase();process.exit(1);});
const shutdown=async()=>{stopping=true;await disconnectDatabase();};
process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);

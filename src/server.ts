import { buildApp } from "./api/app.js";
import { loadConfig } from "./config/env.js";
import { disconnectDatabase } from "./db/prisma.js";

const config = loadConfig();
const app = buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await disconnectDatabase();
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await disconnectDatabase();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

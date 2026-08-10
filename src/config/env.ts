import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(source);
}

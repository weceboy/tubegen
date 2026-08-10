import Fastify from "fastify";
import { ZodError } from "zod";
import { prisma } from "../db/prisma.js";
import { logger } from "../config/logger.js";
import { AppError } from "./errors.js";
import { projectRoutes } from "./routes/project-routes.js";
import { jobRoutes } from "./routes/job-routes.js";
import { channelRoutes } from "./routes/channel-routes.js";
import { pipelineRoutes } from "./routes/pipeline-routes.js";
export function buildApp(){const app=Fastify({loggerInstance:logger});app.get("/health",async()=>({status:"ok",service:"tubegen-api"}));app.get("/health/db",async(_r,reply)=>{try{await prisma.$queryRaw`SELECT 1`;return{status:"ok",database:"reachable"};}catch{return reply.code(503).send({status:"error",database:"unreachable"});}});app.get("/health/workers",async()=>({status:"ok",workerModel:"database-backed"}));app.register(channelRoutes);app.register(projectRoutes);app.register(jobRoutes);app.register(pipelineRoutes);app.setErrorHandler((error,_request,reply)=>{if(error instanceof ZodError)return reply.code(400).send({error:{code:"VALIDATION_ERROR",message:"Request validation failed.",details:error.issues}});if(error instanceof AppError)return reply.code(error.statusCode).send({error:{code:error.code,message:error.message}});app.log.error(error);return reply.code(500).send({error:{code:"INTERNAL_ERROR",message:"Internal server error."}});});return app;}

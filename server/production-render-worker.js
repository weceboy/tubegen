import crypto from 'node:crypto';
import { db } from './db.js';
import { claimProductionRenderJob, processProductionRenderJob, recoverExpiredProductionRenderJobs } from './production-render-jobs.js';

const WORKER_ID = process.env.AUTODOC_RENDER_WORKER_ID || `render-${process.pid}-${crypto.randomUUID()}`;
const LEASE_MS = Number(process.env.AUTODOC_RENDER_LEASE_MS || 60_000);
const POLL_MS = Number(process.env.AUTODOC_RENDER_POLL_MS || 1_000);

function now() { return new Date().toISOString(); }

export function productionRenderWorkerSnapshot() {
  return { workerId: WORKER_ID, leaseMs: LEASE_MS, pollMs: POLL_MS };
}

function genericJobFor(renderJobId) {
  return db.prepare(`SELECT * FROM jobs WHERE job_type='production_render' AND json_extract(payload_json,'$.productionRenderJobId')=? LIMIT 1`).get(renderJobId);
}

function completeGenericJob(renderJobId) {
  const job = genericJobFor(renderJobId);
  if (!job) return false;
  return db.prepare(`UPDATE jobs SET status='completed',finished_at=?,error=NULL WHERE id=? AND status='running'`).run(now(), job.id).changes === 1;
}

function failGenericJob(renderJobId, error, retryable = true) {
  const job = genericJobFor(renderJobId);
  if (!job) return false;
  const nextStatus = retryable && job.attempt < job.max_attempts ? 'queued' : 'failed';
  return db.prepare(`UPDATE jobs SET status=?,finished_at=?,error=? WHERE id=? AND status='running'`).run(nextStatus, now(), String(error?.message || error), job.id).changes === 1;
}

function claimGenericJob(renderJobId) {
  const job = genericJobFor(renderJobId);
  if (!job) return false;
  return db.prepare(`UPDATE jobs SET status='running',attempt=attempt+1,started_at=?,error=NULL WHERE id=? AND status='queued'`).run(now(), job.id).changes === 1;
}

export async function runProductionRenderWorker({ renderer, once = false } = {}) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    recoverExpiredProductionRenderJobs();
    const renderJob = claimProductionRenderJob(WORKER_ID, { leaseMs: LEASE_MS });
    if (!renderJob) {
      if (once) return;
      setTimeout(tick, POLL_MS);
      return;
    }

    const genericClaimed = claimGenericJob(renderJob.id);
    if (!genericClaimed) {
      // The durable production job remains the source of truth. If its generic
      // queue mirror is unavailable, fail the render job rather than rendering
      // without a worker-visible queue record.
      db.prepare(`UPDATE production_render_jobs SET status='failed',worker_id=NULL,lease_expires_at=NULL,error=?,finished_at=? WHERE id=? AND status='running'`)
        .run('generic production job mirror is unavailable', now(), renderJob.id);
      if (once) return;
      return setImmediate(tick);
    }

    try {
      await processProductionRenderJob(renderJob, { renderer });
      completeGenericJob(renderJob.id);
    } catch (error) {
      const retryable = error?.code !== 'PRODUCTION_RENDER_PREFLIGHT_FAILED' && error?.code !== 'PRODUCTION_RENDER_PLAN_DRIFT';
      failGenericJob(renderJob.id, error, retryable);
    }

    if (!once) setImmediate(tick);
  };

  await tick();
  return () => { stopped = true; };
}

if (process.argv[1] && process.argv[1].endsWith('/server/production-render-worker.js')) {
  runProductionRenderWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

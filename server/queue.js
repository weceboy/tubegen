import crypto from 'node:crypto';
import { db, now, tx } from './db.js';

const PRIORITY_WEIGHT = { high: 4, normal: 2, low: 1 };
const DEFAULT_MAX_ATTEMPTS = 3;

export function jobIdempotencyKey({ projectId, stage, jobType, inputVersionIds = [], provider = null, parameters = {}, generationIndex = 0 }) {
  return crypto.createHash('sha256').update(JSON.stringify({ projectId, stage, jobType, inputVersionIds, provider, parameters, generationIndex })).digest('hex');
}

export function enqueueJob({ projectId, stage, jobType, priority = 'normal', payload = {}, maxAttempts = DEFAULT_MAX_ATTEMPTS, idempotencyKey }) {
  if (!projectId || !stage || !jobType) throw new Error('projectId, stage and jobType are required');
  const key = idempotencyKey || jobIdempotencyKey({ projectId, stage, jobType, parameters: payload });
  const existing = db.prepare('SELECT * FROM jobs WHERE idempotency_key=?').get(key);
  if (existing) return { job: existing, reused: true };
  const id = `job_${crypto.randomUUID()}`;
  const t = now();
  db.prepare(`INSERT INTO jobs(id,project_id,stage,job_type,priority,status,idempotency_key,attempt,max_attempts,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, stage, jobType, priority, 'queued', key, 0, maxAttempts, JSON.stringify(payload), t);
  return { job: db.prepare('SELECT * FROM jobs WHERE id=?').get(id), reused: false };
}

function queuedJobs() {
  return db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC").all();
}

export function claimNextJob({ reservedHighRatio = 0.2 } = {}) {
  const jobs = queuedJobs();
  if (!jobs.length) return null;

  const running = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='running'").get().n;
  const highQueued = jobs.filter(j => j.priority === 'high').length;
  const nonHighQueued = jobs.length - highQueued;
  const preferHigh = highQueued > 0 && (running === 0 || highQueued >= Math.ceil((running + 1) * reservedHighRatio));

  const ranked = [...jobs].sort((a, b) => {
    const ah = preferHigh && a.priority === 'high' ? 100 : 0;
    const bh = preferHigh && b.priority === 'high' ? 100 : 0;
    return (bh + PRIORITY_WEIGHT[b.priority]) - (ah + PRIORITY_WEIGHT[a.priority]) || a.created_at.localeCompare(b.created_at);
  });

  const selected = ranked[0];
  const t = now();
  const changed = db.prepare("UPDATE jobs SET status='running', attempt=attempt+1, started_at=? WHERE id=? AND status='queued'").run(t, selected.id);
  if (!changed.changes) return null;
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(selected.id);
}

export function completeJob(jobId) {
  const t = now();
  db.prepare("UPDATE jobs SET status='completed', finished_at=?, error=NULL WHERE id=? AND status='running'").run(t, jobId);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

export function failJob(jobId, errorMessage) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) throw new Error('Job not found');
  const t = now();
  const nextStatus = job.attempt < job.max_attempts ? 'queued' : 'failed';
  db.prepare('UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=?').run(nextStatus, String(errorMessage || 'Job failed'), nextStatus === 'failed' ? t : null, jobId);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

export function cancelJob(jobId) {
  db.prepare("UPDATE jobs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('queued','running')").run(now(), jobId);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

export function queueStats() {
  return db.prepare(`SELECT status, priority, COUNT(*) count FROM jobs GROUP BY status, priority ORDER BY status, priority`).all();
}

export function createWorker({ handlers = {}, pollMs = 500, maxConcurrent = 2, reservedHighRatio = 0.2 } = {}) {
  let stopped = false;
  const active = new Set();

  async function tick() {
    if (stopped) return;
    while (active.size < maxConcurrent) {
      const job = claimNextJob({ reservedHighRatio });
      if (!job) break;
      const handler = handlers[job.job_type];
      const run = (async () => {
        try {
          if (!handler) throw new Error(`No worker handler registered for ${job.job_type}`);
          await handler({ job, payload: JSON.parse(job.payload_json || '{}') });
          completeJob(job.id);
        } catch (err) {
          failJob(job.id, err?.message || err);
          console.error(`[AutoDoc worker] ${job.job_type}:`, err);
        }
      })().finally(() => active.delete(run));
      active.add(run);
    }
  }

  const timer = setInterval(tick, pollMs);
  tick();
  return {
    stop() { stopped = true; clearInterval(timer); },
    active,
    tick
  };
}

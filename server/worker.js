import crypto from 'node:crypto';
import { db, enqueueJob } from './db.js';
import { completeGenerationAttempt } from './domain.js';

const WORKER_ID = process.env.AUTODOC_WORKER_ID || `${process.pid}-${crypto.randomUUID()}`;
const LEASE_MS = Number(process.env.AUTODOC_WORKER_LEASE_MS || 60_000);
const POLL_MS = Number(process.env.AUTODOC_WORKER_POLL_MS || 1_000);
const DEFAULT_PROVIDER = process.env.AUTODOC_PROVIDER || 'mock';

function now() { return new Date().toISOString(); }

export class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', retryable = true, providerRequestId = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.providerRequestId = providerRequestId;
  }
}

export class ProviderRegistry {
  constructor(providers = {}) { this.providers = new Map(Object.entries(providers)); }
  register(name, provider) {
    if (!name?.trim()) throw new Error('Provider name is required');
    if (!provider || typeof provider.generateVisual !== 'function') throw new Error(`Invalid provider: ${name}`);
    this.providers.set(name, provider);
    return this;
  }
  get(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new ProviderError(`Provider not configured: ${name}`, { code: 'PROVIDER_NOT_CONFIGURED', retryable: false });
    return provider;
  }
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export const mockProvider = {
  name: 'mock',
  async generateVisual({ attempt }) {
    const checksum = fingerprint({
      attemptId: attempt.id,
      visualVersionId: attempt.visual_version_id,
      generationIndex: attempt.generation_index,
      provider: attempt.provider,
      model: attempt.model,
      parameters: attempt.parameters_json
    });
    return {
      providerRequestId: `mock_${checksum.slice(0, 24)}`,
      objectKey: `generated/${attempt.project_id}/${attempt.id}.png`,
      asset: { storageProvider: 'local', mimeType: 'image/png', checksum, width: 1024, height: 1024, createdBy: 'provider:mock' },
      license: { type: 'generated', status: 'verified', commercialUse: true, attributionRequired: false, verifiedBy: 'provider:mock' },
      costCents: 0
    };
  }
};

export function defaultProviderRegistry() { return new ProviderRegistry({ mock: mockProvider }); }

export function recoverExpiredJobs(at = now()) {
  const cutoff = new Date(new Date(at).getTime() - LEASE_MS).toISOString();
  return db.prepare(`UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, error='worker lease expired' WHERE status='running' AND started_at IS NOT NULL AND started_at < ?`).run(cutoff).changes;
}

export function claimNextJob() {
  return db.transaction(() => {
    const job = db.prepare(`SELECT * FROM jobs WHERE status='queued' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at ASC LIMIT 1`).get();
    if (!job) return null;
    const changed = db.prepare(`UPDATE jobs SET status='running', attempt=attempt+1, started_at=?, error=NULL WHERE id=? AND status='queued'`).run(now(), job.id);
    return changed.changes === 1 ? db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id) : null;
  })();
}

export function heartbeatJob(jobId) {
  return db.prepare(`UPDATE jobs SET started_at=? WHERE id=? AND status='running'`).run(now(), jobId).changes === 1;
}

export function completeJob(jobId, result = null) {
  const job = db.prepare("SELECT * FROM jobs WHERE id=? AND status='running'").get(jobId);
  if (!job) return false;
  const payload = result == null ? job.payload_json : JSON.stringify({ ...JSON.parse(job.payload_json || '{}'), result });
  return db.prepare("UPDATE jobs SET status='completed', payload_json=?, finished_at=? WHERE id=? AND status='running'").run(payload, now(), jobId).changes === 1;
}

export function failJob(jobId, error) {
  const job = db.prepare("SELECT * FROM jobs WHERE id=? AND status='running'").get(jobId);
  if (!job) return false;
  const retry = error?.retryable !== false && job.attempt < job.max_attempts;
  return db.prepare("UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=? AND status='running'").run(retry ? 'queued' : 'failed', String(error?.message || error), now(), jobId).changes === 1;
}

export function workerSnapshot() { return { workerId: WORKER_ID, leaseMs: LEASE_MS, pollMs: POLL_MS, provider: DEFAULT_PROVIDER }; }

export function reconcileVisualGenerationJobs() {
  const attempts = db.prepare(`SELECT ga.* FROM generation_attempts ga WHERE ga.status='queued' ORDER BY ga.created_at ASC`).all();
  let created = 0;
  for (const attempt of attempts) {
    const key = `visual-generation:${attempt.id}`;
    if (db.prepare('SELECT id FROM jobs WHERE idempotency_key=?').get(key)) continue;
    const projectId = db.prepare(`SELECT v.project_id FROM scene_visual_versions vv JOIN scene_visuals v ON v.id=vv.scene_visual_id WHERE vv.id=?`).get(attempt.visual_version_id)?.project_id;
    if (!projectId) continue;
    enqueueJob({ projectId, stage: 'visuals', jobType: 'visual_generation', payload: { attemptId: attempt.id }, idempotencyKey: key, maxAttempts: 3 });
    created += 1;
  }
  return created;
}

function loadAttempt(attemptId) {
  return db.prepare(`SELECT ga.*, vv.scene_visual_id, v.project_id FROM generation_attempts ga JOIN scene_visual_versions vv ON vv.id=ga.visual_version_id JOIN scene_visuals v ON v.id=vv.scene_visual_id WHERE ga.id=?`).get(attemptId);
}

export async function processVisualGenerationJob(job, { providers = defaultProviderRegistry(), heartbeat = () => true } = {}) {
  let payload;
  try { payload = JSON.parse(job.payload_json || '{}'); } catch { throw new ProviderError('Invalid visual generation job payload', { code: 'INVALID_JOB_PAYLOAD', retryable: false }); }
  const attempt = loadAttempt(payload.attemptId);
  if (!attempt) throw new ProviderError('Generation attempt not found', { code: 'ATTEMPT_NOT_FOUND', retryable: false });
  if (attempt.status === 'completed' && attempt.result_asset_id) return { skipped: true, attemptId: attempt.id, assetId: attempt.result_asset_id };

  db.prepare(`UPDATE generation_attempts SET status='running', started_at=? WHERE id=? AND status='queued'`).run(now(), attempt.id);
  const running = loadAttempt(attempt.id);
  try {
    const provider = providers.get(running.provider);
    const result = await provider.generateVisual({ attempt: running, heartbeat });
    if (!result?.objectKey) throw new ProviderError('Provider returned no objectKey', { code: 'INVALID_PROVIDER_RESULT', retryable: false, providerRequestId: result?.providerRequestId || null });
    const completed = completeGenerationAttempt({
      projectId: running.project_id,
      attemptId: running.id,
      objectKey: result.objectKey,
      asset: result.asset || {},
      license: result.license || {},
      providerRequestId: result.providerRequestId || null,
      costCents: result.costCents || 0
    });
    return { attemptId: running.id, assetId: completed.result_asset_id, providerRequestId: completed.provider_request_id };
  } catch (error) {
    const retryable = error?.retryable !== false;
    db.prepare(`UPDATE generation_attempts SET status=?, completed_at=? WHERE id=?`).run(retryable ? 'queued' : 'failed', retryable ? null : now(), running.id);
    throw error;
  }
}

export function startWorker(handler = null) {
  let stopped = false;
  const jobHandler = handler || ((job, context) => {
    if (job.job_type === 'visual_generation') return processVisualGenerationJob(job, context);
    throw new ProviderError(`Unsupported job type: ${job.job_type}`, { code: 'UNSUPPORTED_JOB_TYPE', retryable: false });
  });
  const tick = async () => {
    if (stopped) return;
    reconcileVisualGenerationJobs();
    recoverExpiredJobs();
    const job = claimNextJob();
    if (!job) return setTimeout(tick, POLL_MS);
    try {
      const result = await jobHandler(job, { heartbeat: () => heartbeatJob(job.id), providers: defaultProviderRegistry() });
      completeJob(job.id, result);
    } catch (error) {
      failJob(job.id, error);
    }
    setImmediate(tick);
  };
  tick();
  return () => { stopped = true; };
}

if (process.argv[1] && process.argv[1].endsWith('/server/worker.js')) startWorker();

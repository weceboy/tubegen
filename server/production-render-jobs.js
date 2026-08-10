import crypto from 'node:crypto';
import { db, now } from './db.js';
import { prepareProductionRender } from './production-render-control.js';
import { verifyProductionManifest } from './production-manifest.js';
import { buildRenderOutputAttestation, verifyRenderOutputAttestation } from './render-integrity.js';
import { sha256 } from './hash.js';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_render_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      snapshot_id TEXT NOT NULL REFERENCES production_snapshots(id) ON DELETE CASCADE,
      manifest_hash TEXT NOT NULL,
      plan_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
      worker_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      lease_expires_at TEXT,
      output_asset_id TEXT REFERENCES scene_assets(id),
      output_checksum TEXT,
      output_manifest_hash TEXT,
      output_lineage_hash TEXT,
      renderer_id TEXT,
      integrity_verified_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE(snapshot_id, plan_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_production_render_jobs_queue ON production_render_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_production_render_jobs_project ON production_render_jobs(project_id, created_at);
  `);

  const columns = db.prepare('PRAGMA table_info(production_render_jobs)').all().map((row) => row.name);
  const migrations = {
    output_checksum: 'TEXT',
    output_manifest_hash: 'TEXT',
    output_lineage_hash: 'TEXT',
    renderer_id: 'TEXT',
    integrity_verified_at: 'TEXT'
  };
  for (const [column, definition] of Object.entries(migrations)) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE production_render_jobs ADD COLUMN ${column} ${definition}`);
  }
}

ensureSchema();

function getRenderJob(projectId, jobId) {
  return db.prepare('SELECT * FROM production_render_jobs WHERE id=? AND project_id=?').get(jobId, projectId) || null;
}

export function enqueueProductionRender(projectId, snapshotId, { expectedManifestHash = null, createdBy = 'system', maxAttempts = 3 } = {}) {
  const prepared = prepareProductionRender(projectId, snapshotId, expectedManifestHash);
  const key = `production-render:${snapshotId}:${prepared.plan_hash}`;
  const existing = db.prepare('SELECT id FROM production_render_jobs WHERE snapshot_id=? AND plan_hash=?').get(snapshotId, prepared.plan_hash);
  if (existing) return { job: getRenderJob(projectId, existing.id), reused: true, plan: prepared.plan };

  const timestamp = now();
  const renderJobId = id('renderjob');
  const genericJobId = id('job');
  db.transaction(() => {
    db.prepare(`INSERT INTO production_render_jobs(id,project_id,snapshot_id,manifest_hash,plan_hash,status,max_attempts,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(renderJobId, projectId, snapshotId, prepared.plan.manifest_hash, prepared.plan_hash, 'queued', maxAttempts, timestamp);
    db.prepare(`INSERT INTO jobs(id,project_id,stage,job_type,priority,status,idempotency_key,attempt,max_attempts,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(genericJobId, projectId, 'production', 'production_render', 'high', 'queued', key, 0, maxAttempts, JSON.stringify({ productionRenderJobId: renderJobId }), timestamp);
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(id('audit'), projectId, 'production_render_queued', createdBy === 'system' ? 'system' : 'human', createdBy, JSON.stringify({ production_render_job_id: renderJobId, snapshot_id: snapshotId, manifest_hash: prepared.plan.manifest_hash, plan_hash: prepared.plan_hash }), timestamp);
  })();

  return { job: getRenderJob(projectId, renderJobId), reused: false, plan: prepared.plan };
}

export function getProductionRenderJob(projectId, jobId) { return getRenderJob(projectId, jobId); }

export function listProductionRenderJobs(projectId) {
  return db.prepare('SELECT * FROM production_render_jobs WHERE project_id=? ORDER BY created_at DESC').all(projectId);
}

export function claimProductionRenderJob(workerId, { leaseMs = 60_000 } = {}) {
  const timestamp = now();
  const lease = new Date(Date.now() + leaseMs).toISOString();
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM production_render_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`).get();
    if (!row) return null;
    const changed = db.prepare(`UPDATE production_render_jobs SET status='running',worker_id=?,attempt=attempt+1,lease_expires_at=?,started_at=?,error=NULL WHERE id=? AND status='queued'`).run(workerId, lease, timestamp, row.id);
    if (!changed.changes) return null;
    return db.prepare('SELECT * FROM production_render_jobs WHERE id=?').get(row.id);
  })();
}

export function heartbeatProductionRenderJob(projectId, jobId, workerId, { leaseMs = 60_000 } = {}) {
  const lease = new Date(Date.now() + leaseMs).toISOString();
  return db.prepare(`UPDATE production_render_jobs SET lease_expires_at=? WHERE id=? AND project_id=? AND worker_id=? AND status='running'`).run(lease, jobId, projectId, workerId).changes === 1;
}

export function recoverExpiredProductionRenderJobs(at = now()) {
  return db.prepare(`UPDATE production_render_jobs SET status='queued',worker_id=NULL,lease_expires_at=NULL,started_at=NULL,error='worker lease expired' WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`).run(at).changes;
}

export function failProductionRenderJob(projectId, jobId, error, { retryable = true } = {}) {
  const job = getRenderJob(projectId, jobId);
  if (!job) throw new Error('Production render job not found');
  const canRetry = retryable && job.attempt < job.max_attempts;
  const status = canRetry ? 'queued' : 'failed';
  db.prepare(`UPDATE production_render_jobs SET status=?,worker_id=NULL,lease_expires_at=NULL,error=?,finished_at=? WHERE id=? AND project_id=? AND status='running'`).run(status, String(error?.message || error), now(), jobId, projectId);
  return getRenderJob(projectId, jobId);
}

function createOutputAsset(projectId, jobId, output) {
  const assetId = id('asset');
  db.prepare(`INSERT INTO scene_assets(id,project_id,source_type,object_key,bucket,storage_provider,checksum,mime_type,size,width,height,duration_ms,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(assetId, projectId, 'render', output.objectKey, output.bucket || null, output.storageProvider || 'local', output.checksum || null, output.mimeType || 'video/mp4', output.size ?? null, output.width ?? null, output.height ?? null, output.durationMs ?? null, now(), `production-render:${jobId}`);
  return assetId;
}

export const mockProductionRenderer = {
  async render({ plan, job }) {
    return {
      objectKey: `renders/${plan.project_id}/${job.id}.mp4`,
      storageProvider: 'local',
      mimeType: 'video/mp4',
      checksum: sha256({ plan_hash: plan.plan_hash, job_id: job.id }),
      size: 0,
      durationMs: null,
      rendererId: 'mock-v36'
    };
  }
};

export async function processProductionRenderJob(job, { renderer = mockProductionRenderer, heartbeat = () => true } = {}) {
  const projectId = job.project_id;
  const current = getRenderJob(projectId, job.id);
  if (!current) throw new Error('Production render job not found');
  if (current.status !== 'running') throw new Error('Production render job is not running');

  const verification = verifyProductionManifest(projectId, current.snapshot_id, current.manifest_hash);
  if (!verification.ok) {
    const error = new Error('Production render preflight failed during execution');
    error.code = 'PRODUCTION_RENDER_PREFLIGHT_FAILED';
    error.details = verification;
    failProductionRenderJob(projectId, current.id, error, { retryable: false });
    throw error;
  }

  const prepared = prepareProductionRender(projectId, current.snapshot_id, current.manifest_hash);
  if (prepared.plan_hash !== current.plan_hash) {
    const error = new Error('Production render plan changed after enqueue');
    error.code = 'PRODUCTION_RENDER_PLAN_DRIFT';
    failProductionRenderJob(projectId, current.id, error, { retryable: false });
    throw error;
  }

  heartbeat();
  const output = await renderer.render({ plan: prepared.plan, job: current, heartbeat });
  let lineage;
  try {
    lineage = assertProductionRenderJobLineage(projectId, current.id);
  } catch (error) {
    failProductionRenderJob(projectId, current.id, error, { retryable: false });
    throw error;
  }
  let attestation;
  try {
    attestation = buildRenderOutputAttestation({ job: current, plan: prepared.plan, output, lineage: lineage.lineage_hash });
  } catch (error) {
    error.code = 'INVALID_RENDER_OUTPUT';
    failProductionRenderJob(projectId, current.id, error, { retryable: false });
    throw error;
  }
  const integrity = verifyRenderOutputAttestation(current, output, attestation);
  if (!integrity.ok) {
    const error = new Error(`Production render integrity verification failed: ${integrity.reason}`);
    error.code = 'PRODUCTION_RENDER_INTEGRITY_FAILED';
    failProductionRenderJob(projectId, current.id, error, { retryable: false });
    throw error;
  }

  const assetId = createOutputAsset(projectId, current.id, output);
  const finishedAt = now();
  db.transaction(() => {
    db.prepare(`UPDATE production_render_jobs SET status='completed',worker_id=NULL,lease_expires_at=NULL,output_asset_id=?,output_checksum=?,output_manifest_hash=?,output_lineage_hash=?,renderer_id=?,integrity_verified_at=?,finished_at=?,error=NULL WHERE id=? AND project_id=? AND status='running'`).run(assetId, attestation.outputChecksum, attestation.outputManifestHash, attestation.outputLineageHash, attestation.rendererId, attestation.verifiedAt, finishedAt, current.id, projectId);
    db.prepare(`UPDATE jobs SET status='completed',finished_at=?,error=NULL WHERE job_type='production_render' AND json_extract(payload_json,'$.productionRenderJobId')=?`).run(finishedAt, current.id);
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'production_render_completed', 'system', current.worker_id || 'worker', JSON.stringify({ production_render_job_id: current.id, snapshot_id: current.snapshot_id, manifest_hash: current.manifest_hash, plan_hash: current.plan_hash, output_asset_id: assetId, output_checksum: attestation.outputChecksum, output_manifest_hash: attestation.outputManifestHash, output_lineage_hash: attestation.outputLineageHash, renderer_id: attestation.rendererId }), finishedAt);
  })();

  return getRenderJob(projectId, current.id);
}

export function assertProductionRenderJobLineage(projectId, jobId) {
  const job = getRenderJob(projectId, jobId);
  if (!job) throw new Error('Production render job not found');
  const snapshot = db.prepare(`SELECT ps.id,ps.project_id,ps.snapshot_hash,psv.scene_id,psv.scene_visual_id,psv.scene_visual_version_id,psv.source_generation_attempt_id,psv.source_asset_id FROM production_snapshots ps JOIN production_snapshot_visuals psv ON psv.snapshot_id=ps.id WHERE ps.id=? AND ps.project_id=? ORDER BY psv.scene_id`).all(job.snapshot_id, projectId);
  return { job, snapshot, lineage_hash: sha256({ job_id: job.id, manifest_hash: job.manifest_hash, plan_hash: job.plan_hash, snapshot }) };
}

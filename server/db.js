import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { threadId } from 'node:worker_threads';

const root = path.resolve(process.cwd());
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const defaultDbPath = process.env.NODE_ENV === 'test'
  ? path.join(os.tmpdir(), `autodoc-test-${process.pid}-${threadId}.sqlite`)
  : path.join(dataDir, 'autodoc.sqlite');

export const db = new Database(process.env.AUTODOC_DB || defaultDbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(root, 'server', 'schema.sql'), 'utf8');
db.exec(schema);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

for (const table of [
  'research_artifacts', 'script_versions', 'scene_versions', 'voiceovers', 'timestamps',
  'scene_visual_versions', 'timelines', 'rough_cuts', 'fine_cuts'
]) addColumn(table, 'approval_mode', "TEXT NOT NULL DEFAULT 'human'");

for (const table of ['research_artifacts', 'script_versions', 'scene_versions', 'voiceovers', 'timestamps', 'scene_visual_versions', 'timelines', 'rough_cuts', 'fine_cuts']) {
  addColumn(table, 'risk_blocked', 'INTEGER NOT NULL DEFAULT 0');
}

addColumn('scene_visuals', 'selection_state', "TEXT NOT NULL DEFAULT 'candidate'");
addColumn('scene_visual_versions', 'source_asset_id', 'TEXT REFERENCES scene_assets(id)');
addColumn('generation_attempts', 'result_asset_id', 'TEXT REFERENCES scene_assets(id)');
addColumn('generation_attempts', 'created_at', 'TEXT');
addColumn('scene_assets', 'source_generation_attempt_id', 'TEXT');
addColumn('scene_assets', 'bucket', 'TEXT');
addColumn('scene_assets', 'storage_provider', "TEXT NOT NULL DEFAULT 'local'");
addColumn('scene_assets', 'checksum', 'TEXT');
addColumn('scene_assets', 'mime_type', 'TEXT');
addColumn('scene_assets', 'size', 'INTEGER');
addColumn('scene_assets', 'width', 'INTEGER');
addColumn('scene_assets', 'height', 'INTEGER');
addColumn('scene_assets', 'duration_ms', 'INTEGER');
addColumn('scene_assets', 'created_by', 'TEXT');

addColumn('research_artifacts', 'system_suggested_change_type', "TEXT NOT NULL DEFAULT 'content'");
addColumn('research_artifacts', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
addColumn('research_artifacts', 'internal_notes', "TEXT NOT NULL DEFAULT ''");
addColumn('research_sources', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
addColumn('research_sources', 'internal_notes', "TEXT NOT NULL DEFAULT ''");

addColumn('audit_events', 'linked_risk_override_id', 'TEXT REFERENCES risk_overrides(id)');

// Production persistence migrations. These run at DB bootstrap as well as
// being represented in schema.sql, so existing checkouts get the complete
// v3.5-v4.3 persistence layer without a database reset.
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

CREATE TABLE IF NOT EXISTS production_publishes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  render_job_id TEXT NOT NULL,
  output_asset_id TEXT NOT NULL,
  attestation_hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  UNIQUE(project_id, render_job_id)
);
CREATE INDEX IF NOT EXISTS idx_production_publishes_project ON production_publishes(project_id, published_at);

CREATE TABLE IF NOT EXISTS production_releases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  publish_id TEXT NOT NULL UNIQUE REFERENCES production_publishes(id),
  release_number INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  UNIQUE(project_id, release_number)
);
CREATE INDEX IF NOT EXISTS idx_production_releases_project ON production_releases(project_id, release_number DESC);

CREATE TABLE IF NOT EXISTS production_delivery_manifests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES production_releases(id) ON DELETE CASCADE,
  publish_id TEXT NOT NULL REFERENCES production_publishes(id) ON DELETE CASCADE,
  manifest_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, release_id)
);
CREATE INDEX IF NOT EXISTS idx_production_delivery_manifests_project
  ON production_delivery_manifests(project_id, created_at DESC);
`);

for (const [column, definition] of Object.entries({
  output_checksum: 'TEXT',
  output_manifest_hash: 'TEXT',
  output_lineage_hash: 'TEXT',
  renderer_id: 'TEXT',
  integrity_verified_at: 'TEXT'
})) addColumn('production_render_jobs', column, definition);

export function now() { return new Date().toISOString(); }
export function tx(fn) { return db.transaction(fn)(); }

export function enqueueJob({ projectId, stage, jobType, priority = 'normal', payload = {}, idempotencyKey, maxAttempts = 3 }) {
  const key = idempotencyKey || crypto.createHash('sha256').update(JSON.stringify({ projectId, stage, jobType, payload })).digest('hex');
  const existing = db.prepare('SELECT * FROM jobs WHERE idempotency_key=?').get(key);
  if (existing) return { job: existing, reused: true };
  const id = `job_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO jobs(id,project_id,stage,job_type,priority,status,idempotency_key,attempt,max_attempts,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, stage, jobType, priority, 'queued', key, 0, maxAttempts, JSON.stringify(payload), now());
  return { job: db.prepare('SELECT * FROM jobs WHERE id=?').get(id), reused: false };
}

export function claimNextJob(workerId = 'worker') {
  return tx(() => {
    const job = db.prepare(`SELECT * FROM jobs WHERE status='queued' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at LIMIT 1`).get();
    if (!job) return null;
    const started = now();
    const changed = db.prepare(`UPDATE jobs SET status='running',attempt=attempt+1,started_at=?,error=NULL WHERE id=? AND status='queued'`).run(started, job.id);
    if (!changed.changes) return null;
    return db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
  });
}

export function finishJob(jobId, { status = 'completed', error = null } = {}) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) throw new Error('Job not found');
  const retry = status === 'failed' && job.attempt < job.max_attempts;
  const finalStatus = retry ? 'queued' : status;
  db.prepare(`UPDATE jobs SET status=?,error=?,finished_at=? WHERE id=?`).run(finalStatus, error, now(), jobId);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

export function getJob(jobId) { return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId); }
export function listJobs(projectId) { return db.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC').all(projectId); }

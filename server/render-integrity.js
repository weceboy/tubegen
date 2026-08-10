import { db, now } from './db.js';
import { sha256 } from './hash.js';
import { assertObjectKeyInProjectNamespace } from './storage.js';

function hasRenderJobTable() {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_render_jobs'").get() !== undefined;
}

function ensureColumn(name, definition) {
  const columns = db.prepare('PRAGMA table_info(production_render_jobs)').all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE production_render_jobs ADD COLUMN ${name} ${definition}`);
  }
}

export function ensureRenderIntegritySchema() {
  // production-render-jobs.js owns creation of the base table. This helper is
  // intentionally safe to call before or after that module finishes loading.
  // In particular, render-integrity.js is imported by production-render-jobs.js,
  // so running ALTER TABLE at module evaluation time would otherwise race the
  // CREATE TABLE and produce SQLITE_ERROR on a fresh test database.
  if (!hasRenderJobTable()) return false;
  ensureColumn('output_checksum', 'TEXT');
  ensureColumn('output_manifest_hash', 'TEXT');
  ensureColumn('output_lineage_hash', 'TEXT');
  ensureColumn('renderer_id', 'TEXT');
  ensureColumn('integrity_verified_at', 'TEXT');
  return true;
}

export function buildRenderOutputAttestation({ job, plan, output, lineage }) {
  if (!output?.objectKey) throw new Error('Render output object key is required');
  if (!output?.checksum || !/^[a-f0-9]{64}$/i.test(output.checksum)) {
    throw new Error('Render output checksum must be a SHA-256 hex digest');
  }
  if (!output?.mimeType) throw new Error('Render output MIME type is required');
  if (!output.mimeType.startsWith('video/')) throw new Error('Production render output must be a video asset');
  if (!assertObjectKeyInProjectNamespace(output.objectKey, job.project_id)) {
    throw new Error('Render output object key is outside the project render namespace');
  }

  const lineageHash = sha256({
    project_id: job.project_id,
    snapshot_id: job.snapshot_id,
    manifest_hash: job.manifest_hash,
    plan_hash: job.plan_hash,
    lineage
  });
  const manifestHash = sha256({
    job_id: job.id,
    output_checksum: output.checksum.toLowerCase(),
    object_key: output.objectKey,
    mime_type: output.mimeType,
    size: output.size ?? null,
    duration_ms: output.durationMs ?? null,
    lineage_hash: lineageHash
  });

  return {
    outputChecksum: output.checksum.toLowerCase(),
    outputManifestHash: manifestHash,
    outputLineageHash: lineageHash,
    rendererId: output.rendererId || 'unknown',
    verifiedAt: now()
  };
}

export function verifyRenderOutputAttestation(job, output, attestation) {
  if (!attestation?.outputChecksum || attestation.outputChecksum !== String(output?.checksum || '').toLowerCase()) {
    return { ok: false, reason: 'output checksum mismatch' };
  }
  if (!attestation.outputManifestHash || !/^[a-f0-9]{64}$/i.test(attestation.outputManifestHash)) {
    return { ok: false, reason: 'missing output manifest hash' };
  }
  if (!attestation.outputLineageHash || !/^[a-f0-9]{64}$/i.test(attestation.outputLineageHash)) {
    return { ok: false, reason: 'missing output lineage hash' };
  }
  if (!assertObjectKeyInProjectNamespace(output?.objectKey, job.project_id)) {
    return { ok: false, reason: 'output object key outside project namespace' };
  }
  return { ok: true };
}

// v3.7: verify the persisted attestation without trusting the caller's
// previously returned job object. This catches database-level drift in the
// output asset or attestation columns before a downstream publish step.
export function verifyPersistedRenderOutput(projectId, jobId) {
  ensureRenderIntegritySchema();
  const job = db.prepare('SELECT * FROM production_render_jobs WHERE id=? AND project_id=?').get(jobId, projectId);
  if (!job) throw new Error('Production render job not found');
  if (job.status !== 'completed') return { ok: false, reason: 'render job is not completed' };
  if (!job.output_asset_id) return { ok: false, reason: 'completed render has no output asset' };

  const asset = db.prepare('SELECT * FROM scene_assets WHERE id=? AND project_id=?').get(job.output_asset_id, projectId);
  if (!asset) return { ok: false, reason: 'output asset is missing or outside project' };

  const expectedManifest = sha256({
    job_id: job.id,
    output_checksum: String(asset.checksum || '').toLowerCase(),
    object_key: asset.object_key,
    mime_type: asset.mime_type,
    size: asset.size ?? null,
    duration_ms: asset.duration_ms ?? null,
    lineage_hash: job.output_lineage_hash
  });
  const reasons = [];
  if (!/^[a-f0-9]{64}$/i.test(String(asset.checksum || ''))) reasons.push('stored asset checksum is not SHA-256');
  if (!assertObjectKeyInProjectNamespace(asset.object_key, projectId)) reasons.push('stored output is outside project namespace');
  if (!asset.mime_type?.startsWith('video/')) reasons.push('stored output is not a video asset');
  if (expectedManifest !== job.output_manifest_hash) reasons.push('stored output manifest hash does not match asset metadata');
  if (!job.output_lineage_hash || !/^[a-f0-9]{64}$/i.test(job.output_lineage_hash)) reasons.push('stored output lineage hash is invalid');
  if (!job.output_checksum || job.output_checksum !== String(asset.checksum || '').toLowerCase()) reasons.push('job checksum differs from asset checksum');

  return {
    ok: reasons.length === 0,
    reason: reasons[0] || null,
    reasons,
    job_id: job.id,
    output_asset_id: asset.id,
    output_checksum: asset.checksum,
    output_manifest_hash: job.output_manifest_hash,
    output_lineage_hash: job.output_lineage_hash,
    renderer_id: job.renderer_id,
    integrity_verified_at: job.integrity_verified_at
  };
}

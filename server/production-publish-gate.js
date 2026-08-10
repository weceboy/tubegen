import { db } from './db.js';
import { verifyProductionManifest } from './production-manifest.js';
import { prepareProductionRender } from './production-render-control.js';
import { verifyPersistedRenderOutput } from './render-integrity.js';

export function verifyProductionPublishGate(projectId, jobId) {
  const job = db.prepare('SELECT * FROM production_render_jobs WHERE id=? AND project_id=?').get(jobId, projectId);
  if (!job) return { ok: false, reason: 'production render job not found', code: 'RENDER_JOB_NOT_FOUND' };
  if (job.status !== 'completed') return { ok: false, reason: 'production render job is not completed', code: 'RENDER_NOT_COMPLETED' };

  const persisted = verifyPersistedRenderOutput(projectId, jobId);
  if (!persisted.ok) {
    return { ok: false, reason: `persisted render attestation failed: ${persisted.reason}`, code: 'RENDER_ATTESTATION_FAILED', persisted };
  }

  const manifest = verifyProductionManifest(projectId, job.snapshot_id, job.manifest_hash);
  if (!manifest.ok) {
    return { ok: false, reason: 'production snapshot manifest is no longer valid', code: 'SNAPSHOT_MANIFEST_INVALID', manifest };
  }

  const prepared = prepareProductionRender(projectId, job.snapshot_id, job.manifest_hash);
  if (prepared.plan_hash !== job.plan_hash) {
    return { ok: false, reason: 'production render plan has drifted since enqueue', code: 'RENDER_PLAN_DRIFT', expected: job.plan_hash, actual: prepared.plan_hash };
  }

  return {
    ok: true,
    project_id: projectId,
    job_id: job.id,
    snapshot_id: job.snapshot_id,
    output_asset_id: job.output_asset_id,
    manifest_hash: job.manifest_hash,
    plan_hash: job.plan_hash,
    output_checksum: persisted.output_checksum,
    output_manifest_hash: persisted.output_manifest_hash,
    output_lineage_hash: persisted.output_lineage_hash,
    renderer_id: persisted.renderer_id,
    integrity_verified_at: persisted.integrity_verified_at
  };
}

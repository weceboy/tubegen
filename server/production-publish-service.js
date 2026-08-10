import crypto from 'node:crypto';
import { db } from './db.js';
import { verifyPersistedRenderOutput } from './render-integrity.js';
import { verifyProductionPublishGate } from './production-publish-gate.js';
import { sha256 as hashPayload } from './hash.js';

export function publishProductionRender(projectId, jobId, { actorId = 'system' } = {}) {
  const gate = verifyProductionPublishGate(projectId, jobId);
  if (!gate.ok) throw new Error(`Production publish blocked: ${gate.reason}`);

  const integrity = verifyPersistedRenderOutput(projectId, jobId);
  if (!integrity.ok) throw new Error(`Production publish blocked: ${integrity.reason}`);

  const job = db.prepare('SELECT * FROM production_render_jobs WHERE id=? AND project_id=?').get(jobId, projectId);
  if (!job || job.status !== 'completed' || !job.output_asset_id) throw new Error('Production publish requires a completed render output');

  const existing = db.prepare('SELECT * FROM production_publishes WHERE project_id=? AND render_job_id=?').get(projectId, jobId);
  if (existing) return existing;

  const publishId = `publish_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const attestationHash = hashPayload({
    jobId,
    outputAssetId: job.output_asset_id,
    outputChecksum: job.output_checksum,
    outputManifestHash: job.output_manifest_hash,
    outputLineageHash: job.output_lineage_hash,
  });
  const metadata = JSON.stringify({ renderJobId: jobId, outputAssetId: job.output_asset_id, attestationHash });

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO production_publishes(id,project_id,render_job_id,output_asset_id,attestation_hash,published_by,published_at,status)
      VALUES(?,?,?,?,?,?,?,'published')`).run(
      publishId, projectId, jobId, job.output_asset_id, attestationHash, actorId, now
    );
    db.prepare(`INSERT INTO audit_events(id,project_id,actor_type,actor_id,event_type,entity_id,created_at,payload_json,metadata)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, 'human', actorId, 'production.publish', publishId, now, metadata, metadata
    );
  });
  tx();
  return db.prepare('SELECT * FROM production_publishes WHERE id=?').get(publishId);
}

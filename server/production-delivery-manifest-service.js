import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { verifyProductionRelease } from './production-release-service.js';
import { verifyProductionPublish } from './production-delivery-service.js';
import { sha256 as hash } from './hash.js';

const SCHEMA = 'production-delivery-manifest/v4.3';

function ensureDeliveryManifestTable() {
  db.exec(`
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
}

function getRelease(projectId, releaseId) {
  return db.prepare('SELECT * FROM production_releases WHERE id=? AND project_id=?').get(releaseId, projectId);
}

function buildPayload(projectId, release, publish) {
  const job = db.prepare('SELECT * FROM production_render_jobs WHERE id=? AND project_id=?').get(publish.render_job_id, projectId);
  if (!job) throw new Error('Production render job is missing');
  const asset = db.prepare('SELECT id,project_id,source_type,object_key,mime_type,checksum,size,duration_ms FROM scene_assets WHERE id=? AND project_id=?').get(publish.output_asset_id, projectId);
  if (!asset) throw new Error('Production output asset is missing');

  return {
    schema: SCHEMA,
    projectId,
    release: {
      id: release.id,
      number: release.release_number,
      status: release.status,
      manifestHash: release.manifest_hash,
    },
    publish: {
      id: publish.id,
      renderJobId: publish.render_job_id,
      outputAssetId: publish.output_asset_id,
      attestationHash: publish.attestation_hash,
    },
    render: {
      snapshotId: job.snapshot_id,
      manifestHash: job.manifest_hash,
      planHash: job.plan_hash,
      outputChecksum: job.output_checksum,
      outputManifestHash: job.output_manifest_hash,
      outputLineageHash: job.output_lineage_hash,
      rendererId: job.renderer_id,
      integrityVerifiedAt: job.integrity_verified_at,
    },
    asset,
  };
}

export function createProductionDeliveryManifest(projectId, releaseId, { actorId = 'system' } = {}) {
  ensureDeliveryManifestTable();
  const release = getRelease(projectId, releaseId);
  if (!release) throw new Error('Production release not found');
  const releaseVerification = verifyProductionRelease(projectId, releaseId);
  if (!releaseVerification.ok) throw new Error(`Production delivery manifest blocked: ${releaseVerification.reason}`);

  const publishVerification = verifyProductionPublish(projectId, release.publish_id);
  if (!publishVerification.ok) throw new Error(`Production delivery manifest blocked: ${publishVerification.reason}`);

  const existing = db.prepare('SELECT * FROM production_delivery_manifests WHERE project_id=? AND release_id=?').get(projectId, releaseId);
  if (existing) return existing;

  const payload = buildPayload(projectId, release, publishVerification.publish);
  const manifestHash = hash(payload);
  const id = `delivery_manifest_${crypto.randomUUID()}`;
  const createdAt = now();

  tx(() => {
    db.prepare(`INSERT INTO production_delivery_manifests
      (id,project_id,release_id,publish_id,manifest_hash,payload_json,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      id, projectId, releaseId, release.publish_id, manifestHash,
      JSON.stringify(payload), actorId, createdAt
    );
    db.prepare(`INSERT INTO audit_events
      (id,project_id,actor_type,actor_id,event_type,entity_id,created_at,payload_json,metadata)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, 'human', actorId,
      'production.delivery-manifest.created', id, createdAt,
      JSON.stringify({ releaseId, releaseNumber: release.release_number, manifestHash }),
      JSON.stringify({ releaseId, manifestHash })
    );
  });

  return db.prepare('SELECT * FROM production_delivery_manifests WHERE id=?').get(id);
}

export function verifyProductionDeliveryManifest(projectId, manifestId) {
  ensureDeliveryManifestTable();
  const manifest = db.prepare('SELECT * FROM production_delivery_manifests WHERE id=? AND project_id=?').get(manifestId, projectId);
  if (!manifest) return { ok: false, status: 'missing', reason: 'Production delivery manifest not found' };

  let payload;
  try {
    payload = JSON.parse(manifest.payload_json);
  } catch {
    return { ok: false, status: 'drifted', reason: 'Delivery manifest payload is invalid JSON', manifest };
  }

  if (hash(payload) !== manifest.manifest_hash) {
    return { ok: false, status: 'drifted', reason: 'Delivery manifest hash mismatch', manifest };
  }

  const releaseVerification = verifyProductionRelease(projectId, manifest.release_id);
  if (!releaseVerification.ok) {
    return { ok: false, status: releaseVerification.status === 'revoked' ? 'revoked' : 'drifted', reason: `Release verification failed: ${releaseVerification.reason}`, manifest };
  }

  const publishVerification = verifyProductionPublish(projectId, manifest.publish_id);
  if (!publishVerification.ok) {
    return { ok: false, status: 'drifted', reason: `Publish verification failed: ${publishVerification.reason}`, manifest };
  }

  if (manifest.payload_json !== JSON.stringify(buildPayload(projectId, releaseVerification.release, publishVerification.publish))) {
    return { ok: false, status: 'drifted', reason: 'Delivery manifest payload no longer matches persisted release and publish lineage', manifest };
  }

  return { ok: true, status: 'valid', manifest, payload };
}

export function listProductionDeliveryManifests(projectId) {
  ensureDeliveryManifestTable();
  return db.prepare('SELECT * FROM production_delivery_manifests WHERE project_id=? ORDER BY created_at DESC').all(projectId);
}

export function getProductionDeliveryManifest(projectId, manifestId) {
  ensureDeliveryManifestTable();
  return db.prepare('SELECT * FROM production_delivery_manifests WHERE id=? AND project_id=?').get(manifestId, projectId) || null;
}

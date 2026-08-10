import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { publishProductionRender } from './production-publish-service.js';
import { sha256 as sha } from './hash.js';

function ensureReleaseTables() {
  db.exec(`
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
  `);
}

export function createProductionRelease(projectId, renderJobId, { actorId = 'system' } = {}) {
  ensureReleaseTables();
  let publish = db.prepare('SELECT * FROM production_publishes WHERE project_id=? AND render_job_id=?').get(projectId, renderJobId);
  if (!publish) publish = publishProductionRender(projectId, renderJobId, { actorId });
  const existing = db.prepare('SELECT * FROM production_releases WHERE project_id=? AND publish_id=?').get(projectId, publish.id);
  if (existing) return existing;

  const previous = db.prepare('SELECT MAX(release_number) AS n FROM production_releases WHERE project_id=?').get(projectId)?.n || 0;
  const releaseNumber = previous + 1;
  const releaseId = `release_${crypto.randomUUID()}`;
  const createdAt = now();
  const manifest = {
    schema: 'production-release/v4.0',
    projectId,
    releaseNumber,
    publishId: publish.id,
    renderJobId,
    outputAssetId: publish.output_asset_id,
    attestationHash: publish.attestation_hash,
  };
  const manifestHash = sha(manifest);

  tx(() => {
    db.prepare(`INSERT INTO production_releases(id,project_id,publish_id,release_number,manifest_hash,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(releaseId, projectId, publish.id, releaseNumber, manifestHash, 'active', actorId, createdAt);
    db.prepare(`INSERT INTO audit_events(id,project_id,actor_id,event_type,entity_id,created_at,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId, 'production.release.created', releaseId, createdAt,
      JSON.stringify({ releaseNumber, publishId: publish.id, manifestHash })
    );
  });
  return db.prepare('SELECT * FROM production_releases WHERE id=?').get(releaseId);
}

export function revokeProductionRelease(projectId, releaseId, reason, { actorId = 'system' } = {}) {
  ensureReleaseTables();
  if (!reason || !String(reason).trim()) throw new Error('Release revocation requires a reason');
  const release = db.prepare('SELECT * FROM production_releases WHERE id=? AND project_id=?').get(releaseId, projectId);
  if (!release) throw new Error('Production release not found');
  if (release.status === 'revoked') return release;
  const revokedAt = now();
  tx(() => {
    db.prepare(`UPDATE production_releases SET status='revoked',revoked_at=?,revoked_by=?,revoke_reason=? WHERE id=? AND status='active'`)
      .run(revokedAt, actorId, String(reason).trim(), releaseId);
    db.prepare(`INSERT INTO audit_events(id,project_id,actor_id,event_type,entity_id,created_at,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId, 'production.release.revoked', releaseId, revokedAt,
      JSON.stringify({ reason: String(reason).trim(), manifestHash: release.manifest_hash })
    );
  });
  return db.prepare('SELECT * FROM production_releases WHERE id=?').get(releaseId);
}

export function verifyProductionRelease(projectId, releaseId) {
  ensureReleaseTables();
  const release = db.prepare('SELECT * FROM production_releases WHERE id=? AND project_id=?').get(releaseId, projectId);
  if (!release) return { ok: false, status: 'missing', reason: 'Production release not found' };
  if (release.status !== 'active') return { ok: false, status: release.status, reason: 'Production release is not active' };
  const publish = db.prepare('SELECT * FROM production_publishes WHERE id=? AND project_id=?').get(release.publish_id, projectId);
  if (!publish) return { ok: false, status: 'drifted', reason: 'Published record is missing' };
  const manifestHash = sha({
    schema: 'production-release/v4.0',
    projectId,
    releaseNumber: release.release_number,
    publishId: publish.id,
    renderJobId: publish.render_job_id,
    outputAssetId: publish.output_asset_id,
    attestationHash: publish.attestation_hash,
  });
  if (manifestHash !== release.manifest_hash) return { ok: false, status: 'drifted', reason: 'Release manifest hash mismatch' };
  return { ok: true, status: 'valid', release };
}

import { db } from './db.js';
import { verifyProductionRelease } from './production-release-service.js';

export function listProductionReleases(projectId) {
  db.exec(`CREATE TABLE IF NOT EXISTS production_releases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    publish_id TEXT NOT NULL UNIQUE,
    release_number INTEGER NOT NULL,
    manifest_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by TEXT,
    revoke_reason TEXT,
    UNIQUE(project_id, release_number)
  )`);
  return db.prepare('SELECT * FROM production_releases WHERE project_id=? ORDER BY release_number DESC').all(projectId);
}

export function getProductionReleaseStatus(projectId, releaseId) {
  return verifyProductionRelease(projectId, releaseId);
}

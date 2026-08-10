import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { verifyProductionRelease } from './production-release-service.js';

function ensurePromotionTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_release_channels (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      current_release_id TEXT REFERENCES production_releases(id),
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, channel)
    );
    CREATE TABLE IF NOT EXISTS production_release_transitions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      from_release_id TEXT REFERENCES production_releases(id),
      to_release_id TEXT REFERENCES production_releases(id),
      transition_type TEXT NOT NULL CHECK(transition_type IN ('promote','rollback')),
      actor_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_release_channels_project ON production_release_channels(project_id, channel);
    CREATE INDEX IF NOT EXISTS idx_release_transitions_project ON production_release_transitions(project_id, channel, created_at);
  `);
}

function getRelease(projectId, releaseId) {
  const release = db.prepare('SELECT * FROM production_releases WHERE id=? AND project_id=?').get(releaseId, projectId);
  if (!release) throw new Error('Production release not found');
  const verification = verifyProductionRelease(projectId, releaseId);
  if (!verification.ok) throw new Error(`Production release is not publishable: ${verification.reason}`);
  return release;
}

export function getProductionReleaseChannel(projectId, channel = 'production') {
  ensurePromotionTables();
  return db.prepare(`
    SELECT c.*, r.release_number, r.manifest_hash, r.status release_status
    FROM production_release_channels c
    LEFT JOIN production_releases r ON r.id=c.current_release_id
    WHERE c.project_id=? AND c.channel=?
  `).get(projectId, channel) || null;
}

export function promoteProductionRelease(projectId, releaseId, { channel = 'production', actorId = 'system', reason = null } = {}) {
  ensurePromotionTables();
  const release = getRelease(projectId, releaseId);
  const existing = getProductionReleaseChannel(projectId, channel);
  if (existing?.current_release_id === releaseId) return { channel: existing, reused: true };
  const channelId = existing?.id || `channel_${crypto.randomUUID()}`;
  const changedAt = now();
  tx(() => {
    if (existing) {
      db.prepare(`UPDATE production_release_channels SET current_release_id=?,updated_by=?,updated_at=? WHERE id=?`)
        .run(releaseId, actorId, changedAt, channelId);
    } else {
      db.prepare(`INSERT INTO production_release_channels(id,project_id,channel,current_release_id,updated_by,updated_at) VALUES(?,?,?,?,?,?)`)
        .run(channelId, projectId, channel, releaseId, actorId, changedAt);
    }
    db.prepare(`INSERT INTO production_release_transitions(id,project_id,channel,from_release_id,to_release_id,transition_type,actor_id,reason,created_at)
      VALUES(?,?,?,?,?,'promote',?,?,?)`).run(
      `transition_${crypto.randomUUID()}`, projectId, channel, existing?.current_release_id || null, release.id, actorId, reason, changedAt
    );
    db.prepare(`INSERT INTO audit_events(id,project_id,actor_id,event_type,entity_id,created_at,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId, 'production.release.promoted', release.id, changedAt,
      JSON.stringify({ channel, fromReleaseId: existing?.current_release_id || null, releaseId: release.id, reason })
    );
  });
  return { channel: getProductionReleaseChannel(projectId, channel), reused: false };
}

export function rollbackProductionRelease(projectId, { channel = 'production', targetReleaseId, actorId = 'system', reason } = {}) {
  ensurePromotionTables();
  if (!reason || !String(reason).trim()) throw new Error('Production rollback requires a reason');
  const current = getProductionReleaseChannel(projectId, channel);
  if (!current?.current_release_id) throw new Error('Production channel has no current release');
  if (!targetReleaseId) throw new Error('Production rollback requires a target release');
  if (targetReleaseId === current.current_release_id) return { channel: current, reused: true };
  const target = getRelease(projectId, targetReleaseId);
  const changedAt = now();
  tx(() => {
    db.prepare(`UPDATE production_release_channels SET current_release_id=?,updated_by=?,updated_at=? WHERE id=?`)
      .run(target.id, actorId, changedAt, current.id);
    db.prepare(`INSERT INTO production_release_transitions(id,project_id,channel,from_release_id,to_release_id,transition_type,actor_id,reason,created_at)
      VALUES(?,?,?,?,?,'rollback',?,?,?)`).run(
      `transition_${crypto.randomUUID()}`, projectId, channel, current.current_release_id, target.id, actorId, String(reason).trim(), changedAt
    );
    db.prepare(`INSERT INTO audit_events(id,project_id,actor_id,event_type,entity_id,created_at,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId, 'production.release.rollback', target.id, changedAt,
      JSON.stringify({ channel, fromReleaseId: current.current_release_id, targetReleaseId: target.id, reason: String(reason).trim() })
    );
  });
  return { channel: getProductionReleaseChannel(projectId, channel), reused: false };
}

export function listProductionReleaseTransitions(projectId, channel = 'production') {
  ensurePromotionTables();
  return db.prepare(`SELECT * FROM production_release_transitions WHERE project_id=? AND channel=? ORDER BY created_at DESC`).all(projectId, channel);
}

import crypto from 'node:crypto';
import { db } from './db.js';

const METADATA_FIELDS = new Set([
  'publisher',
  'title',
  'tags',
  'internal_notes',
  'source_title',
]);

export function classifyResearchChange(fields = []) {
  const normalized = fields.map((field) => String(field).trim().toLowerCase());
  if (!normalized.length) return 'metadata';
  if (normalized.includes('mixed')) return 'mixed';
  return normalized.every((field) => METADATA_FIELDS.has(field) || field === 'duplicate_source')
    ? 'metadata'
    : 'content';
}

export function applyResearchChangeType({ researchVersionId, requestedChangeType, actorId, reason } = {}) {
  if (!researchVersionId) throw new Error('researchVersionId is required');
  const version = db.prepare(`SELECT id, project_id, system_suggested_change_type, change_type FROM research_artifacts WHERE id=?`).get(researchVersionId);
  if (!version) throw new Error('research version not found');

  const requested = requestedChangeType || version.system_suggested_change_type;
  const suggested = version.system_suggested_change_type;

  if (suggested === 'mixed' && requested === 'metadata') {
    throw new Error('mixed changes cannot be downgraded to metadata');
  }
  if (suggested === 'content' && requested === 'metadata') {
    if (!reason || !String(reason).trim()) throw new Error('reason is required for content-to-metadata downgrade');
    if (!actorId) throw new Error('actorId is required for content-to-metadata downgrade');

    const auditId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare(`UPDATE research_artifacts SET change_type=? WHERE id=?`).run('metadata', researchVersionId);
      db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        auditId,
        version.project_id,
        'change_type_downgraded',
        'human',
        actorId,
        researchVersionId,
        JSON.stringify({ system_suggested_change_type: suggested, final_change_type: 'metadata', reason }),
        new Date().toISOString(),
      );
    })();
    return { ...version, change_type: 'metadata', audit_event_id: auditId };
  }

  if (requested === 'content' && suggested === 'metadata') {
    db.prepare(`UPDATE research_artifacts SET change_type=? WHERE id=?`).run('content', researchVersionId);
    return { ...version, change_type: 'content' };
  }

  if (!['metadata', 'content', 'mixed'].includes(requested)) throw new Error('invalid change_type');
  db.prepare(`UPDATE research_artifacts SET change_type=? WHERE id=?`).run(requested, researchVersionId);
  return { ...version, change_type: requested };
}

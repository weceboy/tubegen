/**
 * @deprecated This module is not imported anywhere else in the codebase
 * (server/index.js, tests, etc.) except createSceneVersion, which is the
 * only implementation of scene creation and is now wired into index.js.
 *
 * The rest of this file is dead code, kept for now rather than deleted:
 * - createNarrationSnapshot(projectId, sceneVersionIds) duplicates and is
 *   shadowed by the actually-used createNarrationSnapshot(projectId) in
 *   production-stages.js, which auto-derives current approved scenes
 *   instead of taking an explicit id list. Do not import this one.
 * - enqueueResearch/enqueueScript/enqueueSceneBreakdown enqueue job types
 *   ('research', 'script_risk_check', 'scene_breakdown') that have no
 *   registered worker handler anywhere and are never called.
 * Safe to delete once createSceneVersion is moved to its own module.
 */
import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { enqueueJob } from './queue.js';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

export function createSceneVersion(projectId, input, actorId = 'system') {
  const script = db.prepare('SELECT * FROM script_versions WHERE id=?').get(input.sourceScriptVersionId);
  if (!script || script.status !== 'approved') throw new Error('Approved source script is required');
  const scene = db.prepare('SELECT * FROM scenes WHERE project_id=? AND scene_number=?').get(projectId, input.sceneNumber);
  const sceneId = scene?.id || id('scene');
  const previous = scene ? db.prepare('SELECT * FROM scene_versions WHERE scene_id=? ORDER BY version_number DESC LIMIT 1').get(sceneId) : null;
  const version = (previous?.version_number || 0) + 1;
  const versionId = id('scenev');
  const t = now();
  tx(() => {
    if (!scene) db.prepare('INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)').run(sceneId, projectId, input.sceneNumber, t);
    if (previous) db.prepare("UPDATE scene_versions SET status='superseded' WHERE id=?").run(previous.id);
    db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,planned_duration_ms,image_prompt,motion_prompt,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'ready_for_review',?)`).run(versionId, sceneId, version, script.id, input.narrationSource || 'script', input.narrationText, input.plannedDurationMs ?? null, input.imagePrompt || null, input.motionPrompt || null, t);
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(id('audit'), projectId, 'scene_version_created', actorId === 'system' ? 'system' : 'human', actorId, versionId, JSON.stringify({ scene_number: input.sceneNumber }), t);
  });
  return db.prepare('SELECT * FROM scene_versions WHERE id=?').get(versionId);
}

export function createNarrationSnapshot(projectId, sceneVersionIds) {
  if (!sceneVersionIds?.length) throw new Error('At least one scene version is required');
  const snapshotId = id('narr');
  const t = now();
  tx(() => {
    db.prepare('INSERT INTO narration_snapshots(id,project_id,created_at) VALUES(?,?,?)').run(snapshotId, projectId, t);
    for (const sceneVersionId of sceneVersionIds) {
      const row = db.prepare(`SELECT s.id scene_id, sv.id scene_version_id, sv.narration_text FROM scene_versions sv JOIN scenes s ON s.id=sv.scene_id WHERE sv.id=? AND s.project_id=?`).get(sceneVersionId, projectId);
      if (!row) throw new Error(`Scene version not found: ${sceneVersionId}`);
      db.prepare(`INSERT INTO narration_snapshot_items(id,narration_snapshot_id,scene_id,scene_version_id,narration_text) VALUES(?,?,?,?,?)`).run(id('narritem'), snapshotId, row.scene_id, row.scene_version_id, row.narration_text);
    }
  });
  return db.prepare('SELECT * FROM narration_snapshots WHERE id=?').get(snapshotId);
}

export function enqueueResearch(projectId, payload = {}, priority = 'normal') {
  return enqueueJob({ projectId, stage: 'research', jobType: 'research', priority, idempotencyKey: hash({ projectId, stage: 'research', payload }), payload });
}

export function enqueueScript(projectId, scriptVersionId, priority = 'normal') {
  return enqueueJob({ projectId, stage: 'script', jobType: 'script_risk_check', priority, idempotencyKey: hash({ projectId, stage: 'script', scriptVersionId }), payload: { scriptVersionId } });
}

export function enqueueSceneBreakdown(projectId, scriptVersionId, priority = 'normal') {
  return enqueueJob({ projectId, stage: 'scenes', jobType: 'scene_breakdown', priority, idempotencyKey: hash({ projectId, stage: 'scenes', scriptVersionId }), payload: { scriptVersionId } });
}

function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

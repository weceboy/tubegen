import crypto from 'node:crypto';
import { db, now, tx } from './db.js';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function latestApprovedScenes(projectId) {
  return db.prepare(`
    SELECT s.id scene_id, sv.id scene_version_id, sv.version_number, sv.narration_text
    FROM scenes s
    JOIN scene_versions sv ON sv.scene_id = s.id
    WHERE s.project_id = ?
      AND sv.status = 'approved'
      AND sv.version_number = (SELECT MAX(x.version_number) FROM scene_versions x WHERE x.scene_id = s.id)
    ORDER BY s.scene_number
  `).all(projectId);
}

export function createNarrationSnapshot(projectId) {
  const scenes = latestApprovedScenes(projectId);
  if (!scenes.length) throw new Error('Approved scene versions are required before creating a narration snapshot');
  const snapshotId = id('narration');
  const t = now();
  tx(() => {
    db.prepare('INSERT INTO narration_snapshots(id,project_id,created_at) VALUES(?,?,?)').run(snapshotId, projectId, t);
    const insert = db.prepare(`INSERT INTO narration_snapshot_items
      (id,narration_snapshot_id,scene_id,scene_version_id,narration_text) VALUES(?,?,?,?,?)`);
    for (const scene of scenes) insert.run(id('narration_item'), snapshotId, scene.scene_id, scene.scene_version_id, scene.narration_text);
  });
  return db.prepare('SELECT * FROM narration_snapshots WHERE id=?').get(snapshotId);
}

export function createVoiceoverVersion(projectId, { narrationSnapshotId, voiceModel, objectKey = null, durationMs = null }) {
  const snapshot = db.prepare('SELECT * FROM narration_snapshots WHERE id=? AND project_id=?').get(narrationSnapshotId, projectId);
  if (!snapshot) throw new Error('Narration snapshot not found for project');
  if (!voiceModel?.trim()) throw new Error('voiceModel is required');
  const count = db.prepare('SELECT COALESCE(MAX(version_number),0) n FROM voiceovers WHERE project_id=?').get(projectId).n;
  const voiceoverId = id('voice');
  const t = now();
  tx(() => {
    db.prepare(`UPDATE voiceovers SET status='superseded' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
    db.prepare(`INSERT INTO voiceovers
      (id,project_id,version_number,narration_snapshot_id,voice_model,object_key,duration_ms,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(voiceoverId, projectId, count + 1, narrationSnapshotId, voiceModel, objectKey || '', durationMs, 'ready_for_review', t);
  });
  return db.prepare('SELECT * FROM voiceovers WHERE id=?').get(voiceoverId);
}

export function createTimestampVersion(projectId, { voiceoverId, mappings = [] }) {
  const voiceover = db.prepare(`SELECT * FROM voiceovers WHERE id=? AND project_id=?`).get(voiceoverId, projectId);
  if (!voiceover) throw new Error('Voiceover not found for project');
  if (voiceover.status !== 'approved') throw new Error('Approved voiceover is required before timestamps');
  if (!mappings.length) throw new Error('At least one scene timestamp mapping is required');

  const scenes = new Map(db.prepare(`SELECT s.id scene_id, sv.id scene_version_id
    FROM scenes s JOIN scene_versions sv ON sv.scene_id=s.id
    WHERE s.project_id=? AND sv.status='approved'
      AND sv.version_number=(SELECT MAX(x.version_number) FROM scene_versions x WHERE x.scene_id=s.id)`).all(projectId).map(x => [x.scene_id, x.scene_version_id]));
  for (const m of mappings) {
    if (!scenes.has(m.sceneId)) throw new Error(`Scene is not current and approved: ${m.sceneId}`);
    if (!Number.isInteger(m.startMs) || !Number.isInteger(m.endMs) || m.startMs < 0 || m.endMs <= m.startMs) throw new Error('Invalid timestamp range');
  }
  const ordered = [...mappings].sort((a,b) => a.startMs - b.startMs);
  for (let i = 1; i < ordered.length; i++) if (ordered[i].startMs < ordered[i - 1].endMs) throw new Error('Timestamp mappings overlap');

  const version = db.prepare('SELECT COALESCE(MAX(version_number),0) n FROM timestamps WHERE project_id=?').get(projectId).n + 1;
  const timestampId = id('timestamps');
  const t = now();
  tx(() => {
    db.prepare(`UPDATE timestamps SET status='superseded' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
    db.prepare(`INSERT INTO timestamps(id,project_id,version_number,source_voiceover_id,status,created_at)
      VALUES(?,?,?,?,?,?)`).run(timestampId, projectId, version, voiceoverId, 'ready_for_review', t);
    const insert = db.prepare(`INSERT INTO timestamp_scene_mappings
      (id,timestamp_id,scene_id,scene_version_id,start_ms,end_ms,confidence) VALUES(?,?,?,?,?,?,?)`);
    for (const m of mappings) insert.run(id('mapping'), timestampId, m.sceneId, scenes.get(m.sceneId), m.startMs, m.endMs, m.confidence ?? null);
  });
  return db.prepare('SELECT * FROM timestamps WHERE id=?').get(timestampId);
}

export function updateTimestampMapping(timestampId, sceneId, patch) {
  const mapping = db.prepare('SELECT * FROM timestamp_scene_mappings WHERE timestamp_id=? AND scene_id=?').get(timestampId, sceneId);
  if (!mapping) throw new Error('Timestamp mapping not found');
  const startMs = patch.startMs ?? mapping.start_ms;
  const endMs = patch.endMs ?? mapping.end_ms;
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) throw new Error('Invalid timestamp range');
  db.prepare(`UPDATE timestamp_scene_mappings SET start_ms=?, end_ms=?, confidence=? WHERE id=?`)
    .run(startMs, endMs, patch.confidence ?? mapping.confidence, mapping.id);
  db.prepare(`UPDATE timestamps SET status='ready_for_review', approved_at=NULL WHERE id=? AND status='approved'`).run(timestampId);
  return db.prepare('SELECT * FROM timestamp_scene_mappings WHERE id=?').get(mapping.id);
}

export function getTimestampDetails(timestampId) {
  const timestamp = db.prepare('SELECT * FROM timestamps WHERE id=?').get(timestampId);
  if (!timestamp) return null;
  return {
    timestamp,
    mappings: db.prepare(`SELECT m.*, s.scene_number FROM timestamp_scene_mappings m
      JOIN scenes s ON s.id=m.scene_id WHERE m.timestamp_id=? ORDER BY m.start_ms`).all(timestampId)
  };
}

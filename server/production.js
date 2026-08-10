import crypto from 'node:crypto';
import { db, now, tx } from './db.js';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function latestVoiceover(projectId) {
  return db.prepare('SELECT * FROM voiceovers WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

export function createVoiceover(projectId, { narrationSnapshotId, voiceModel = 'default', objectKey = '', durationMs = null }) {
  const snapshot = db.prepare('SELECT * FROM narration_snapshots WHERE id=? AND project_id=?').get(narrationSnapshotId, projectId);
  if (!snapshot) throw new Error('Narration snapshot not found');
  const previous = latestVoiceover(projectId);
  const version = (previous?.version_number || 0) + 1;
  const voiceoverId = id('voice');
  const t = now();
  tx(() => {
    if (previous && previous.status !== 'superseded') db.prepare("UPDATE voiceovers SET status='superseded' WHERE id=?").run(previous.id);
    db.prepare(`INSERT INTO voiceovers(id,project_id,version_number,narration_snapshot_id,voice_model,object_key,duration_ms,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(voiceoverId, projectId, version, narrationSnapshotId, voiceModel, objectKey, durationMs, 'ready_for_review', t);
  });
  return db.prepare('SELECT * FROM voiceovers WHERE id=?').get(voiceoverId);
}

export function createTimestampArtifact(projectId, { voiceoverId, mappings = [] }) {
  const voiceover = db.prepare('SELECT * FROM voiceovers WHERE id=? AND project_id=?').get(voiceoverId, projectId);
  if (!voiceover) throw new Error('Voiceover not found');
  if (voiceover.status !== 'approved') throw new Error('Approved voiceover is required before timestamps');
  const previous = db.prepare('SELECT * FROM timestamps WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
  const version = (previous?.version_number || 0) + 1;
  const timestampId = id('timestamp');
  const t = now();
  tx(() => {
    if (previous && previous.status !== 'superseded') db.prepare("UPDATE timestamps SET status='superseded' WHERE id=?").run(previous.id);
    db.prepare(`INSERT INTO timestamps(id,project_id,version_number,source_voiceover_id,status,created_at)
      VALUES(?,?,?,?,?,?)`).run(timestampId, projectId, version, voiceoverId, 'ready_for_review', t);
    for (const mapping of mappings) {
      const scene = db.prepare('SELECT * FROM scene_versions WHERE id=? AND status=\'approved\'').get(mapping.sceneVersionId);
      if (!scene) throw new Error(`Approved scene version not found: ${mapping.sceneVersionId}`);
      if (!Number.isInteger(mapping.startMs) || !Number.isInteger(mapping.endMs) || mapping.startMs < 0 || mapping.endMs <= mapping.startMs) throw new Error('Invalid timestamp range');
      db.prepare(`INSERT INTO timestamp_scene_mappings(id,timestamp_id,scene_id,scene_version_id,start_ms,end_ms,confidence)
        VALUES(?,?,?,?,?,?,?)`).run(id('mapping'), timestampId, scene.scene_id, scene.id, mapping.startMs, mapping.endMs, mapping.confidence ?? null);
    }
  });
  return db.prepare('SELECT * FROM timestamps WHERE id=?').get(timestampId);
}

export function updateTimestampMappings(timestampId, mappings) {
  const timestamp = db.prepare('SELECT * FROM timestamps WHERE id=?').get(timestampId);
  if (!timestamp) throw new Error('Timestamp artifact not found');
  if (!['draft','ready_for_review'].includes(timestamp.status)) throw new Error('Only draft/review timestamps can be edited');
  tx(() => {
    db.prepare('DELETE FROM timestamp_scene_mappings WHERE timestamp_id=?').run(timestampId);
    for (const mapping of mappings) {
      const scene = db.prepare('SELECT * FROM scene_versions WHERE id=? AND status=\'approved\'').get(mapping.sceneVersionId);
      if (!scene) throw new Error(`Approved scene version not found: ${mapping.sceneVersionId}`);
      if (mapping.startMs < 0 || mapping.endMs <= mapping.startMs) throw new Error('Invalid timestamp range');
      db.prepare(`INSERT INTO timestamp_scene_mappings(id,timestamp_id,scene_id,scene_version_id,start_ms,end_ms,confidence)
        VALUES(?,?,?,?,?,?,?)`).run(id('mapping'), timestampId, scene.scene_id, scene.id, mapping.startMs, mapping.endMs, mapping.confidence ?? null);
    }
    db.prepare("UPDATE timestamps SET status='ready_for_review', approved_at=NULL WHERE id=?").run(timestampId);
  });
  return db.prepare('SELECT * FROM timestamps WHERE id=?').get(timestampId);
}

export function timestampDetails(timestampId) {
  const timestamp = db.prepare('SELECT * FROM timestamps WHERE id=?').get(timestampId);
  if (!timestamp) return null;
  const mappings = db.prepare(`SELECT m.*, s.scene_number, sv.narration_text FROM timestamp_scene_mappings m
    JOIN scenes s ON s.id=m.scene_id JOIN scene_versions sv ON sv.id=m.scene_version_id
    WHERE m.timestamp_id=? ORDER BY m.start_ms`).all(timestampId);
  return { timestamp, mappings };
}

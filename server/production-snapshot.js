import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { canonical } from './hash.js';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function ensureSnapshotColumns() {
  const columns = db.prepare('PRAGMA table_info(production_snapshots)').all().map((row) => row.name);
  if (!columns.includes('snapshot_hash')) db.exec('ALTER TABLE production_snapshots ADD COLUMN snapshot_hash TEXT');
  if (!columns.includes('status')) db.exec("ALTER TABLE production_snapshots ADD COLUMN status TEXT NOT NULL DEFAULT 'valid'");
  if (!columns.includes('verified_at')) db.exec('ALTER TABLE production_snapshots ADD COLUMN verified_at TEXT');
}

ensureSnapshotColumns();

function currentVisualRows(projectId) {
  return db.prepare(`
    SELECT
      v.scene_id,
      v.id AS scene_visual_id,
      v.selection_state,
      vv.id AS scene_visual_version_id,
      vv.version_number,
      vv.source_scene_version_id,
      vv.source_asset_id,
      vv.status AS version_status,
      vv.risk_blocked,
      a.source_type,
      a.source_generation_attempt_id,
      a.object_key,
      a.checksum,
      a.mime_type,
      a.size,
      l.license_status
    FROM scene_visuals v
    JOIN scene_visual_versions vv ON vv.scene_visual_id = v.id
      AND vv.version_number = (
        SELECT MAX(x.version_number)
        FROM scene_visual_versions x
        WHERE x.scene_visual_id = v.id
      )
    LEFT JOIN scene_assets a ON a.id = vv.source_asset_id
    LEFT JOIN asset_licenses l ON l.asset_id = a.id
    WHERE v.project_id = ?
      AND v.selection_state = 'selected'
      AND v.deleted_at IS NULL
    ORDER BY v.scene_id
  `).all(projectId);
}

function currentScenes(projectId) {
  return db.prepare(`
    SELECT s.id AS scene_id, sv.id AS scene_version_id, sv.version_number
    FROM scenes s
    JOIN scene_versions sv ON sv.scene_id = s.id
      AND sv.version_number = (
        SELECT MAX(x.version_number)
        FROM scene_versions x
        WHERE x.scene_id = s.id
      )
    WHERE s.project_id = ?
    ORDER BY s.scene_number
  `).all(projectId);
}

function gate(projectId) {
  const scenes = currentScenes(projectId);
  const visuals = currentVisualRows(projectId);
  const byScene = new Map(visuals.map((row) => [row.scene_id, row]));
  const errors = [];

  if (!scenes.length) errors.push({ code: 'scenes_missing', message: 'At least one current scene is required' });

  for (const scene of scenes) {
    const visual = byScene.get(scene.scene_id);
    if (!visual) {
      errors.push({ code: 'visual_selection_missing', message: 'Every current scene needs a selected visual', sceneId: scene.scene_id });
      continue;
    }
    if (visual.version_status !== 'approved') errors.push({ code: 'visual_not_approved', message: 'Selected visual version must be approved', sceneId: scene.scene_id, visualVersionId: visual.scene_visual_version_id });
    if (visual.source_scene_version_id !== scene.scene_version_id) errors.push({ code: 'visual_stale', message: 'Selected visual references an old scene version', sceneId: scene.scene_id, visualVersionId: visual.scene_visual_version_id });
    if (!visual.source_asset_id) errors.push({ code: 'visual_asset_missing', message: 'Selected visual version has no source asset', sceneId: scene.scene_id, visualVersionId: visual.scene_visual_version_id });
    if (visual.license_status !== 'verified') errors.push({ code: 'license_not_verified', message: 'Selected visual asset must have a verified license', sceneId: scene.scene_id, assetId: visual.source_asset_id });
    if (!visual.object_key) errors.push({ code: 'asset_object_missing', message: 'Selected visual asset has no retrievable object key', sceneId: scene.scene_id, assetId: visual.source_asset_id });
    if (visual.risk_blocked) errors.push({ code: 'visual_risk_blocked', message: 'Selected visual has an active risk block', sceneId: scene.scene_id, visualVersionId: visual.scene_visual_version_id });
  }

  return { scenes, visuals, errors };
}

function snapshotSources(gateResult) {
  const visualSelections = gateResult.scenes.map((scene) => {
    const visual = gateResult.visuals.find((row) => row.scene_id === scene.scene_id);
    return {
      scene_id: scene.scene_id,
      scene_visual_id: visual.scene_visual_id,
      scene_visual_version_id: visual.scene_visual_version_id,
      source_generation_attempt_id: visual.source_generation_attempt_id || null,
      source_asset_id: visual.source_asset_id
    };
  });
  return { visual_selections: visualSelections };
}

function snapshotHash(sources) {
  return crypto.createHash('sha256').update(canonical(sources)).digest('hex');
}

function selectionDiff(expectedSelections, currentSelections) {
  const expected = new Map(expectedSelections.map((row) => [row.scene_id, row]));
  const current = new Map(currentSelections.map((row) => [row.scene_id, row]));
  const sceneIds = [...new Set([...expected.keys(), ...current.keys()])].sort();
  return sceneIds.flatMap((sceneId) => {
    const before = expected.get(sceneId) || null;
    const after = current.get(sceneId) || null;
    if (canonical(before) === canonical(after)) return [];
    return [{ scene_id: sceneId, expected: before, current: after }];
  });
}

export function inspectProductionSnapshot(projectId) {
  const project = db.prepare('SELECT id FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');
  const checked = gate(projectId);
  const sources = checked.errors.length ? { visual_selections: [] } : snapshotSources(checked);
  return { ok: checked.errors.length === 0, errors: checked.errors, sources, snapshot_hash: snapshotHash(sources) };
}

export function createPersistedProductionSnapshot(projectId, { createdBy = 'system' } = {}) {
  const inspected = inspectProductionSnapshot(projectId);
  if (!inspected.ok) {
    const error = new Error('Production snapshot gate failed');
    error.code = 'SNAPSHOT_GATE_FAILED';
    error.details = inspected.errors;
    throw error;
  }

  const snapshotId = id('snapshot');
  const timestamp = now();
  tx(() => {
    db.prepare(`INSERT INTO production_snapshots(id,project_id,created_at,created_by,snapshot_hash,status,verified_at) VALUES(?,?,?,?,?,?,?)`)
      .run(snapshotId, projectId, timestamp, createdBy, inspected.snapshot_hash, 'valid', timestamp);
    for (const item of inspected.sources.visual_selections) {
      db.prepare(`INSERT INTO production_snapshot_visuals(id,snapshot_id,scene_id,scene_visual_id,scene_visual_version_id,source_generation_attempt_id,source_asset_id) VALUES(?,?,?,?,?,?,?)`)
        .run(id('snapshotv'), snapshotId, item.scene_id, item.scene_visual_id, item.scene_visual_version_id, item.source_generation_attempt_id, item.source_asset_id);
    }
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(id('audit'), projectId, 'production_snapshot_created', createdBy === 'system' ? 'system' : 'human', createdBy, JSON.stringify({ snapshot_id: snapshotId, snapshot_hash: inspected.snapshot_hash }), timestamp);
  });

  return getPersistedProductionSnapshot(projectId, snapshotId);
}

/**
 * Like createPersistedProductionSnapshot, but reuses the most recent
 * snapshot instead of creating a duplicate row when nothing has changed
 * since it was taken. "Nothing changed" is verified, not assumed: the most
 * recent snapshot's hash must match the hash of the current selection, and
 * it must still pass verification (not drifted).
 */
export function getOrCreatePersistedProductionSnapshot(projectId, { createdBy = 'system' } = {}) {
  const inspected = inspectProductionSnapshot(projectId);
  if (!inspected.ok) {
    const error = new Error('Production snapshot gate failed');
    error.code = 'SNAPSHOT_GATE_FAILED';
    error.details = inspected.errors;
    throw error;
  }

  const [mostRecent] = listPersistedProductionSnapshots(projectId);
  if (mostRecent && mostRecent.snapshot_hash === inspected.snapshot_hash) {
    const verification = verifyPersistedProductionSnapshot(projectId, mostRecent.id);
    if (verification.status === 'valid') return getPersistedProductionSnapshot(projectId, mostRecent.id);
  }

  return createPersistedProductionSnapshot(projectId, { createdBy });
}

export function getPersistedProductionSnapshot(projectId, snapshotId) {
  const snapshot = db.prepare(`SELECT * FROM production_snapshots WHERE id=? AND project_id=?`).get(snapshotId, projectId);
  if (!snapshot) return null;
  const visualSelections = db.prepare(`SELECT scene_id,scene_visual_id,scene_visual_version_id,source_generation_attempt_id,source_asset_id FROM production_snapshot_visuals WHERE snapshot_id=? ORDER BY scene_id`).all(snapshotId);
  return { ...snapshot, snapshot_hash: snapshot.snapshot_hash || snapshotHash({ visual_selections: visualSelections }), visual_selections: visualSelections };
}

export function listPersistedProductionSnapshots(projectId) {
  return db.prepare(`SELECT id,project_id,created_at,created_by,snapshot_hash,status,verified_at FROM production_snapshots WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
}

export function verifyPersistedProductionSnapshot(projectId, snapshotId) {
  const snapshot = getPersistedProductionSnapshot(projectId, snapshotId);
  if (!snapshot) throw new Error('Production snapshot not found');

  const expected = snapshotHash({ visual_selections: snapshot.visual_selections });
  const current = inspectProductionSnapshot(projectId);
  const sameHash = expected === snapshot.snapshot_hash;
  const currentSelectionDiff = selectionDiff(snapshot.visual_selections, current.sources.visual_selections);
  const sameCurrentSelection = current.ok && currentSelectionDiff.length === 0;
  const status = sameHash && sameCurrentSelection ? 'valid' : 'drifted';
  const verifiedAt = now();

  db.prepare('UPDATE production_snapshots SET status=?,verified_at=? WHERE id=? AND project_id=?').run(status, verifiedAt, snapshotId, projectId);

  return {
    snapshot_id: snapshotId,
    status,
    verified_at: verifiedAt,
    stored_hash: snapshot.snapshot_hash,
    recalculated_hash: expected,
    current_hash: current.snapshot_hash,
    current_gate_ok: current.ok,
    current_errors: current.errors,
    hash_matches_stored: sameHash,
    current_selection_matches: sameCurrentSelection,
    selection_diff: currentSelectionDiff
  };
}

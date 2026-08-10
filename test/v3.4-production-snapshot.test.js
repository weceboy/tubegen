import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v34-snapshot-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;

let db;
let createProject;
let createVisual;
let createSceneAsset;
let assignAssetToVisual;
let selectVisual;
let approveArtifact;
let createPersistedProductionSnapshot;
let getPersistedProductionSnapshot;
let listPersistedProductionSnapshots;
let inspectProductionSnapshot;
let verifyPersistedProductionSnapshot;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({
    createProject,
    createVisual,
    createSceneAsset,
    assignAssetToVisual,
    selectVisual,
    approveArtifact
  } = await import('../server/domain.js'));
  ({
    createPersistedProductionSnapshot,
    getPersistedProductionSnapshot,
    listPersistedProductionSnapshots,
    inspectProductionSnapshot,
    verifyPersistedProductionSnapshot
  } = await import('../server/production-snapshot.js'));
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

function seedScene(projectId) {
  const researchId = `research_${crypto.randomUUID()}`;
  const scriptId = `scriptv_${crypto.randomUUID()}`;
  const sceneId = `scene_${crypto.randomUUID()}`;
  const sceneVersionId = `scenev_${crypto.randomUUID()}`;
  const scriptArtifact = db.prepare('SELECT id FROM script_artifacts WHERE project_id=?').get(projectId);
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(researchId, projectId, 1, 'content', 'content', 'snapshot fixture', 'approved', 'human', new Date().toISOString());
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', new Date().toISOString());
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`)
    .run(sceneId, projectId, 1, new Date().toISOString());
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', new Date().toISOString());
  return { sceneId, sceneVersionId };
}

function readyVisual(projectId) {
  const { sceneId, sceneVersionId } = seedScene(projectId);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'snapshot fixture' });
  const asset = createSceneAsset({
    projectId,
    sourceType: 'upload',
    objectKey: `fixtures/${crypto.randomUUID()}.png`,
    mimeType: 'image/png',
    license: { status: 'verified', type: 'owned' }
  });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'human-1' });
  return { visualVersionId: assigned.id, assetId: asset.id, sceneId };
}

test('snapshot gate blocks missing selected visuals', () => {
  const project = createProject({ title: 'snapshot-gate' });
  seedScene(project.id);
  const inspected = inspectProductionSnapshot(project.id);
  assert.equal(inspected.ok, false);
  assert.ok(inspected.errors.some((error) => error.code === 'visual_selection_missing'));
  assert.throws(() => createPersistedProductionSnapshot(project.id), /snapshot gate failed/i);
});

test('snapshot persists exact visual version, asset and generation provenance', () => {
  const project = createProject({ title: 'snapshot-persist' });
  const fixture = readyVisual(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id, { createdBy: 'human-1' });

  assert.equal(snapshot.project_id, project.id);
  assert.equal(snapshot.visual_selections.length, 1);
  assert.equal(snapshot.visual_selections[0].scene_visual_version_id, fixture.visualVersionId);
  assert.equal(snapshot.visual_selections[0].source_asset_id, fixture.assetId);
  assert.equal(snapshot.visual_selections[0].source_generation_attempt_id, null);
  assert.match(snapshot.snapshot_hash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.status, 'valid');
  assert.ok(snapshot.verified_at);

  const persisted = getPersistedProductionSnapshot(project.id, snapshot.id);
  assert.equal(persisted.snapshot_hash, snapshot.snapshot_hash);
  assert.deepEqual(persisted.visual_selections, snapshot.visual_selections);

  const audit = db.prepare(`SELECT payload_json FROM audit_events WHERE event_type='production_snapshot_created' AND artifact_version_id IS NULL ORDER BY created_at DESC LIMIT 1`).get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.payload_json).snapshot_id, snapshot.id);
});

test('snapshot listing is project-scoped and newest-first', () => {
  const project = createProject({ title: 'snapshot-list' });
  readyVisual(project.id);
  const first = createPersistedProductionSnapshot(project.id);
  const second = createPersistedProductionSnapshot(project.id);
  const rows = listPersistedProductionSnapshots(project.id);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, second.id);
  assert.equal(rows[1].id, first.id);
  assert.ok(rows.every((row) => row.project_id === project.id));
});

test('snapshot verification succeeds while the production selection is unchanged', () => {
  const project = createProject({ title: 'snapshot-verify' });
  readyVisual(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);

  const verification = verifyPersistedProductionSnapshot(project.id, snapshot.id);
  assert.equal(verification.status, 'valid');
  assert.equal(verification.hash_matches_stored, true);
  assert.equal(verification.current_selection_matches, true);
  assert.equal(verification.current_gate_ok, true);
});

test('snapshot verification detects production drift after a new selected visual version', () => {
  const project = createProject({ title: 'snapshot-drift' });
  const fixture = readyVisual(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);

  const sceneVersionId = db.prepare('SELECT source_scene_version_id FROM scene_visual_versions WHERE id=?').get(fixture.visualVersionId).source_scene_version_id;
  const nextVersion = db.prepare('SELECT COALESCE(MAX(version_number),0)+1 AS n FROM scene_visual_versions WHERE scene_visual_id=(SELECT scene_visual_id FROM scene_visual_versions WHERE id=?)').get(fixture.visualVersionId).n;
  const nextVisualVersionId = `visualv_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,source_prompt,asset_type,asset_source,status,approval_mode,source_asset_id,created_at) SELECT ?,scene_visual_id,?,?,source_prompt,asset_type,asset_source,'approved','human',source_asset_id,? FROM scene_visual_versions WHERE id=?`)
    .run(nextVisualVersionId, nextVersion, sceneVersionId, new Date().toISOString(), fixture.visualVersionId);

  const verification = verifyPersistedProductionSnapshot(project.id, snapshot.id);
  assert.equal(verification.status, 'drifted');
  assert.equal(verification.hash_matches_stored, true);
  assert.equal(verification.current_selection_matches, false);
  assert.equal(verification.current_gate_ok, true);
});

test('snapshot gate rejects stale selected visuals', () => {
  const project = createProject({ title: 'snapshot-stale' });
  const { sceneId, sceneVersionId } = seedScene(project.id);
  const visual = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'stale fixture' });
  const asset = createSceneAsset({ projectId: project.id, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, license: { status: 'verified' } });
  const assigned = assignAssetToVisual({ projectId: project.id, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId: project.id, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId: project.id, visualId: assigned.scene_visual_id, actorId: 'human-1' });

  const nextSceneVersionId = `scenev_${crypto.randomUUID()}`;
  const scriptVersionId = db.prepare('SELECT id FROM script_versions WHERE script_artifact_id=(SELECT id FROM script_artifacts WHERE project_id=?) LIMIT 1').get(project.id).id;
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(nextSceneVersionId, sceneId, 2, scriptVersionId, 'script', 'changed', 'approved', 'human', new Date().toISOString());

  const inspected = inspectProductionSnapshot(project.id);
  assert.equal(inspected.ok, false);
  assert.ok(inspected.errors.some((error) => error.code === 'visual_stale'));
});

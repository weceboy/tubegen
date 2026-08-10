import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v34-manifest-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;

let db;
let createProject;
let createVisual;
let createSceneAsset;
let assignAssetToVisual;
let selectVisual;
let approveArtifact;
let createPersistedProductionSnapshot;
let buildProductionManifest;
let verifyProductionManifest;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ buildProductionManifest, verifyProductionManifest } = await import('../server/production-manifest.js'));
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

function fixture(projectId) {
  const researchId = `research_${crypto.randomUUID()}`;
  const scriptId = `scriptv_${crypto.randomUUID()}`;
  const sceneId = `scene_${crypto.randomUUID()}`;
  const sceneVersionId = `scenev_${crypto.randomUUID()}`;
  const scriptArtifact = db.prepare('SELECT id FROM script_artifacts WHERE project_id=?').get(projectId);
  const t = new Date().toISOString();
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'manifest fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, t);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', t);

  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'manifest fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, mimeType: 'image/png', checksum: 'fixture-checksum', license: { status: 'verified', type: 'owned', commercialUse: true } });
  const version = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: version.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId, visualId: version.scene_visual_id, actorId: 'human-1' });
  return { versionId: version.id, assetId: asset.id };
}

test('production manifest contains complete version-to-asset lineage', () => {
  const project = createProject({ title: 'manifest' });
  const fixtureData = fixture(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id, { createdBy: 'human-1' });
  const manifest = buildProductionManifest(project.id, snapshot.id);

  assert.equal(manifest.manifest_version, '1.0');
  assert.match(manifest.manifest_hash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.visual_selections.length, 1);
  const item = manifest.visual_selections[0];
  assert.equal(item.scene_visual_version_id, fixtureData.versionId);
  assert.equal(item.source_asset_id, fixtureData.assetId);
  assert.equal(item.asset.object_key.startsWith('fixtures/'), true);
  assert.equal(item.asset.license.status, 'verified');
  assert.equal(item.generation_attempt, null);
});

test('production manifest verification accepts the stored hash', () => {
  const project = createProject({ title: 'manifest-verify' });
  fixture(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);
  const manifest = buildProductionManifest(project.id, snapshot.id);
  const verification = verifyProductionManifest(project.id, snapshot.id, manifest.manifest_hash);

  assert.equal(verification.ok, true);
  assert.equal(verification.hash_matches, true);
  assert.equal(verification.snapshot.status, 'valid');
});

test('production manifest verification rejects a supplied tampered hash', () => {
  const project = createProject({ title: 'manifest-tamper' });
  fixture(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);
  const verification = verifyProductionManifest(project.id, snapshot.id, '0'.repeat(64));

  assert.equal(verification.ok, false);
  assert.equal(verification.hash_matches, false);
  assert.equal(verification.snapshot.status, 'valid');
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v35-render-${process.pid}.sqlite`);
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
let prepareProductionRender;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ buildProductionManifest } = await import('../server/production-manifest.js'));
  ({ prepareProductionRender } = await import('../server/production-render-control.js'));
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
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'render fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, t);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', t);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'render fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, mimeType: 'image/png', checksum: 'render-checksum', license: { status: 'verified', type: 'owned', commercialUse: true } });
  const version = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: version.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId, visualId: version.scene_visual_id, actorId: 'human-1' });
}

test('production render preflight returns deterministic lineage plan', () => {
  const project = createProject({ title: 'render-control' });
  fixture(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);
  const manifest = buildProductionManifest(project.id, snapshot.id);
  const first = prepareProductionRender(project.id, snapshot.id, manifest.manifest_hash);
  const second = prepareProductionRender(project.id, snapshot.id, manifest.manifest_hash);

  assert.equal(first.ok, true);
  assert.equal(first.plan.manifest_hash, manifest.manifest_hash);
  assert.equal(first.plan.render_inputs.length, 1);
  assert.equal(first.plan.render_inputs[0].source_asset_id, manifest.visual_selections[0].source_asset_id);
  assert.equal(first.plan_hash, second.plan_hash);
});

test('production render preflight fails closed on a tampered manifest hash', () => {
  const project = createProject({ title: 'render-control-tamper' });
  fixture(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);

  assert.throws(
    () => prepareProductionRender(project.id, snapshot.id, '0'.repeat(64)),
    (error) => error.code === 'PRODUCTION_RENDER_PREFLIGHT_FAILED'
  );
});

test('manifest hash remains stable after snapshot verification metadata changes', async () => {
  const project = createProject({ title: 'render-control-stable-hash' });
  fixture(project.id);
  const snapshot = createPersistedProductionSnapshot(project.id);
  const manifestBefore = buildProductionManifest(project.id, snapshot.id);
  const { verifyProductionManifest } = await import('../server/production-manifest.js');
  const verification = verifyProductionManifest(project.id, snapshot.id, manifestBefore.manifest_hash);
  const manifestAfter = buildProductionManifest(project.id, snapshot.id);

  assert.equal(verification.ok, true);
  assert.equal(manifestAfter.manifest_hash, manifestBefore.manifest_hash);
});

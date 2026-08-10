import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v44-delivery-package-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;
let db;
let createProject;
let createVisual;
let createSceneAsset;
let assignAssetToVisual;
let selectVisual;
let approveArtifact;
let createPersistedProductionSnapshot;
let enqueueProductionRender;
let claimProductionRenderJob;
let processProductionRenderJob;
let createProductionRelease;
let createProductionDeliveryManifest;
let createProductionDeliveryPackage;
let verifyProductionDeliveryPackage;
let markProductionDeliveryPackageDelivered;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ enqueueProductionRender, claimProductionRenderJob, processProductionRenderJob } = await import('../server/production-render-jobs.js'));
  ({ createProductionRelease } = await import('../server/production-release-service.js'));
  ({ createProductionDeliveryManifest } = await import('../server/production-delivery-manifest-service.js'));
  ({ createProductionDeliveryPackage, verifyProductionDeliveryPackage, markProductionDeliveryPackageDelivered } = await import('../server/production-delivery-package-service.js'));
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

function seedReadySnapshot(projectId) {
  const stamp = new Date().toISOString();
  const researchId = `research_${crypto.randomUUID()}`;
  const scriptId = `scriptv_${crypto.randomUUID()}`;
  const sceneId = `scene_${crypto.randomUUID()}`;
  const sceneVersionId = `scenev_${crypto.randomUUID()}`;
  const scriptArtifact = db.prepare('SELECT id FROM script_artifacts WHERE project_id=?').get(projectId);
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'package fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, stamp);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', stamp);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'package fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.mp4`, mimeType: 'video/mp4', checksum: 'b'.repeat(64), size: 1024, license: { status: 'verified', type: 'owned' } });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'tester' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'tester', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'tester' });
  return createPersistedProductionSnapshot(projectId, { createdBy: 'tester' });
}

async function fixture() {
  const project = createProject({ title: 'delivery-package-fixture' });
  const snapshot = seedReadySnapshot(project.id);
  const queued = enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('delivery-package-worker');
  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum: 'a'.repeat(64), size: 4096, rendererId: 'delivery-package-fixture' }; } }
  });
  assert.equal(completed.id, queued.job.id);
  const release = createProductionRelease(project.id, completed.id, { actorId: 'tester' });
  const manifest = createProductionDeliveryManifest(project.id, release.id, { actorId: 'tester' });
  return { project, release, manifest };
}

test('v4.4 delivery package is deterministic and idempotent', async () => {
  const { project, release } = await fixture();
  const first = createProductionDeliveryPackage(project.id, release.id, { actorId: 'tester' });
  const second = createProductionDeliveryPackage(project.id, release.id, { actorId: 'other' });
  assert.equal(second.id, first.id);
  assert.equal(second.package_hash, first.package_hash);
  assert.equal(second.artifact_count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_delivery_packages WHERE release_id=?').get(release.id).n, 1);
});

test('v4.4 package verification accepts intact lineage and promotes status', async () => {
  const { project, release } = await fixture();
  const pkg = createProductionDeliveryPackage(project.id, release.id, { actorId: 'tester' });
  assert.equal(pkg.status, 'created');
  const result = verifyProductionDeliveryPackage(project.id, pkg.id);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'valid');
  assert.equal(result.package.status, 'verified');
  assert.equal(result.payload.schema, 'production-delivery-package/v4.4');
});

test('v4.4 package fails closed after payload tampering', async () => {
  const { project, release } = await fixture();
  const pkg = createProductionDeliveryPackage(project.id, release.id, { actorId: 'tester' });
  const payload = JSON.parse(pkg.payload_json);
  payload.artifacts[0].objectKey = 'tampered.json';
  db.prepare('UPDATE production_delivery_packages SET payload_json=? WHERE id=?').run(JSON.stringify(payload), pkg.id);
  const result = verifyProductionDeliveryPackage(project.id, pkg.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'drifted');
});

test('v4.4 package fails closed after package item tampering', async () => {
  const { project, release } = await fixture();
  const pkg = createProductionDeliveryPackage(project.id, release.id, { actorId: 'tester' });
  db.prepare('UPDATE production_delivery_package_items SET checksum=? WHERE package_id=? AND role=?').run('c'.repeat(64), pkg.id, 'production-output');
  const result = verifyProductionDeliveryPackage(project.id, pkg.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'drifted');
});

test('v4.4 delivery requires verified package and records terminal delivery', async () => {
  const { project, release } = await fixture();
  const pkg = createProductionDeliveryPackage(project.id, release.id, { actorId: 'tester' });
  const delivered = markProductionDeliveryPackageDelivered(project.id, pkg.id, 's3://delivery/test', { actorId: 'tester' });
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.delivery_reference, 's3://delivery/test');
  const again = markProductionDeliveryPackageDelivered(project.id, pkg.id, 'ignored', { actorId: 'other' });
  assert.equal(again.id, pkg.id);
  assert.equal(again.delivery_reference, 's3://delivery/test');
});

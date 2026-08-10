import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v45-delivery-bundle-${process.pid}.sqlite`);
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
let createProductionDeliveryBundle;
let verifyProductionDeliveryBundle;
let exportProductionDeliveryBundle;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ enqueueProductionRender, claimProductionRenderJob, processProductionRenderJob } = await import('../server/production-render-jobs.js'));
  ({ createProductionRelease } = await import('../server/production-release-service.js'));
  ({ createProductionDeliveryManifest } = await import('../server/production-delivery-manifest-service.js'));
  ({ createProductionDeliveryPackage } = await import('../server/production-delivery-package-service.js'));
  ({ createProductionDeliveryBundle, verifyProductionDeliveryBundle, exportProductionDeliveryBundle } = await import('../server/production-delivery-bundle-service.js'));
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
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'bundle fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, stamp);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', stamp);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'bundle fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.mp4`, mimeType: 'video/mp4', checksum: 'b'.repeat(64), size: 1024, license: { status: 'verified', type: 'owned' } });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'tester' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'tester', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'tester' });
  return createPersistedProductionSnapshot(projectId, { createdBy: 'tester' });
}

async function fixture() {
  const project = createProject({ title: 'delivery-bundle-fixture' });
  const snapshot = seedReadySnapshot(project.id);
  const queued = enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('delivery-bundle-worker');
  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum: 'a'.repeat(64), size: 4096, rendererId: 'delivery-bundle-fixture' }; } }
  });
  assert.equal(completed.id, queued.job.id);
  const release = createProductionRelease(project.id, completed.id, { actorId: 'tester' });
  createProductionDeliveryManifest(project.id, release.id, { actorId: 'tester' });
  const pkg = createProductionDeliveryPackage(project.id, release.id, { actorId: 'tester' });
  return { project, release, pkg };
}

test('v4.5 delivery bundle is deterministic and idempotent', async () => {
  const { project, release } = await fixture();
  const first = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  const second = createProductionDeliveryBundle(project.id, release.id, { actorId: 'other' });
  assert.equal(second.id, first.id);
  assert.equal(second.bundle_hash, first.bundle_hash);
  assert.equal(second.entry_count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_delivery_bundles WHERE release_id=?').get(release.id).n, 1);
});

test('v4.5 bundle verification accepts intact lineage and promotes status', async () => {
  const { project, release } = await fixture();
  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  assert.equal(bundle.status, 'created');
  const result = verifyProductionDeliveryBundle(project.id, bundle.id);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'valid');
  assert.equal(result.bundle.status, 'verified');
  assert.equal(result.payload.schema, 'production-delivery-bundle/v4.5');
  assert.match(result.payload.entries[0].path, /^artifacts\//);
});

test('v4.5 bundle fails closed after payload tampering', async () => {
  const { project, release } = await fixture();
  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  const payload = JSON.parse(bundle.payload_json);
  payload.entries[0].path = 'artifacts/tampered.bin';
  db.prepare('UPDATE production_delivery_bundles SET payload_json=? WHERE id=?').run(JSON.stringify(payload), bundle.id);
  const result = verifyProductionDeliveryBundle(project.id, bundle.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'drifted');
});

test('v4.5 bundle fails closed after persisted entry tampering', async () => {
  const { project, release } = await fixture();
  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  db.prepare('UPDATE production_delivery_bundle_entries SET checksum=? WHERE bundle_id=?').run('c'.repeat(64), bundle.id);
  const result = verifyProductionDeliveryBundle(project.id, bundle.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'drifted');
});

test('v4.5 bundle fails closed after release revocation', async () => {
  const { project, release } = await fixture();
  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  db.prepare(`UPDATE production_releases SET status='revoked', revoked_at=?, revoked_by=?, revoke_reason=? WHERE id=?`).run(new Date().toISOString(), 'tester', 'fixture revocation', release.id);
  const result = verifyProductionDeliveryBundle(project.id, bundle.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'revoked');
});

test('v4.5 export requires verification and is terminal/idempotent', async () => {
  const { project, release } = await fixture();
  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  const exported = exportProductionDeliveryBundle(project.id, bundle.id, 'file:///exports/release.bundle', { actorId: 'tester' });
  assert.equal(exported.status, 'exported');
  assert.equal(exported.export_reference, 'file:///exports/release.bundle');
  const again = exportProductionDeliveryBundle(project.id, bundle.id, 'ignored', { actorId: 'other' });
  assert.equal(again.id, bundle.id);
  assert.equal(again.export_reference, 'file:///exports/release.bundle');
});

test('v4.5 export fails closed when package lineage drifts', async () => {
  const { project, release, pkg } = await fixture();
  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId: 'tester' });
  db.prepare('UPDATE production_delivery_packages SET package_hash=? WHERE id=?').run('d'.repeat(64), pkg.id);
  assert.throws(() => exportProductionDeliveryBundle(project.id, bundle.id, 'file:///exports/release.bundle', { actorId: 'tester' }), /Production delivery bundle export blocked/);
});

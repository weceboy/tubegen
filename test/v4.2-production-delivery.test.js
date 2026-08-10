import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v42-delivery-${process.pid}.sqlite`);
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
let publishProductionRender;
let createProductionRelease;
let verifyProductionPublish;
let getProductionDeliveryStatus;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ enqueueProductionRender, claimProductionRenderJob, processProductionRenderJob } = await import('../server/production-render-jobs.js'));
  ({ publishProductionRender } = await import('../server/production-publish-service.js'));
  ({ createProductionRelease } = await import('../server/production-release-service.js'));
  ({ verifyProductionPublish, getProductionDeliveryStatus } = await import('../server/production-delivery-service.js'));
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
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'delivery fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, stamp);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', stamp);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'delivery fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, mimeType: 'image/png', license: { status: 'verified', type: 'owned' } });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'tester' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'tester', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'tester' });
  return createPersistedProductionSnapshot(projectId, { createdBy: 'tester' });
}

async function fixture() {
  const project = createProject({ title: 'delivery-fixture' });
  const snapshot = seedReadySnapshot(project.id);
  const queued = enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('delivery-worker');
  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum: 'a'.repeat(64), rendererId: 'delivery-fixture' }; } }
  });
  assert.equal(completed.id, queued.job.id);
  const publish = publishProductionRender(project.id, completed.id, { actorId: 'tester' });
  return { project, completed, publish };
}

test('v4.2 verifies a persisted production publish', async () => {
  const { project, publish } = await fixture();
  const result = verifyProductionPublish(project.id, publish.id);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'valid');
});

test('v4.2 detects production publish attestation drift', async () => {
  const { project, publish } = await fixture();
  db.prepare('UPDATE production_publishes SET attestation_hash=? WHERE id=?').run('f'.repeat(64), publish.id);
  const result = verifyProductionPublish(project.id, publish.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'drifted');
});

test('v4.2 delivery status fails closed without a release', async () => {
  const { project, publish } = await fixture();
  const result = getProductionDeliveryStatus(project.id);
  assert.equal(result.publish.verification.ok, true);
  assert.equal(result.publish.latest.id, publish.id);
  assert.equal(result.release.latest, null);
  assert.equal(result.ready, false);
  assert.equal(result.release.verification.status, 'missing');
});

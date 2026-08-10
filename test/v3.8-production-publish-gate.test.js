import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v38-publish-${process.pid}.sqlite`);
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
let verifyProductionPublishGate;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ enqueueProductionRender, claimProductionRenderJob, processProductionRenderJob } = await import('../server/production-render-jobs.js'));
  ({ verifyProductionPublishGate } = await import('../server/production-publish-gate.js'));
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
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'publish gate fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, stamp);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', stamp);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'publish gate fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, mimeType: 'image/png', license: { status: 'verified', type: 'owned' } });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'human-1' });
  return createPersistedProductionSnapshot(projectId, { createdBy: 'human-1' });
}

async function completeFixture(projectTitle) {
  const project = createProject({ title: projectTitle });
  const snapshot = seedReadySnapshot(project.id);
  const queued = enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('publish-worker');
  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum: 'e'.repeat(64), rendererId: 'publish-fixture' }; } }
  });
  assert.equal(completed.id, queued.job.id);
  return { project, completed };
}

test('v3.8 publish gate accepts an intact completed render', async () => {
  const { project, completed } = await completeFixture('publish-ok');
  const gate = verifyProductionPublishGate(project.id, completed.id);
  assert.equal(gate.ok, true);
  assert.equal(gate.output_asset_id, completed.output_asset_id);
  assert.equal(gate.plan_hash, completed.plan_hash);
});

test('v3.8 publish gate fails closed after output metadata tampering', async () => {
  const { project, completed } = await completeFixture('publish-tampered');
  db.prepare('UPDATE scene_assets SET object_key=? WHERE id=?').run(`renders/${project.id}/tampered.mp4`, completed.output_asset_id);
  const gate = verifyProductionPublishGate(project.id, completed.id);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'RENDER_ATTESTATION_FAILED');
});

test('v3.8 publish gate fails closed when the render plan drifts', async () => {
  const { project, completed } = await completeFixture('publish-drift');
  db.prepare('UPDATE production_render_jobs SET plan_hash=? WHERE id=?').run('f'.repeat(64), completed.id);
  const gate = verifyProductionPublishGate(project.id, completed.id);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'RENDER_PLAN_DRIFT');
});

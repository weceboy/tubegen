import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v36-integrity-${process.pid}.sqlite`);
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
let verifyPersistedRenderOutput;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({ enqueueProductionRender, claimProductionRenderJob, processProductionRenderJob } = await import('../server/production-render-jobs.js'));
  ({ verifyPersistedRenderOutput } = await import('../server/render-integrity.js'));
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
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'integrity fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', stamp);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, stamp);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', stamp);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'integrity fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, mimeType: 'image/png', license: { status: 'verified', type: 'owned' } });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'human-1' });
  return createPersistedProductionSnapshot(projectId, { createdBy: 'human-1' });
}

test('v3.6 production render job has output integrity columns', () => {
  const columns = db.prepare('PRAGMA table_info(production_render_jobs)').all().map((column) => column.name);
  assert.ok(columns.includes('output_checksum'));
  assert.ok(columns.includes('output_manifest_hash'));
  assert.ok(columns.includes('output_lineage_hash'));
  assert.ok(columns.includes('integrity_verified_at'));
});

test('v3.6 render completion stores checksum and attestation lineage', async () => {
  const project = createProject({ title: 'integrity-complete' });
  const snapshot = seedReadySnapshot(project.id);
  const queued = enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('integrity-worker');
  assert.equal(claimed.id, queued.job.id);

  const checksum = 'b'.repeat(64);
  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum, rendererId: 'fixture-v36' }; } }
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.output_checksum, checksum);
  assert.match(completed.output_manifest_hash, /^[a-f0-9]{64}$/);
  assert.match(completed.output_lineage_hash, /^[a-f0-9]{64}$/);
  assert.equal(completed.renderer_id, 'fixture-v36');
  assert.ok(completed.integrity_verified_at);
});

test('v3.6 rejects a non-SHA256 render checksum before persisting output', async () => {
  const project = createProject({ title: 'integrity-bad-checksum' });
  const snapshot = seedReadySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('integrity-worker');

  await assert.rejects(() => processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum: 'not-a-hash' }; } }
  }), /checksum/i);

  const stored = db.prepare('SELECT status,output_asset_id FROM production_render_jobs WHERE id=?').get(claimed.id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.output_asset_id, null);
});

test('v3.6 rejects render output outside the project storage namespace', async () => {
  const project = createProject({ title: 'integrity-namespace' });
  const snapshot = seedReadySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('integrity-worker');

  await assert.rejects(() => processProductionRenderJob(claimed, {
    renderer: { async render() { return { objectKey: 'renders/other-project/output.mp4', mimeType: 'video/mp4', checksum: 'c'.repeat(64) }; } }
  }), /namespace/i);

  assert.equal(db.prepare('SELECT status FROM production_render_jobs WHERE id=?').get(claimed.id).status, 'failed');
});

test('v3.7 verifies persisted render attestation and detects metadata tampering', async () => {
  const project = createProject({ title: 'integrity-persisted-verification' });
  const snapshot = seedReadySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('integrity-worker');
  const checksum = 'd'.repeat(64);
  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan, job }) { return { objectKey: `renders/${plan.project_id}/${job.id}.mp4`, mimeType: 'video/mp4', checksum, rendererId: 'fixture-v37' }; } }
  });

  assert.equal(verifyPersistedRenderOutput(project.id, completed.id).ok, true);

  db.prepare('UPDATE scene_assets SET object_key=? WHERE id=?').run(`renders/${project.id}/tampered.mp4`, completed.output_asset_id);
  const drift = verifyPersistedRenderOutput(project.id, completed.id);
  assert.equal(drift.ok, false);
  assert.match(drift.reason, /manifest hash/i);
});

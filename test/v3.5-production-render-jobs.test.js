import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v35-render-jobs-${process.pid}.sqlite`);
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
let getProductionRenderJob;
let listProductionRenderJobs;
let claimProductionRenderJob;
let heartbeatProductionRenderJob;
let recoverExpiredProductionRenderJobs;
let failProductionRenderJob;
let processProductionRenderJob;
let assertProductionRenderJobLineage;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject, createVisual, createSceneAsset, assignAssetToVisual, selectVisual, approveArtifact } = await import('../server/domain.js'));
  ({ createPersistedProductionSnapshot } = await import('../server/production-snapshot.js'));
  ({
    enqueueProductionRender,
    getProductionRenderJob,
    listProductionRenderJobs,
    claimProductionRenderJob,
    heartbeatProductionRenderJob,
    recoverExpiredProductionRenderJobs,
    failProductionRenderJob,
    processProductionRenderJob,
    assertProductionRenderJobLineage
  } = await import('../server/production-render-jobs.js'));
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
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'render fixture', 'approved', 'human', timestamp);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', timestamp);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 1, timestamp);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', timestamp);
  return { sceneId, sceneVersionId };
}

function readyVisual(projectId) {
  const { sceneId, sceneVersionId } = seedScene(projectId);
  const visual = createVisual({ projectId, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'production render fixture' });
  const asset = createSceneAsset({ projectId, sourceType: 'upload', objectKey: `fixtures/${crypto.randomUUID()}.png`, mimeType: 'image/png', license: { status: 'verified', type: 'owned' } });
  const assigned = assignAssetToVisual({ projectId, visualVersionId: visual.id, assetId: asset.id, actorId: 'human-1' });
  approveArtifact({ projectId, artifactType: 'visual', artifactVersionId: assigned.id, actorId: 'human-1', approvalMode: 'human' });
  selectVisual({ projectId, visualId: assigned.scene_visual_id, actorId: 'human-1' });
  return { visualVersionId: assigned.id, assetId: asset.id };
}

function readySnapshot(projectId) {
  readyVisual(projectId);
  return createPersistedProductionSnapshot(projectId, { createdBy: 'human-1' });
}

test('production render enqueue is idempotent for the same snapshot and plan', () => {
  const project = createProject({ title: 'render-idempotent' });
  const snapshot = readySnapshot(project.id);
  const first = enqueueProductionRender(project.id, snapshot.id, { createdBy: 'human-1' });
  const second = enqueueProductionRender(project.id, snapshot.id, { createdBy: 'human-1' });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.job.id, second.job.id);
  assert.equal(listProductionRenderJobs(project.id).length, 1);
  db.prepare('DELETE FROM production_render_jobs WHERE id=?').run(first.job.id);
});

test('production render job captures immutable snapshot and plan hashes', () => {
  const project = createProject({ title: 'render-lineage' });
  const snapshot = readySnapshot(project.id);
  const result = enqueueProductionRender(project.id, snapshot.id);
  const lineage = assertProductionRenderJobLineage(project.id, result.job.id);

  assert.equal(result.job.snapshot_id, snapshot.id);
  assert.match(result.job.manifest_hash, /^[a-f0-9]{64}$/);
  assert.match(result.job.plan_hash, /^[a-f0-9]{64}$/);
  assert.equal(lineage.snapshot.length, 1);
  assert.equal(lineage.snapshot[0].source_asset_id, snapshot.visual_selections[0].source_asset_id);
  db.prepare('DELETE FROM production_render_jobs WHERE id=?').run(result.job.id);
});

test('claim and heartbeat keep a production render job leased to one worker', () => {
  const project = createProject({ title: 'render-lease' });
  const snapshot = readySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);

  const claimed = claimProductionRenderJob('worker-a', { leaseMs: 10_000 });
  assert.equal(claimed.worker_id, 'worker-a');
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempt, 1);
  assert.equal(heartbeatProductionRenderJob(project.id, claimed.id, 'worker-a', { leaseMs: 30_000 }), true);
  assert.equal(heartbeatProductionRenderJob(project.id, claimed.id, 'worker-b'), false);
});

test('expired production render leases return to the queue', () => {
  const project = createProject({ title: 'render-recovery' });
  const snapshot = readySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('dead-worker', { leaseMs: 1 });
  db.prepare("UPDATE production_render_jobs SET lease_expires_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), claimed.id);

  assert.equal(recoverExpiredProductionRenderJobs(), 1);
  assert.equal(getProductionRenderJob(project.id, claimed.id).status, 'queued');
  db.prepare('DELETE FROM production_render_jobs WHERE id=?').run(claimed.id);
});

test('failed production render retries until max attempts and then becomes terminal', () => {
  const project = createProject({ title: 'render-retry' });
  const snapshot = readySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id, { maxAttempts: 2 });

  const first = claimProductionRenderJob('worker-a');
  const retry = failProductionRenderJob(project.id, first.id, new Error('temporary'), { retryable: true });
  assert.equal(retry.status, 'queued');
  const second = claimProductionRenderJob('worker-a');
  const terminal = failProductionRenderJob(project.id, second.id, new Error('permanent'), { retryable: true });
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.attempt, 2);
});

test('production render completes with an output scene asset and audit event', async () => {
  const project = createProject({ title: 'render-complete' });
  const snapshot = readySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('renderer-1');

  const completed = await processProductionRenderJob(claimed, {
    renderer: { async render({ plan }) { return { objectKey: `renders/${plan.project_id}/${claimed.id}.mp4`, mimeType: 'video/mp4', checksum: 'a'.repeat(64), durationMs: 1234 }; } }
  });

  assert.equal(completed.status, 'completed');
  assert.ok(completed.output_asset_id);
  const asset = db.prepare('SELECT * FROM scene_assets WHERE id=?').get(completed.output_asset_id);
  assert.equal(asset.project_id, project.id);
  assert.equal(asset.object_key, `renders/${project.id}/${claimed.id}.mp4`);
  assert.equal(asset.mime_type, 'video/mp4');
  const audit = db.prepare(`SELECT payload_json FROM audit_events WHERE event_type='production_render_completed' ORDER BY created_at DESC LIMIT 1`).get();
  assert.equal(JSON.parse(audit.payload_json).output_asset_id, completed.output_asset_id);
});

test('production render fails closed when the snapshot drifts after enqueue', async () => {
  const project = createProject({ title: 'render-drift' });
  const snapshot = readySnapshot(project.id);
  enqueueProductionRender(project.id, snapshot.id);
  const claimed = claimProductionRenderJob('renderer-1');
  const fixture = db.prepare('SELECT scene_visual_id,source_scene_version_id FROM scene_visual_versions WHERE id=?').get(snapshot.visual_selections[0].scene_visual_version_id);
  const nextVersion = db.prepare('SELECT COALESCE(MAX(version_number),0)+1 AS n FROM scene_visual_versions WHERE scene_visual_id=?').get(fixture.scene_visual_id).n;
  const nextId = `visualv_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,source_prompt,asset_type,asset_source,status,approval_mode,source_asset_id,created_at) SELECT ?,scene_visual_id,?,?,source_prompt,asset_type,asset_source,'approved','human',source_asset_id,? FROM scene_visual_versions WHERE id=?`).run(nextId, nextVersion, fixture.source_scene_version_id, new Date().toISOString(), snapshot.visual_selections[0].scene_visual_version_id);

  await assert.rejects(() => processProductionRenderJob(claimed), /preflight failed/i);
  assert.equal(getProductionRenderJob(project.id, claimed.id).status, 'failed');
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-worker-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;

const { db, enqueueJob } = await import('../server/db.js');
const {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
  processVisualGenerationJob,
  reconcileVisualGenerationJobs,
  defaultProviderRegistry,
  ProviderError
} = await import('../server/worker.js');
const { createProject, createVisual, createGenerationAttempt } = await import('../server/domain.js');

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('worker claims and completes a queued job', () => {
  const project = createProject({ title: 'worker-complete' });
  const job = enqueueJob({ projectId: project.id, stage: 'test', jobType: 'test', payload: { testId: crypto.randomUUID() }, idempotencyKey: `worker-complete-${crypto.randomUUID()}` }).job;
  const claimed = claimNextJob();
  assert.equal(claimed?.id, job.id);
  assert.equal(heartbeatJob(job.id), true);
  assert.equal(completeJob(job.id, { ok: true }), true);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status, 'completed');
});

test('worker can requeue a failed job before terminal retry', () => {
  const project = createProject({ title: 'worker-retry' });
  const job = enqueueJob({ projectId: project.id, stage: 'test', jobType: 'test', payload: { testId: crypto.randomUUID() }, idempotencyKey: `worker-retry-${crypto.randomUUID()}`, maxAttempts: 3 }).job;
  const claimed = claimNextJob();
  assert.equal(claimed?.id, job.id);
  assert.equal(failJob(job.id, new Error('transient')), true);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status, 'queued');
  db.prepare("UPDATE jobs SET status='completed', finished_at=? WHERE id=?").run(new Date().toISOString(), job.id);
});

test('visual attempts are reconciled into durable jobs and completed through the provider adapter', async () => {
  const project = createProject({ title: `worker-integration-${crypto.randomUUID()}` });
  const sceneId = `scene_${crypto.randomUUID()}`;
  const sceneVersionId = `scenev_${crypto.randomUUID()}`;
  const scriptArtifact = db.prepare('SELECT id FROM script_artifacts WHERE project_id=?').get(project.id);
  const researchId = `research_${crypto.randomUUID()}`;
  const scriptId = `scriptv_${crypto.randomUUID()}`;
  const t = new Date().toISOString();
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, project.id, 1, 'content', 'content', 'worker fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, project.id, 1, t);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', t);
  const visual = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'worker integration' });
  const { attempt } = createGenerationAttempt({ projectId: project.id, visualVersionId: visual.id, provider: 'mock', model: 'deterministic', parameters: { seed: 7 } });

  // Reconciliation is global. Other independent attempts may already have jobs.
  // Assert this attempt gets a durable job instead of assuming a global count.
  const beforeJobIds = new Set(db.prepare("SELECT id FROM jobs WHERE job_type='visual_generation'").all().map(row => row.id));
  const reconciled = reconcileVisualGenerationJobs();
  const job = db.prepare("SELECT * FROM jobs WHERE job_type='visual_generation' AND payload_json LIKE ?").get(`%${attempt.id}%`);
  assert.ok(job);
  assert.ok(reconciled >= 1 || beforeJobIds.has(job.id));

  db.prepare("UPDATE jobs SET priority='high' WHERE id=?").run(job.id);
  const claimed = claimNextJob();
  assert.equal(claimed.id, job.id);
  const result = await processVisualGenerationJob(claimed, { providers: defaultProviderRegistry() });
  assert.ok(result.assetId);
  assert.equal(completeJob(job.id, result), true);
  const completed = db.prepare('SELECT status,result_asset_id,provider_request_id FROM generation_attempts WHERE id=?').get(attempt.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result_asset_id, result.assetId);
  assert.match(completed.provider_request_id, /^mock_/);
  const asset = db.prepare('SELECT * FROM scene_assets WHERE id=?').get(result.assetId);
  assert.equal(asset.source_generation_attempt_id, attempt.id);
  assert.equal(db.prepare('SELECT license_status FROM asset_licenses WHERE asset_id=?').get(asset.id).license_status, 'verified');
});

test('unconfigured providers fail closed without being retried forever', async () => {
  const project = createProject({ title: `provider-error-${crypto.randomUUID()}` });
  const sceneId = `scene_${crypto.randomUUID()}`;
  const sceneVersionId = `scenev_${crypto.randomUUID()}`;
  const scriptArtifact = db.prepare('SELECT id FROM script_artifacts WHERE project_id=?').get(project.id);
  const researchId = `research_${crypto.randomUUID()}`;
  const scriptId = `scriptv_${crypto.randomUUID()}`;
  const t = new Date().toISOString();
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, project.id, 1, 'content', 'content', 'provider fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', t);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, project.id, 1, t);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptId, 'script', 'fixture', 'approved', 'human', t);
  const visual = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneVersionId, prompt: 'provider failure' });
  const { attempt } = createGenerationAttempt({ projectId: project.id, visualVersionId: visual.id, provider: 'missing-provider', model: 'none' });
  reconcileVisualGenerationJobs();
  const job = db.prepare("SELECT * FROM jobs WHERE job_type='visual_generation' AND payload_json LIKE ?").get(`%${attempt.id}%`);
  db.prepare("UPDATE jobs SET priority='high' WHERE id=?").run(job.id);
  const claimed = claimNextJob();
  await assert.rejects(() => processVisualGenerationJob(claimed, { providers: defaultProviderRegistry() }), ProviderError);
  assert.equal(db.prepare('SELECT status FROM generation_attempts WHERE id=?').get(attempt.id).status, 'failed');
  assert.equal(failJob(job.id, new ProviderError('provider unavailable', { retryable: false })), true);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status, 'failed');
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-e2e-pipeline-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;

const { db } = await import('../server/db.js');
const {
  createProject, createResearch, createScriptVersion, approveArtifact,
  createVisual, createGenerationAttempt, completeGenerationAttempt,
  assignAssetToVisual, selectVisual
} = await import('../server/domain.js');
const { createSceneVersion } = await import('../server/pipeline.js');
const { createNarrationSnapshot, createVoiceoverVersion, createTimestampVersion } = await import('../server/production-stages.js');
const { buildTimeline, buildRoughCut, buildFineCut, requestFinalRender } = await import('../server/edit-stages.js');
const { claimProductionRenderJob, processProductionRenderJob } = await import('../server/production-render-jobs.js');
const { mockProvider } = await import('../server/worker.js');
const { verifyProductionPublishGate } = await import('../server/production-publish-gate.js');
const { publishProductionRender } = await import('../server/production-publish-service.js');
const { createProductionRelease } = await import('../server/production-release-service.js');
const { createProductionDeliveryManifest } = await import('../server/production-delivery-manifest-service.js');
const { createProductionDeliveryPackage } = await import('../server/production-delivery-package-service.js');
const { createProductionDeliveryBundle } = await import('../server/production-delivery-bundle-service.js');

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

/**
 * Exercises the exact live path a real user/client goes through end to
 * end - the same functions server/index.js wires to HTTP routes, not raw
 * SQL fixtures. This is deliberately not a unit test of any single module:
 * it exists to catch wiring/integration bugs that unit tests with
 * hand-built fixtures cannot, such as a job_type with no worker handler, an
 * INSERT with a wrong placeholder count that only fires on a specific code
 * path, or a `0` numeric field silently becoming `null` between write and
 * verify.
 */
test('full pipeline: project creation through delivery bundle, via the live-wired functions', async () => {
  const actorId = 'e2e-actor';
  const project = createProject({ title: 'e2e-pipeline' });

  const research = createResearch(project.id, { topic: 'e2e topic', summary: 'facts', sources: [] });
  approveArtifact({ projectId: project.id, artifactType: 'research', artifactVersionId: research.id, actorId, approvalMode: 'human' });

  const script = createScriptVersion(project.id, 'e2e script content', actorId);
  approveArtifact({ projectId: project.id, artifactType: 'script', artifactVersionId: script.id, actorId, approvalMode: 'human' });

  const scene = createSceneVersion(project.id, { sourceScriptVersionId: script.id, sceneNumber: 1, narrationText: 'scene one narration' }, actorId);
  approveArtifact({ projectId: project.id, artifactType: 'scene', artifactVersionId: scene.id, actorId, approvalMode: 'human' });

  const narrationSnapshot = createNarrationSnapshot(project.id);
  const voiceover = createVoiceoverVersion(project.id, { narrationSnapshotId: narrationSnapshot.id, voiceModel: 'mock-voice', objectKey: 'voice/mock.mp3', durationMs: 4000 });
  approveArtifact({ projectId: project.id, artifactType: 'voiceover', artifactVersionId: voiceover.id, actorId, approvalMode: 'human' });

  const timestamps = createTimestampVersion(project.id, { voiceoverId: voiceover.id, mappings: [{ sceneId: scene.scene_id, startMs: 0, endMs: 4000 }] });
  approveArtifact({ projectId: project.id, artifactType: 'timestamp', artifactVersionId: timestamps.id, actorId, approvalMode: 'human' });

  const visual = createVisual({ projectId: project.id, sceneId: scene.scene_id, sourceSceneVersionId: scene.id, prompt: 'e2e prompt', actorId });
  const attempt = createGenerationAttempt({ projectId: project.id, visualVersionId: visual.id, provider: 'mock', model: 'mock-model' });
  const providerResult = await mockProvider.generateVisual({ attempt: { ...attempt.attempt, project_id: project.id } });
  const completedAttempt = completeGenerationAttempt({
    projectId: project.id, attemptId: attempt.attempt.id, objectKey: providerResult.objectKey,
    asset: providerResult.asset, license: providerResult.license, providerRequestId: providerResult.providerRequestId, costCents: 0
  });
  const assigned = assignAssetToVisual({ projectId: project.id, visualVersionId: visual.id, assetId: completedAttempt.result_asset_id, actorId });
  approveArtifact({ projectId: project.id, artifactType: 'visual', artifactVersionId: assigned.id, actorId, approvalMode: 'human' });
  selectVisual({ projectId: project.id, visualId: assigned.scene_visual_id, actorId });

  const timeline = buildTimeline(project.id, { actorId });
  assert.ok(timeline.id, 'timeline must build once every upstream stage is approved');
  approveArtifact({ projectId: project.id, artifactType: 'timeline', artifactVersionId: timeline.id, actorId, approvalMode: 'human' });

  const rough = buildRoughCut(project.id, { actorId });
  approveArtifact({ projectId: project.id, artifactType: 'rough_cut', artifactVersionId: rough.id, actorId, approvalMode: 'human' });

  const fine = buildFineCut(project.id, { actorId });
  approveArtifact({ projectId: project.id, artifactType: 'fine_cut', artifactVersionId: fine.id, actorId, approvalMode: 'human' });

  const renderRequest = requestFinalRender(project.id, { actorId });
  assert.equal(renderRequest.accepted, true, `render request should be accepted: ${JSON.stringify(renderRequest.gate?.errors)}`);
  assert.equal(renderRequest.job.status, 'queued');

  const claimed = claimProductionRenderJob('e2e-worker');
  assert.equal(claimed?.id, renderRequest.job.id, 'the job just enqueued must be the one claimed (FIFO, not LIFO)');

  const completed = await processProductionRenderJob(claimed, {});
  assert.equal(completed.status, 'completed');

  const outputAsset = db.prepare('SELECT * FROM scene_assets WHERE id=?').get(completed.output_asset_id);
  assert.equal(outputAsset.source_type, 'render');

  const genericJob = db.prepare(`SELECT status FROM jobs WHERE job_type='production_render' AND json_extract(payload_json,'$.productionRenderJobId')=?`).get(claimed.id);
  assert.equal(genericJob?.status, 'completed', 'the generic jobs mirror row must complete alongside the production_render_jobs row');

  const gate = verifyProductionPublishGate(project.id, completed.id);
  assert.equal(gate.ok, true, `publish gate should pass on a freshly completed render: ${gate.reason}`);

  const publish = publishProductionRender(project.id, completed.id, { actorId });
  assert.equal(publish.status, 'published');

  const release = createProductionRelease(project.id, completed.id, { actorId });
  assert.equal(release.status, 'active');
  assert.equal(release.release_number, 1);

  const manifest = createProductionDeliveryManifest(project.id, release.id, { actorId });
  assert.ok(manifest.id);

  const pkg = createProductionDeliveryPackage(project.id, release.id, { actorId });
  assert.equal(pkg.status, 'created');

  const bundle = createProductionDeliveryBundle(project.id, release.id, { actorId });
  assert.equal(bundle.status, 'created');
});

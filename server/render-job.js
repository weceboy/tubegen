/**
 * @deprecated Legacy pre-v3.4 render pipeline, kept only because
 * test/render-e2e.test.js still exercise it directly as a unit test.
 * Not reachable from server/index.js. Superseded by the production-* module
 * chain (production-snapshot.js -> production-manifest.js ->
 * production-render-control.js -> production-render-jobs.js ->
 * production-render-worker.js), which is what "npm run worker:render"
 * actually runs and what edit-stages.js's requestFinalRender() now calls
 * into. enqueueProductionRender({projectId, sceneVisualIds, actorId}) here is a different, incompatible function from production-render-jobs.js's enqueueProductionRender(projectId, snapshotId, opts) - same name, different signature, different queue model. This one was only ever called from the now-removed server/worker-runner.js and from test/render-e2e.test.js.
 * Safe to delete together with its test once nothing references it.
 */
import crypto from 'node:crypto';
import { db, enqueueJob } from './db.js';
import { assertProductionVisuals } from './render-gate.js';

export function enqueueProductionRender({ projectId, sceneVisualIds, actorId = 'system' }) {
  assertProductionVisuals(projectId, sceneVisualIds);
  const ids = [...sceneVisualIds].sort();
  const key = crypto.createHash('sha256').update(JSON.stringify({ projectId, sceneVisualIds: ids })).digest('hex');
  return enqueueJob({
    projectId,
    stage: 'render',
    jobType: 'production_render',
    payload: { scene_visual_ids: ids, actor_id: actorId },
    idempotencyKey: `render:${key}`
  });
}

export function getRenderJob(jobId) {
  return db.prepare("SELECT * FROM jobs WHERE id=? AND stage='render'").get(jobId);
}

/**
 * @deprecated Legacy pre-v3.4 render pipeline, kept only because
 * no test currently imports this module still exercise it directly as a unit test.
 * Not reachable from server/index.js. Superseded by the production-* module
 * chain (production-snapshot.js -> production-manifest.js ->
 * production-render-control.js -> production-render-jobs.js ->
 * production-render-worker.js), which is what "npm run worker:render"
 * actually runs and what edit-stages.js's requestFinalRender() now calls
 * into. requestFinalRender() here is superseded by edit-stages.js's requestFinalRender(), which is what server/index.js actually wires to POST /api/projects/:id/render. This module's export was never imported anywhere (verified: `grep -rn "render-service" --include="*.js" .` matches nothing else). Nothing wires job_type='final_render' from this file to a worker either.
 * Safe to delete together with its test once nothing references it.
 */
import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { checkFinalRenderGate } from './production-gate.js';
import { enqueueJob } from './queue.js';

/**
 * Creates a render job only after the complete dependency graph passes the
 * final gate. The actual provider call is intentionally performed by a
 * worker, never by the HTTP request.
 */
export function requestFinalRender(projectId, { priority = 'high', actorId = 'system' } = {}) {
  const gate = checkFinalRenderGate(projectId);
  if (!gate.allowed) {
    const error = new Error('Final render gate blocked');
    error.code = 'FINAL_RENDER_BLOCKED';
    error.details = gate.errors;
    throw error;
  }

  const snapshotId = `snapshot_${crypto.randomUUID()}`;
  const t = now();
  const job = enqueueJob({
    projectId,
    stage: 'edit',
    jobType: 'final_render',
    priority,
    payload: { requestedBy: actorId, snapshotId },
    inputVersionIds: []
  });

  tx(() => {
    db.prepare(`INSERT INTO audit_events
      (id,project_id,event_type,actor_type,actor_id,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(
        `audit_${crypto.randomUUID()}`,
        projectId,
        'final_render_requested',
        actorId === 'system' ? 'system' : 'human',
        actorId,
        JSON.stringify({ snapshot_id: snapshotId, job_id: job.job.id }),
        t
      );
  });

  return { gate, snapshotId, job };
}

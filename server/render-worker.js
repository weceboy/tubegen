/**
 * @deprecated Legacy pre-v3.4 render pipeline, kept only because
 * test/render-e2e.test.js still exercise it directly as a unit test.
 * Not reachable from server/index.js. Superseded by the production-* module
 * chain (production-snapshot.js -> production-manifest.js ->
 * production-render-control.js -> production-render-jobs.js ->
 * production-render-worker.js), which is what "npm run worker:render"
 * actually runs and what edit-stages.js's requestFinalRender() now calls
 * into. runProductionRender() processes job_type='production_render' jobs shaped by render-job.js above (payload.scene_visual_ids). production-render-jobs.js's processProductionRenderJob() is the canonical implementation now: it consumes persisted, hash-verified production snapshots instead of a raw scene-visual-id list, and is the one server/production-render-worker.js (npm run worker:render) actually runs.
 * Safe to delete together with its test once nothing references it.
 */
import { db } from './db.js';
import { assertProductionVisuals } from './render-gate.js';

export function runProductionRender(job) {
  const payload = JSON.parse(job.payload_json || '{}');
  const visuals = assertProductionVisuals(job.project_id, payload.scene_visual_ids);
  const snapshotId = `snapshot_${job.id}`;
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO production_snapshots(id, project_id, created_at, created_by) VALUES(?,?,?,?)')
      .run(snapshotId, job.project_id, new Date().toISOString(), payload.actor_id || 'worker');
    const insert = db.prepare(`INSERT OR IGNORE INTO production_snapshot_visuals(id,snapshot_id,scene_id,scene_visual_id,scene_visual_version_id,source_generation_attempt_id,source_asset_id) VALUES(?,?,?,?,?,?,?)`);
    for (const item of visuals) {
      const attempt = db.prepare('SELECT id FROM generation_attempts WHERE result_asset_id=? ORDER BY completed_at DESC LIMIT 1').get(item.asset.id);
      insert.run(`snapshot_visual_${snapshotId}_${item.visual.id}`, snapshotId, item.visual.scene_id, item.visual.id, item.version.id, attempt?.id || null, item.asset.id);
    }
  })();
  return { snapshot_id: snapshotId, visual_count: visuals.length };
}

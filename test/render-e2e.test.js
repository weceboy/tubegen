import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db.js';
import { enqueueProductionRender } from '../server/render-job.js';
import { runProductionRender } from '../server/render-worker.js';

test('production render creates a reproducible snapshot', () => {
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  if (!project) return;
  const visual = db.prepare("SELECT id FROM scene_visuals WHERE project_id=? AND selection_state='selected' LIMIT 1").get(project.id);
  if (!visual) return;
  const version = db.prepare("SELECT * FROM scene_visual_versions WHERE scene_visual_id=? ORDER BY version_number DESC LIMIT 1").get(visual.id);
  if (!version || version.status !== 'approved' || !version.source_asset_id) return;
  const license = db.prepare("SELECT id FROM asset_licenses WHERE asset_id=? AND license_status='verified'").get(version.source_asset_id);
  if (!license) return;
  const { job } = enqueueProductionRender({ projectId: project.id, sceneVisualIds: [visual.id] });
  const result = runProductionRender(job);
  const row = db.prepare('SELECT * FROM production_snapshot_visuals WHERE snapshot_id=?').get(result.snapshot_id);
  assert.equal(row.scene_visual_id, visual.id);
  assert.equal(row.scene_visual_version_id, version.id);
  assert.equal(row.source_asset_id, version.source_asset_id);
});

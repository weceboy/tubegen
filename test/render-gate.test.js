import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db.js';
import { assertVisualRenderable } from '../server/render-gate.js';

test('render gate rejects unselected visual', () => {
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  if (!project) return;
  const visual = db.prepare('SELECT id FROM scene_visuals WHERE project_id=? LIMIT 1').get(project.id);
  if (!visual) return;
  db.prepare("UPDATE scene_visuals SET selection_state='candidate' WHERE id=?").run(visual.id);
  assert.throws(() => assertVisualRenderable(project.id, visual.id), error => error.code === 'VISUAL_NOT_SELECTED');
});

test('render gate requires verified asset license', () => {
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  if (!project) return;
  const visual = db.prepare("SELECT id FROM scene_visuals WHERE project_id=? AND selection_state='selected' LIMIT 1").get(project.id);
  if (!visual) return;
  const version = db.prepare("SELECT * FROM scene_visual_versions WHERE scene_visual_id=? ORDER BY version_number DESC LIMIT 1").get(visual.id);
  if (!version || !version.source_asset_id || version.status !== 'approved') return;
  db.prepare('DELETE FROM asset_licenses WHERE asset_id=?').run(version.source_asset_id);
  assert.throws(() => assertVisualRenderable(project.id, visual.id), error => error.code === 'ASSET_LICENSE_INVALID');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../server/db.js';

test('production snapshot schema exists', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('production_snapshots','production_snapshot_visuals') ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables, ['production_snapshot_visuals', 'production_snapshots']);

  const columns = db.prepare('PRAGMA table_info(production_snapshot_visuals)').all().map(row => row.name);
  assert.deepEqual(columns, [
    'id', 'snapshot_id', 'scene_id', 'scene_visual_id', 'scene_visual_version_id',
    'source_generation_attempt_id', 'source_asset_id'
  ]);
});

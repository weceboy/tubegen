import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS production_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS production_snapshot_visuals (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES production_snapshots(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scenes(id),
  scene_visual_id TEXT NOT NULL REFERENCES scene_visuals(id),
  scene_visual_version_id TEXT NOT NULL REFERENCES scene_visual_versions(id),
  source_generation_attempt_id TEXT,
  source_asset_id TEXT NOT NULL REFERENCES scene_assets(id),
  UNIQUE(snapshot_id, scene_id)
);
CREATE INDEX IF NOT EXISTS idx_snapshot_project ON production_snapshots(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshot_visuals_snapshot ON production_snapshot_visuals(snapshot_id);
`);

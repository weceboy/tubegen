CREATE TABLE IF NOT EXISTS production_publishes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  render_job_id TEXT NOT NULL UNIQUE,
  output_asset_id TEXT NOT NULL,
  attestation_hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(render_job_id) REFERENCES production_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_production_publishes_project_time
  ON production_publishes(project_id, published_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'Default', target_duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_policies (
  id TEXT PRIMARY KEY, scope_type TEXT NOT NULL CHECK(scope_type IN ('project','channel','global')), scope_id TEXT NOT NULL,
  high_action TEXT, medium_action TEXT, low_action TEXT, blocked_action TEXT, policy_version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(scope_type, scope_id)
);
CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  change_type TEXT NOT NULL DEFAULT 'content', system_suggested_change_type TEXT NOT NULL DEFAULT 'content', topic TEXT NOT NULL, audience TEXT, angle TEXT,
  summary TEXT, target_length TEXT, tags_json TEXT NOT NULL DEFAULT '[]', internal_notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
  approval_mode TEXT NOT NULL DEFAULT 'human', risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY, research_artifact_id TEXT NOT NULL REFERENCES research_artifacts(id) ON DELETE CASCADE, url TEXT NOT NULL, title TEXT, publisher TEXT,
  verified INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '[]', internal_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS script_artifacts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS script_versions (
  id TEXT PRIMARY KEY, script_artifact_id TEXT NOT NULL REFERENCES script_artifacts(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_research_version_id TEXT NOT NULL REFERENCES research_artifacts(id), content TEXT NOT NULL, humanized INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human', risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE(script_artifact_id, version_number)
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, scene_number INTEGER NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(project_id, scene_number)
);
CREATE TABLE IF NOT EXISTS scene_versions (
  id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_script_version_id TEXT NOT NULL REFERENCES script_versions(id), narration_source TEXT NOT NULL DEFAULT 'script', narration_text TEXT NOT NULL,
  planned_duration_ms INTEGER, image_prompt TEXT, motion_prompt TEXT, status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human',
  risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT, UNIQUE(scene_id, version_number)
);
CREATE TABLE IF NOT EXISTS narration_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS narration_snapshot_items (
  id TEXT PRIMARY KEY, narration_snapshot_id TEXT NOT NULL REFERENCES narration_snapshots(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE, scene_version_id TEXT NOT NULL REFERENCES scene_versions(id), narration_text TEXT NOT NULL,
  UNIQUE(narration_snapshot_id, scene_id)
);
CREATE TABLE IF NOT EXISTS voiceovers (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  narration_snapshot_id TEXT NOT NULL REFERENCES narration_snapshots(id), voice_model TEXT NOT NULL, object_key TEXT NOT NULL, duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human', risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS timestamps (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_voiceover_id TEXT NOT NULL REFERENCES voiceovers(id), status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human',
  risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT, UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS timestamp_scene_mappings (
  id TEXT PRIMARY KEY, timestamp_id TEXT NOT NULL REFERENCES timestamps(id) ON DELETE CASCADE, scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  scene_version_id TEXT NOT NULL REFERENCES scene_versions(id), start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, confidence REAL, UNIQUE(timestamp_id, scene_id)
);
CREATE TABLE IF NOT EXISTS scene_visuals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  selection_state TEXT NOT NULL DEFAULT 'candidate' CHECK(selection_state IN ('candidate','selected','rejected')), created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS scene_assets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('generation_attempt','upload','stock','url','render')),
  source_generation_attempt_id TEXT REFERENCES generation_attempts(id), object_key TEXT NOT NULL, bucket TEXT,
  storage_provider TEXT NOT NULL DEFAULT 'local', checksum TEXT, mime_type TEXT, size INTEGER, width INTEGER, height INTEGER, duration_ms INTEGER,
  created_at TEXT NOT NULL, created_by TEXT
);
CREATE TABLE IF NOT EXISTS scene_visual_versions (
  id TEXT PRIMARY KEY, scene_visual_id TEXT NOT NULL REFERENCES scene_visuals(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_scene_version_id TEXT NOT NULL REFERENCES scene_versions(id), source_prompt TEXT, asset_type TEXT NOT NULL DEFAULT 'image', asset_source TEXT NOT NULL DEFAULT 'ai',
  source_asset_id TEXT REFERENCES scene_assets(id), status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human', risk_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, approved_at TEXT, UNIQUE(scene_visual_id, version_number)
);
CREATE TABLE IF NOT EXISTS generation_attempts (
  id TEXT PRIMARY KEY, visual_version_id TEXT NOT NULL REFERENCES scene_visual_versions(id) ON DELETE CASCADE, generation_index INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, parameters_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued',
  provider_request_id TEXT, result_asset_id TEXT REFERENCES scene_assets(id), cost_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TEXT, completed_at TEXT,
  UNIQUE(visual_version_id, generation_index), UNIQUE(idempotency_key)
);
CREATE TABLE IF NOT EXISTS asset_licenses (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES scene_assets(id) ON DELETE CASCADE, license_type TEXT, license_url TEXT,
  commercial_use INTEGER, attribution_required INTEGER, license_status TEXT NOT NULL DEFAULT 'pending', verified_at TEXT, verified_by TEXT
);
CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_scene_version_ids_json TEXT NOT NULL, source_voiceover_id TEXT NOT NULL REFERENCES voiceovers(id), source_timestamp_id TEXT NOT NULL REFERENCES timestamps(id),
  source_visual_version_ids_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human', risk_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, approved_at TEXT, UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS rough_cuts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_timeline_id TEXT NOT NULL REFERENCES timelines(id), object_key TEXT, status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human',
  risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS fine_cuts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version_number INTEGER NOT NULL,
  source_rough_cut_id TEXT NOT NULL REFERENCES rough_cuts(id), source_timeline_id TEXT NOT NULL REFERENCES timelines(id), object_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft', approval_mode TEXT NOT NULL DEFAULT 'human', risk_blocked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE(project_id, version_number)
);
CREATE TABLE IF NOT EXISTS risk_reports (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, artifact_type TEXT NOT NULL, artifact_version_id TEXT NOT NULL,
  risk_level TEXT NOT NULL, blocking INTEGER NOT NULL DEFAULT 0, findings_json TEXT NOT NULL DEFAULT '[]', policy_version TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_overrides (
  id TEXT PRIMARY KEY, artifact_version_id TEXT NOT NULL, risk_report_id TEXT NOT NULL REFERENCES risk_reports(id), finding_ids_json TEXT NOT NULL DEFAULT '[]',
  actor_id TEXT NOT NULL, reason TEXT NOT NULL, policy_version TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, event_type TEXT NOT NULL, actor_type TEXT NOT NULL DEFAULT 'system', actor_id TEXT,
  artifact_version_id TEXT, linked_risk_override_id TEXT REFERENCES risk_overrides(id), payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  entity_id TEXT, metadata TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage TEXT NOT NULL, job_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'queued', idempotency_key TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3, payload_json TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE(idempotency_key)
);
CREATE TABLE IF NOT EXISTS production_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, created_by TEXT
);
CREATE TABLE IF NOT EXISTS production_snapshot_visuals (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES production_snapshots(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scenes(id), scene_visual_id TEXT NOT NULL REFERENCES scene_visuals(id),
  scene_visual_version_id TEXT NOT NULL REFERENCES scene_visual_versions(id), source_generation_attempt_id TEXT REFERENCES generation_attempts(id),
  source_asset_id TEXT NOT NULL REFERENCES scene_assets(id), UNIQUE(snapshot_id, scene_id)
);
CREATE TABLE IF NOT EXISTS production_render_jobs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES production_snapshots(id) ON DELETE CASCADE, manifest_hash TEXT NOT NULL, plan_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')), worker_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, lease_expires_at TEXT,
  output_asset_id TEXT REFERENCES scene_assets(id), output_checksum TEXT, output_manifest_hash TEXT, output_lineage_hash TEXT,
  renderer_id TEXT, integrity_verified_at TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE(snapshot_id, plan_hash)
);
CREATE TABLE IF NOT EXISTS production_publishes (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, render_job_id TEXT NOT NULL,
  output_asset_id TEXT NOT NULL, attestation_hash TEXT NOT NULL, published_by TEXT NOT NULL, published_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published', UNIQUE(project_id, render_job_id)
);
CREATE TABLE IF NOT EXISTS production_releases (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  publish_id TEXT NOT NULL UNIQUE REFERENCES production_publishes(id), release_number INTEGER NOT NULL, manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT, revoke_reason TEXT,
  UNIQUE(project_id, release_number)
);
CREATE INDEX IF NOT EXISTS idx_production_publishes_project ON production_publishes(project_id, published_at);
CREATE INDEX IF NOT EXISTS idx_production_releases_project ON production_releases(project_id, release_number DESC);
CREATE INDEX IF NOT EXISTS idx_production_render_jobs_queue ON production_render_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_production_render_jobs_project ON production_render_jobs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scene_versions_scene ON scene_versions(scene_id, version_number);
CREATE INDEX IF NOT EXISTS idx_visual_versions_entity ON scene_visual_versions(scene_visual_id, version_number);
CREATE INDEX IF NOT EXISTS idx_scene_assets_attempt ON scene_assets(source_generation_attempt_id);
CREATE INDEX IF NOT EXISTS idx_risk_reports_artifact ON risk_reports(artifact_version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_risk_overrides_artifact ON risk_overrides(artifact_version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshot_project ON production_snapshots(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshot_visuals_snapshot ON production_snapshot_visuals(snapshot_id);
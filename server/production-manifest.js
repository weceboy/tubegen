import { db } from './db.js';
import { getPersistedProductionSnapshot, verifyPersistedProductionSnapshot } from './production-snapshot.js';
import { sha256 } from './hash.js';

const MANIFEST_VERSION = '1.0';

const hashManifest = sha256;

function projectFor(projectId) {
  const project = db.prepare('SELECT id,title,channel,target_duration_seconds,status,created_at,updated_at FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');
  return project;
}

function safeLineageRows(projectId, snapshotId) {
  return db.prepare(`
    SELECT psv.scene_id, psv.scene_visual_id, psv.scene_visual_version_id,
      psv.source_generation_attempt_id, psv.source_asset_id,
      vv.version_number AS visual_version_number, vv.source_scene_version_id,
      vv.source_prompt, vv.asset_type, vv.asset_source, vv.status AS visual_status, vv.approved_at,
      a.source_type AS asset_source_type, a.source_generation_attempt_id AS asset_generation_attempt_id,
      a.object_key, a.bucket, a.storage_provider, a.checksum, a.mime_type, a.size, a.width, a.height, a.duration_ms,
      l.license_status, l.license_type, l.license_url, l.commercial_use, l.attribution_required,
      ga.generation_index, ga.provider, ga.model, ga.parameters_json, ga.status AS attempt_status,
      ga.provider_request_id, ga.started_at AS attempt_started_at, ga.completed_at AS attempt_completed_at,
      ga.cost_cents AS attempt_cost_cents
    FROM production_snapshot_visuals psv
    JOIN scene_visual_versions vv ON vv.id=psv.scene_visual_version_id
    JOIN scene_assets a ON a.id=psv.source_asset_id
    LEFT JOIN asset_licenses l ON l.asset_id=a.id
    LEFT JOIN generation_attempts ga ON ga.id=psv.source_generation_attempt_id
    WHERE psv.snapshot_id=?
      AND EXISTS (SELECT 1 FROM scene_visuals v WHERE v.id=psv.scene_visual_id AND v.project_id=?)
    ORDER BY psv.scene_id
  `).all(snapshotId, projectId);
}

function normalizeRow(row) {
  let parameters = null;
  if (row.parameters_json) {
    try { parameters = JSON.parse(row.parameters_json); } catch { parameters = row.parameters_json; }
  }
  return {
    scene_id: row.scene_id,
    scene_visual_id: row.scene_visual_id,
    scene_visual_version_id: row.scene_visual_version_id,
    source_generation_attempt_id: row.source_generation_attempt_id || null,
    source_asset_id: row.source_asset_id,
    visual: { version_number: row.visual_version_number, source_scene_version_id: row.source_scene_version_id, source_prompt: row.source_prompt, asset_type: row.asset_type, asset_source: row.asset_source, status: row.visual_status, approved_at: row.approved_at },
    asset: {
      source_type: row.asset_source_type,
      source_generation_attempt_id: row.asset_generation_attempt_id || null,
      object_key: row.object_key, bucket: row.bucket, storage_provider: row.storage_provider,
      checksum: row.checksum, mime_type: row.mime_type, size: row.size, width: row.width, height: row.height, duration_ms: row.duration_ms,
      license: { status: row.license_status, type: row.license_type, url: row.license_url, commercial_use: row.commercial_use, attribution_required: row.attribution_required }
    },
    generation_attempt: row.source_generation_attempt_id ? {
      id: row.source_generation_attempt_id, generation_index: row.generation_index, provider: row.provider, model: row.model,
      parameters, status: row.attempt_status, provider_request_id: row.provider_request_id,
      started_at: row.attempt_started_at, completed_at: row.attempt_completed_at, cost_cents: row.attempt_cost_cents
    } : null
  };
}

export function buildProductionManifest(projectId, snapshotId) {
  const snapshot = getPersistedProductionSnapshot(projectId, snapshotId);
  if (!snapshot) throw new Error('Production snapshot not found');
  const rows = safeLineageRows(projectId, snapshotId);
  if (rows.length !== snapshot.visual_selections.length) throw new Error('Production snapshot lineage is incomplete');

  // Only immutable snapshot identity belongs in the manifest hash. status and
  // verified_at are mutable verification metadata and must never invalidate a
  // manifest that was already signed by its content hash.
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    project: projectFor(projectId),
    snapshot: { id: snapshot.id, created_at: snapshot.created_at, created_by: snapshot.created_by, snapshot_hash: snapshot.snapshot_hash },
    visual_selections: rows.map(normalizeRow)
  };
  return { ...manifest, manifest_hash: hashManifest(manifest) };
}

export function verifyProductionManifest(projectId, snapshotId, expectedManifestHash = null) {
  const snapshotVerification = verifyPersistedProductionSnapshot(projectId, snapshotId);
  const manifest = buildProductionManifest(projectId, snapshotId);
  const hashMatches = !expectedManifestHash || expectedManifestHash === manifest.manifest_hash;
  const integrityOk = snapshotVerification.status === 'valid' && hashMatches;
  return {
    ok: integrityOk,
    integrity_status: integrityOk ? 'verified' : 'failed',
    snapshot: snapshotVerification,
    manifest_hash: manifest.manifest_hash,
    expected_manifest_hash: expectedManifestHash,
    hash_matches: hashMatches
  };
}

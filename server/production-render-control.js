import { buildProductionManifest, verifyProductionManifest } from './production-manifest.js';
import { sha256 as hash } from './hash.js';

/**
 * Production render preflight.
 *
 * A renderer must consume a verified manifest, not live project state. This
 * function therefore verifies the persisted snapshot first and then creates a
 * deterministic render plan from that exact manifest. The plan is immutable
 * by convention: changing project selection requires a new snapshot/plan.
 */
export function prepareProductionRender(projectId, snapshotId, expectedManifestHash = null) {
  const verification = verifyProductionManifest(projectId, snapshotId, expectedManifestHash);
  if (!verification.ok) {
    const error = new Error('Production render preflight failed');
    error.code = 'PRODUCTION_RENDER_PREFLIGHT_FAILED';
    error.details = verification;
    throw error;
  }

  const manifest = buildProductionManifest(projectId, snapshotId);
  const renderInputs = manifest.visual_selections.map((selection) => ({
    scene_id: selection.scene_id,
    scene_visual_id: selection.scene_visual_id,
    scene_visual_version_id: selection.scene_visual_version_id,
    source_generation_attempt_id: selection.source_generation_attempt_id,
    source_asset_id: selection.source_asset_id,
    object_key: selection.asset.object_key,
    checksum: selection.asset.checksum,
    mime_type: selection.asset.mime_type,
    width: selection.asset.width,
    height: selection.asset.height,
    duration_ms: selection.asset.duration_ms
  }));

  const plan = {
    plan_version: '1.0',
    project_id: projectId,
    snapshot_id: snapshotId,
    manifest_hash: manifest.manifest_hash,
    render_inputs: renderInputs
  };

  return {
    ok: true,
    plan,
    plan_hash: hash(plan),
    verification
  };
}

export function assertProductionRenderReady(projectId, snapshotId, expectedManifestHash = null) {
  return prepareProductionRender(projectId, snapshotId, expectedManifestHash);
}

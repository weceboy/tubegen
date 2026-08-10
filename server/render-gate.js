/**
 * @deprecated Legacy pre-v3.4 render pipeline, kept only because
 * test/render-gate.test.js still exercise it directly as a unit test.
 * Not reachable from server/index.js. Superseded by the production-* module
 * chain (production-snapshot.js -> production-manifest.js ->
 * production-render-control.js -> production-render-jobs.js ->
 * production-render-worker.js), which is what "npm run worker:render"
 * actually runs and what edit-stages.js's requestFinalRender() now calls
 * into. assertVisualRenderable/assertProductionVisuals duplicate checks that now live in production-snapshot.js's gate() (per-scene visual/asset/license) and production-readiness.js (everything else). Still exercised directly by test/render-gate.test.js as a unit test of this module in isolation, but no longer reachable from server/index.js.
 * Safe to delete together with its test once nothing references it.
 */
import { db } from './db.js';

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

export function assertVisualRenderable(projectId, sceneVisualId) {
  const visual = db.prepare("SELECT * FROM scene_visuals WHERE id=? AND project_id=? AND deleted_at IS NULL").get(sceneVisualId, projectId);
  if (!visual) fail('VISUAL_NOT_FOUND', 'Visual not found');
  if (visual.selection_state !== 'selected') fail('VISUAL_NOT_SELECTED', 'Only selected visuals can enter the final render');

  const version = db.prepare(`SELECT * FROM scene_visual_versions WHERE scene_visual_id=? ORDER BY version_number DESC LIMIT 1`).get(sceneVisualId);
  if (!version) fail('VISUAL_VERSION_NOT_FOUND', 'Current visual version not found');
  if (version.status !== 'approved') fail('VISUAL_NOT_APPROVED', 'Current visual version must be approved');
  if (version.risk_blocked) fail('VISUAL_RISK_BLOCKED', 'Current visual version is risk blocked');
  if (!version.source_asset_id) fail('VISUAL_ASSET_MISSING', 'Current visual version has no source asset');

  const asset = db.prepare('SELECT * FROM scene_assets WHERE id=? AND project_id=?').get(version.source_asset_id, projectId);
  if (!asset) fail('ASSET_NOT_FOUND', 'Source asset not found');
  const license = db.prepare('SELECT * FROM asset_licenses WHERE asset_id=?').get(asset.id);
  if (!license || license.license_status !== 'verified') fail('ASSET_LICENSE_INVALID', 'Source asset license is not verified');

  return { visual, version, asset, license };
}

export function assertProductionVisuals(projectId, sceneVisualIds) {
  if (!Array.isArray(sceneVisualIds) || sceneVisualIds.length === 0) fail('NO_VISUALS', 'Production requires at least one visual');
  return sceneVisualIds.map(id => assertVisualRenderable(projectId, id));
}

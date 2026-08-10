import { db } from './db.js';

/**
 * Shared "is the whole production pipeline (Research..Fine Cut) approved and
 * current" check.
 *
 * This is deliberately a separate concern from `production-snapshot.js`'s
 * gate: that module answers a narrower question ("is the exact visual
 * lineage for every scene stable, approved and licensed?") because that is
 * exactly what gets hashed into the snapshot. This module answers the
 * broader question ("has every upstream stage been approved and is nothing
 * stale?") which the snapshot gate does not and should not check on its own.
 *
 * Both checks are required before a render is allowed:
 *   evaluateProductionReadiness()  -> Research..Fine Cut approval/staleness
 *   inspectProductionSnapshot()    -> per-scene visual lineage/license
 *
 * Callers that need "is this project renderable at all" should run both, not
 * just one. See production-gate.js and production-render-control.js.
 */

function fail(errors, code, message, context = {}) {
  errors.push({ code, message, ...context });
}

function currentResearch(projectId) {
  return db.prepare(`
    SELECT * FROM research_artifacts
    WHERE project_id=?
    ORDER BY version_number DESC LIMIT 1
  `).get(projectId);
}

function currentScript(projectId) {
  return db.prepare(`
    SELECT sv.* FROM script_versions sv
    JOIN script_artifacts sa ON sa.id=sv.script_artifact_id
    WHERE sa.project_id=?
    ORDER BY sv.version_number DESC LIMIT 1
  `).get(projectId);
}

/** Current (latest, non-superseded) version per scene. No approval filter -
 * that is checked separately below, per scene, with its own error code. */
export function currentSceneVersions(projectId) {
  return db.prepare(`
    SELECT s.id scene_id, sv.* FROM scenes s
    JOIN scene_versions sv ON sv.scene_id=s.id
    WHERE s.project_id=?
      AND sv.version_number=(SELECT MAX(x.version_number) FROM scene_versions x WHERE x.scene_id=s.id)
    ORDER BY s.scene_number
  `).all(projectId);
}

function currentVoiceover(projectId) {
  return db.prepare('SELECT * FROM voiceovers WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

function currentTimestamps(projectId) {
  return db.prepare('SELECT * FROM timestamps WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

function currentTimeline(projectId) {
  return db.prepare('SELECT * FROM timelines WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

function currentRoughCut(projectId) {
  return db.prepare('SELECT * FROM rough_cuts WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

function currentFineCut(projectId) {
  return db.prepare('SELECT * FROM fine_cuts WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

/**
 * Evaluates Research through Fine Cut for approval and staleness. Does NOT
 * evaluate per-scene visual/asset/license lineage - see module docstring.
 */
export function evaluateProductionReadiness(projectId) {
  const project = db.prepare('SELECT id FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');

  const errors = [];

  const research = currentResearch(projectId);
  if (!research) fail(errors, 'research_missing', 'Research is missing');
  else {
    if (research.status !== 'approved') fail(errors, 'research_not_approved', `Research is ${research.status}, not approved`, { researchId: research.id });
    if (research.risk_blocked) fail(errors, 'research_risk_blocked', 'Research has an active risk block', { researchId: research.id });
  }

  const script = currentScript(projectId);
  if (!script) fail(errors, 'script_missing', 'Script is missing');
  else {
    if (!research || script.source_research_version_id !== research.id) fail(errors, 'script_stale', 'Script is stale relative to current Research', { scriptVersionId: script.id });
    if (script.status !== 'approved') fail(errors, 'script_not_approved', `Script is ${script.status}, not approved`, { scriptVersionId: script.id });
    if (script.risk_blocked) fail(errors, 'script_risk_blocked', 'Script has an active risk block', { scriptVersionId: script.id });
  }

  const scenes = currentSceneVersions(projectId);
  if (!scenes.length) fail(errors, 'scenes_missing', 'No Scenes exist');
  for (const scene of scenes) {
    if (!script || scene.source_script_version_id !== script.id) fail(errors, 'scene_stale', `Scene ${scene.scene_number} is stale relative to current Script`, { sceneId: scene.scene_id });
    if (scene.status !== 'approved') fail(errors, 'scene_not_approved', `Scene ${scene.scene_number} is ${scene.status}, not approved`, { sceneId: scene.scene_id });
    if (scene.risk_blocked) fail(errors, 'scene_risk_blocked', `Scene ${scene.scene_number} has an active risk block`, { sceneId: scene.scene_id });
  }

  const voiceover = currentVoiceover(projectId);
  if (!voiceover) fail(errors, 'voiceover_missing', 'Voiceover is missing');
  else {
    const snapshot = db.prepare('SELECT * FROM narration_snapshots WHERE id=?').get(voiceover.narration_snapshot_id);
    if (!snapshot) fail(errors, 'voiceover_narration_snapshot_missing', 'Voiceover narration snapshot is missing', { voiceoverId: voiceover.id });
    if (voiceover.status !== 'approved') fail(errors, 'voiceover_not_approved', `Voiceover is ${voiceover.status}, not approved`, { voiceoverId: voiceover.id });
    if (voiceover.risk_blocked) fail(errors, 'voiceover_risk_blocked', 'Voiceover has an active risk block', { voiceoverId: voiceover.id });
  }

  const timestamps = currentTimestamps(projectId);
  if (!timestamps) fail(errors, 'timestamps_missing', 'Timestamps are missing');
  else {
    if (!voiceover || timestamps.source_voiceover_id !== voiceover.id) fail(errors, 'timestamps_stale', 'Timestamps are stale relative to current Voiceover', { timestampsId: timestamps.id });
    if (timestamps.status !== 'approved') fail(errors, 'timestamps_not_approved', `Timestamps are ${timestamps.status}, not approved`, { timestampsId: timestamps.id });
    if (timestamps.risk_blocked) fail(errors, 'timestamps_risk_blocked', 'Timestamps have an active risk block', { timestampsId: timestamps.id });

    const mappings = db.prepare('SELECT * FROM timestamp_scene_mappings WHERE timestamp_id=?').all(timestamps.id);
    const mapped = new Set(mappings.map((m) => `${m.scene_id}:${m.scene_version_id}`));
    for (const scene of scenes) {
      if (!mapped.has(`${scene.scene_id}:${scene.id}`)) fail(errors, 'timestamps_mapping_missing', `Scene ${scene.scene_number} has no timestamp mapping for its current version`, { sceneId: scene.scene_id });
    }
  }

  const timeline = currentTimeline(projectId);
  if (!timeline) fail(errors, 'timeline_missing', 'Timeline is missing');
  else {
    if (timeline.status !== 'approved') fail(errors, 'timeline_not_approved', `Timeline is ${timeline.status}, not approved`, { timelineId: timeline.id });
    if (!voiceover || timeline.source_voiceover_id !== voiceover.id) fail(errors, 'timeline_stale_voiceover', 'Timeline is stale relative to Voiceover', { timelineId: timeline.id });
    if (!timestamps || timeline.source_timestamp_id !== timestamps.id) fail(errors, 'timeline_stale_timestamps', 'Timeline is stale relative to Timestamps', { timelineId: timeline.id });
    const sourceScenes = JSON.parse(timeline.source_scene_version_ids_json || '[]');
    const currentSceneIds = scenes.map((s) => s.id).sort();
    if (JSON.stringify([...sourceScenes].sort()) !== JSON.stringify(currentSceneIds)) fail(errors, 'timeline_stale_scenes', 'Timeline is stale relative to current Scene versions', { timelineId: timeline.id });
  }

  const rough = currentRoughCut(projectId);
  if (!rough) fail(errors, 'rough_cut_missing', 'Rough Cut is missing');
  else {
    if (rough.status !== 'approved') fail(errors, 'rough_cut_not_approved', `Rough Cut is ${rough.status}, not approved`, { roughCutId: rough.id });
    if (!timeline || rough.source_timeline_id !== timeline.id) fail(errors, 'rough_cut_stale', 'Rough Cut is stale relative to Timeline', { roughCutId: rough.id });
  }

  const fine = currentFineCut(projectId);
  if (!fine) fail(errors, 'fine_cut_missing', 'Fine Cut is missing');
  else {
    if (fine.status !== 'approved') fail(errors, 'fine_cut_not_approved', `Fine Cut is ${fine.status}, not approved`, { fineCutId: fine.id });
    if (!rough || fine.source_rough_cut_id !== rough.id) fail(errors, 'fine_cut_stale_rough_cut', 'Fine Cut is stale relative to Rough Cut', { fineCutId: fine.id });
    if (!timeline || fine.source_timeline_id !== timeline.id) fail(errors, 'fine_cut_stale_timeline', 'Fine Cut is stale relative to Timeline', { fineCutId: fine.id });
  }

  const blocked = db.prepare(`SELECT COUNT(*) count FROM risk_reports WHERE project_id=? AND blocking=1`).get(projectId).count;
  if (blocked) fail(errors, 'blocking_risk_reports', `${blocked} blocking risk report(s) remain active`, { count: blocked });

  return { ok: errors.length === 0, errors, research, script, scenes, voiceover, timestamps, timeline, roughCut: rough, fineCut: fine };
}

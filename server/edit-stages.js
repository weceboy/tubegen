import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { currentSceneVersions, evaluateProductionReadiness } from './production-readiness.js';
import { inspectProductionSnapshot, getOrCreatePersistedProductionSnapshot } from './production-snapshot.js';
import { enqueueProductionRender } from './production-render-jobs.js';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const json = (v) => JSON.stringify(v ?? {});
const latest = (table, projectId) => db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY version_number DESC LIMIT 1`).get(projectId);

// Note: despite its former name, this never filtered by status='approved' -
// it returns each scene's current (highest) version regardless of approval
// state. Approval is checked separately, per scene, by callers below. See
// production-readiness.js for the canonical, correctly-named implementation.

function selectedVisuals(projectId) {
  return db.prepare(`SELECT v.id scene_visual_id,v.scene_id,v.selection_state,vv.id scene_visual_version_id,
      vv.version_number,vv.source_scene_version_id,vv.source_asset_id,vv.status,l.license_status,
      (SELECT ga.id FROM generation_attempts ga WHERE ga.result_asset_id=vv.source_asset_id LIMIT 1) source_generation_attempt_id
    FROM scene_visuals v JOIN scene_visual_versions vv ON vv.scene_visual_id=v.id
    LEFT JOIN scene_assets a ON a.id=vv.source_asset_id
    LEFT JOIN asset_licenses l ON l.asset_id=a.id
    WHERE v.project_id=? AND v.selection_state='selected'
      AND vv.version_number=(SELECT MAX(x.version_number) FROM scene_visual_versions x WHERE x.scene_visual_id=v.id)`).all(projectId);
}

function dependencyError(code, message, details = {}) { return { code, message, ...details }; }

function currentRiskBlocked(projectId) {
  const checks = [
    ['research_artifacts', `SELECT id FROM research_artifacts WHERE project_id=? ORDER BY version_number DESC LIMIT 1`],
    ['script_versions', `SELECT sv.id FROM script_versions sv JOIN script_artifacts sa ON sa.id=sv.script_artifact_id WHERE sa.project_id=? ORDER BY sv.version_number DESC LIMIT 1`],
    ['scene_versions', `SELECT sv.id FROM scene_versions sv JOIN scenes s ON s.id=sv.scene_id WHERE s.project_id=? AND sv.version_number=(SELECT MAX(x.version_number) FROM scene_versions x WHERE x.scene_id=s.id)`],
    ['voiceovers', `SELECT id FROM voiceovers WHERE project_id=? ORDER BY version_number DESC LIMIT 1`],
    ['timestamps', `SELECT id FROM timestamps WHERE project_id=? ORDER BY version_number DESC LIMIT 1`],
    ['scene_visual_versions', `SELECT vv.id FROM scene_visual_versions vv JOIN scene_visuals v ON v.id=vv.scene_visual_id WHERE v.project_id=? AND v.selection_state='selected' AND vv.version_number=(SELECT MAX(x.version_number) FROM scene_visual_versions x WHERE x.scene_visual_id=v.id)`],
    ['timelines', `SELECT id FROM timelines WHERE project_id=? ORDER BY version_number DESC LIMIT 1`],
    ['rough_cuts', `SELECT id FROM rough_cuts WHERE project_id=? ORDER BY version_number DESC LIMIT 1`],
    ['fine_cuts', `SELECT id FROM fine_cuts WHERE project_id=? ORDER BY version_number DESC LIMIT 1`]
  ];
  const blocked = [];
  for (const [table, query] of checks) {
    for (const row of db.prepare(query).all(projectId)) {
      const artifact = db.prepare(`SELECT id FROM ${table} WHERE id=? AND risk_blocked=1`).get(row.id);
      if (artifact) blocked.push({ table, artifactVersionId: row.id });
    }
  }
  return blocked;
}

export function buildTimeline(projectId, { actorId = 'human' } = {}) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');
  const research = db.prepare(`SELECT * FROM research_artifacts WHERE project_id=? ORDER BY version_number DESC LIMIT 1`).get(projectId);
  const script = db.prepare(`SELECT sv.* FROM script_versions sv JOIN script_artifacts sa ON sa.id=sv.script_artifact_id WHERE sa.project_id=? ORDER BY sv.version_number DESC LIMIT 1`).get(projectId);
  const scenes = currentSceneVersions(projectId).map(s => ({ scene_id: s.scene_id, scene_version_id: s.id, version_number: s.version_number }));
  const voice = latest('voiceovers', projectId);
  const timestamps = latest('timestamps', projectId);
  const visuals = selectedVisuals(projectId);
  const errors = [];
  if (!research || research.status !== 'approved') errors.push(dependencyError('research_not_approved','Research must be approved'));
  if (!script || script.status !== 'approved' || script.source_research_version_id !== research?.id) errors.push(dependencyError('script_not_current','Current approved script is required'));
  if (!scenes.length || scenes.some(s => !s.version_number)) errors.push(dependencyError('scenes_missing','At least one current scene is required'));
  if (scenes.some(s => db.prepare('SELECT status FROM scene_versions WHERE id=?').get(s.scene_version_id)?.status !== 'approved')) errors.push(dependencyError('scenes_not_approved','Every current scene version must be approved'));
  if (!voice || voice.status !== 'approved') errors.push(dependencyError('voiceover_not_approved','Approved voiceover is required'));
  if (!timestamps || timestamps.status !== 'approved' || timestamps.source_voiceover_id !== voice?.id) errors.push(dependencyError('timestamps_not_current','Current approved timestamps are required'));
  const mapped = new Set(db.prepare('SELECT scene_id FROM timestamp_scene_mappings WHERE timestamp_id=?').all(timestamps?.id || '').map(x => x.scene_id));
  if (scenes.some(s => !mapped.has(s.scene_id))) errors.push(dependencyError('scene_mapping_missing','Every current scene needs a timestamp mapping'));
  const visualByScene = new Map(visuals.map(v => [v.scene_id, v]));
  for (const s of scenes) {
    const v = visualByScene.get(s.scene_id);
    if (!v || v.status !== 'approved') errors.push(dependencyError('visual_not_approved','Selected current visual is not approved',{sceneId:s.scene_id}));
    else if (v.source_scene_version_id !== s.scene_version_id) errors.push(dependencyError('visual_stale','Selected visual references an old scene version',{sceneId:s.scene_id}));
    else if (!v.source_asset_id) errors.push(dependencyError('visual_asset_missing','Selected visual has no asset',{sceneId:s.scene_id}));
    else if (v.license_status !== 'verified') errors.push(dependencyError('license_not_verified','Selected visual asset has no verified license',{sceneId:s.scene_id,assetId:v.source_asset_id}));
  }
  const riskBlocked = currentRiskBlocked(projectId);
  if (riskBlocked.length) errors.push(dependencyError('risk_blocked','Relevant current artifact is still risk blocked',{artifacts:riskBlocked}));
  if (errors.length) return { ok:false, errors };
  const previous = latest('timelines', projectId);
  const version = (previous?.version_number || 0) + 1;
  const timelineId = id('timeline');
  const t = now();
  tx(() => {
    if (previous && previous.status !== 'stale') db.prepare(`UPDATE timelines SET status='superseded' WHERE id=?`).run(previous.id);
    db.prepare(`INSERT INTO timelines(id,project_id,version_number,source_scene_version_ids_json,source_voiceover_id,source_timestamp_id,source_visual_version_ids_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(timelineId,projectId,version,json(scenes.map(s=>s.scene_version_id)),voice.id,timestamps.id,json(visuals.filter(v=>visualByScene.has(v.scene_id)).map(v=>v.scene_visual_version_id)),'ready_for_review',t);
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'),projectId,'timeline_created',actorId==='system'?'system':'human',actorId,timelineId,json({source_scene_version_ids:scenes.map(s=>s.scene_version_id),source_voiceover_id:voice.id,source_timestamp_id:timestamps.id}),t);
  });
  return db.prepare('SELECT * FROM timelines WHERE id=?').get(timelineId);
}

export function buildRoughCut(projectId, { objectKey = null, actorId = 'system' } = {}) {
  const timeline = latest('timelines', projectId);
  if (!timeline || timeline.status !== 'approved') throw new Error('Approved current timeline is required for rough cut');
  const previous = latest('rough_cuts', projectId);
  const version = (previous?.version_number || 0) + 1;
  const cutId = id('rough'); const t = now();
  tx(() => {
    if (previous && previous.status !== 'stale') db.prepare(`UPDATE rough_cuts SET status='superseded' WHERE id=?`).run(previous.id);
    db.prepare(`INSERT INTO rough_cuts(id,project_id,version_number,source_timeline_id,object_key,status,created_at) VALUES(?,?,?,?,?,?,?)`).run(cutId,projectId,version,timeline.id,objectKey,'ready_for_review',t);
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'),projectId,'rough_cut_created',actorId==='system'?'system':'human',actorId,cutId,json({source_timeline_id:timeline.id}),t);
  });
  return db.prepare('SELECT * FROM rough_cuts WHERE id=?').get(cutId);
}

export function buildFineCut(projectId, { objectKey = null, actorId = 'system' } = {}) {
  const rough = latest('rough_cuts', projectId);
  const timeline = latest('timelines', projectId);
  if (!rough || rough.status !== 'approved') throw new Error('Approved current rough cut is required for fine cut');
  if (!timeline || timeline.status !== 'approved' || rough.source_timeline_id !== timeline.id) throw new Error('Rough cut must reference the current approved timeline');
  const previous = latest('fine_cuts', projectId);
  const version = (previous?.version_number || 0) + 1;
  const cutId = id('fine'); const t = now();
  tx(() => {
    if (previous && previous.status !== 'stale') db.prepare(`UPDATE fine_cuts SET status='superseded' WHERE id=?`).run(previous.id);
    db.prepare(`INSERT INTO fine_cuts(id,project_id,version_number,source_rough_cut_id,source_timeline_id,object_key,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(cutId,projectId,version,rough.id,timeline.id,objectKey,'ready_for_review',t);
    db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'),projectId,'fine_cut_created',actorId==='system'?'system':'human',actorId,cutId,json({source_rough_cut_id:rough.id,source_timeline_id:timeline.id}),t);
  });
  return db.prepare('SELECT * FROM fine_cuts WHERE id=?').get(cutId);
}

/**
 * Final render readiness gate.
 *
 * Delegates to the shared `evaluateProductionReadiness()` (Research..Fine
 * Cut approval/staleness, the same check used by production-gate.js) plus
 * `inspectProductionSnapshot()` (per-scene visual/asset/license lineage).
 * This used to be a fourth, independently maintained copy of the same
 * Research..Fine-Cut logic; see production-readiness.js for why that was a
 * problem.
 */
export function finalRenderGate(projectId) {
  const readiness = evaluateProductionReadiness(projectId);
  const snapshotCheck = inspectProductionSnapshot(projectId);
  const errors = [
    ...readiness.errors.map((e) => dependencyError(e.code, e.message, e)),
    ...snapshotCheck.errors.map((e) => dependencyError(e.code, e.message, e))
  ];
  return {
    ok: errors.length === 0,
    errors,
    sources: {
      researchId: readiness.research?.id,
      scriptId: readiness.script?.id,
      sceneVersionIds: readiness.scenes.map((s) => s.id),
      voiceoverId: readiness.voiceover?.id,
      timestampId: readiness.timestamps?.id,
      timelineId: readiness.timeline?.id,
      roughCutId: readiness.roughCut?.id,
      fineCutId: readiness.fineCut?.id,
      visualSelections: snapshotCheck.sources.visual_selections
    }
  };
}

/**
 * Requests a final render.
 *
 * This used to hand-insert a `job_type='final_render'` row into the generic
 * jobs table directly - a job type no worker was ever registered to handle
 * (see production-render-jobs.js / server/worker.js). It now goes through
 * the same persisted-snapshot -> manifest -> render-plan -> production
 * render job pipeline as everything else, so there is exactly one path from
 * "render requested" to "video produced".
 */
export function requestFinalRender(projectId, { actorId = 'human' } = {}) {
  const gate = finalRenderGate(projectId);
  if (!gate.ok) return { accepted: false, gate };
  const snapshot = getOrCreatePersistedProductionSnapshot(projectId, { createdBy: actorId });
  const { job, reused, plan } = enqueueProductionRender(projectId, snapshot.id, { createdBy: actorId });
  db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(id('audit'), projectId, 'final_render_requested', actorId === 'system' ? 'system' : 'human', actorId, json({ snapshot_id: snapshot.id, production_render_job_id: job.id, reused }), now());
  return { accepted: true, reused, gate, snapshot, job, plan };
}

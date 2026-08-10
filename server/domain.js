import crypto from 'node:crypto';
import { db, now, tx } from './db.js';

export const STATES = ['draft','processing','ready_for_review','approved','rejected','stale','superseded','failed'];
export const STAGES = ['research','script','scenes','voiceover','timestamps','visuals','edit'];
export const APPROVAL_MODES = ['automatic','human','manual_confirmation'];

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const json = (value) => JSON.stringify(value ?? {});

export function assertState(state) {
  if (!STATES.includes(state)) throw new Error(`Invalid artifact state: ${state}`);
}

function assertApprovalMode(mode) {
  if (!APPROVAL_MODES.includes(mode)) throw new Error(`Invalid approval mode: ${mode}`);
}

export function createProject({ title, channel = 'Default', targetDurationSeconds = null }) {
  const projectId = id('proj');
  const t = now();
  tx(() => {
    db.prepare(`INSERT INTO projects(id,title,channel,target_duration_seconds,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(projectId, title, channel, targetDurationSeconds, 'draft', t, t);
    db.prepare(`INSERT INTO script_artifacts(id,project_id,created_at) VALUES(?,?,?)`).run(id('script'), projectId, t);
  });
  return db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
}

export function updateProject(projectId, { title, channel, targetDurationSeconds, status } = {}) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');
  if (status !== undefined && !['draft', 'in_production', 'archived'].includes(status)) throw new Error(`Invalid status: ${status}`);
  db.prepare(`UPDATE projects SET title=?,channel=?,target_duration_seconds=?,status=?,updated_at=? WHERE id=?`).run(
    title !== undefined ? title : project.title,
    channel !== undefined ? channel : project.channel,
    targetDurationSeconds !== undefined ? targetDurationSeconds : project.target_duration_seconds,
    status !== undefined ? status : project.status,
    now(), projectId
  );
  return db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
}

export function latestResearch(projectId) {
  return db.prepare('SELECT * FROM research_artifacts WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId);
}

function sourceRows(researchId) {
  return db.prepare('SELECT * FROM research_sources WHERE research_artifact_id=? ORDER BY url, id').all(researchId);
}

function normalizeTags(value) {
  if (Array.isArray(value)) return [...value].map(String).sort();
  if (typeof value === 'string' && value.trim()) return value.split(',').map(x => x.trim()).filter(Boolean).sort();
  return [];
}

function countByUrl(rows) {
  const counts = new Map();
  for (const row of rows) {
    const url = String(row.url || '').trim();
    counts.set(url, (counts.get(url) || 0) + 1);
  }
  return counts;
}

function classifyResearchChange(previous, input) {
  if (!previous) return 'content';

  const previousSources = sourceRows(previous.id);
  const nextSources = input.sources || [];
  const contentChanged = (previous.topic || '') !== (input.topic || '')
    || (previous.summary || '') !== (input.summary || '')
    || (previous.angle || '') !== (input.angle || '')
    || (previous.audience || '') !== (input.audience || '')
    || (previous.target_length || '') !== (input.targetLength || '')
    || sourceContentChanged(previousSources, nextSources);
  const metadataChanged = (previous.tags_json || '[]') !== JSON.stringify(normalizeTags(input.tags))
    || (previous.internal_notes || '') !== (input.internalNotes || '')
    || sourceMetadataChanged(previousSources, nextSources);

  if (contentChanged && metadataChanged) return 'mixed';
  if (contentChanged) return 'content';
  if (metadataChanged) return 'metadata';

  const allowed = new Set(['topic','audience','angle','summary','targetLength','sources','tags','internalNotes','actorId','changeType','downgradeReason']);
  if (Object.keys(input).some(key => !allowed.has(key))) return 'content';
  return 'metadata';
}

function sourceContentChanged(previous, next) {
  const previousCounts = countByUrl(previous);
  const nextCounts = countByUrl(next);
  const previousByUrl = new Map(previous.map(s => [String(s.url || '').trim(), s]));
  const nextByUrl = new Map(next.map(s => [String(s.url || '').trim(), s]));
  const allowedSourceFields = new Set(['url','title','publisher','verified','tags','internalNotes']);

  // Adding or removing a source URL is substantive content when the URL is
  // introduced or removed entirely. A duplicate of an already-present source
  // is metadata-only and is handled by sourceMetadataChanged below.
  const urls = new Set([...previousCounts.keys(), ...nextCounts.keys()]);
  for (const url of urls) {
    const oldCount = previousCounts.get(url) || 0;
    const newCount = nextCounts.get(url) || 0;
    if ((oldCount === 0) !== (newCount === 0)) return true;
  }

  for (const [url, old] of previousByUrl) {
    const current = nextByUrl.get(url);
    if (!current) continue;
    if (Boolean(old.verified) !== Boolean(current.verified)) return true;
    if (Object.keys(current).some(key => !allowedSourceFields.has(key))) return true;
  }
  for (const current of next) {
    if (Object.keys(current).some(key => !allowedSourceFields.has(key))) return true;
  }
  return false;
}

function sourceMetadataChanged(previous, next) {
  const previousCounts = countByUrl(previous);
  const nextCounts = countByUrl(next);
  const previousByUrl = new Map(previous.map(s => [String(s.url || '').trim(), s]));
  const nextByUrl = new Map(next.map(s => [String(s.url || '').trim(), s]));

  const urls = new Set([...previousCounts.keys(), ...nextCounts.keys()]);
  for (const url of urls) {
    const oldCount = previousCounts.get(url) || 0;
    const newCount = nextCounts.get(url) || 0;
    if (oldCount > 0 && newCount > 0 && oldCount !== newCount) return true;
  }

  for (const [url, current] of nextByUrl) {
    const old = previousByUrl.get(url);
    if (!old) continue;
    if ((old.title || '') !== (current.title || '') || (old.publisher || '') !== (current.publisher || '')
      || (old.tags_json || '[]') !== JSON.stringify(normalizeTags(current.tags))
      || (old.internal_notes || '') !== (current.internalNotes || '')) return true;
  }
  for (const [url] of previousByUrl) {
    if (!nextByUrl.has(url) && previous.filter(s => String(s.url || '').trim() === url).length > 1) return true;
  }
  return false;
}

export function createResearch(projectId, input) {
  const previous = latestResearch(projectId); const version = (previous?.version_number || 0) + 1; const suggested = classifyResearchChange(previous, input); const requested = input.changeType || suggested;
  if (!['metadata','content','mixed'].includes(requested)) throw new Error(`Invalid change_type: ${requested}`);
  if (suggested === 'mixed' && requested === 'metadata') throw new Error('A mixed change cannot be downgraded to metadata');
  if ((suggested === 'content' || suggested === 'mixed') && requested === 'metadata' && !input.downgradeReason?.trim()) throw new Error('A content→metadata downgrade requires a reason');
  const researchId = id('research'); const t = now();
  tx(() => {
    if (previous) db.prepare(`UPDATE research_artifacts SET status='superseded' WHERE id=?`).run(previous.id);
    db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,audience,angle,summary,target_length,tags_json,internal_notes,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, version, requested, suggested, input.topic, input.audience || '', input.angle || '', input.summary || '', input.targetLength || '', JSON.stringify(normalizeTags(input.tags)), input.internalNotes || '', 'ready_for_review', t);
    for (const source of input.sources || []) db.prepare(`INSERT INTO research_sources(id,research_artifact_id,url,title,publisher,verified,tags_json,internal_notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('source'), researchId, source.url, source.title || null, source.publisher || null, source.verified ? 1 : 0, JSON.stringify(normalizeTags(source.tags)), source.internalNotes || '', t);
    if (suggested !== requested) db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'change_type_downgraded', 'human', input.actorId || 'unknown', researchId, JSON.stringify({ system_suggested_change_type: suggested, final_change_type: requested, reason: input.downgradeReason }), t);
    if (requested !== 'metadata') invalidateDownstreamFromResearch(projectId, researchId);
  });
  return db.prepare('SELECT * FROM research_artifacts WHERE id=?').get(researchId);
}

function invalidateDownstreamFromResearch(projectId, researchId) {
  db.prepare(`UPDATE script_versions SET status='stale' WHERE script_artifact_id IN (SELECT id FROM script_artifacts WHERE project_id=?) AND source_research_version_id <> ? AND status NOT IN ('superseded','stale')`).run(projectId, researchId);
  const scriptIds = db.prepare(`SELECT id FROM script_versions WHERE script_artifact_id IN (SELECT id FROM script_artifacts WHERE project_id=?) AND status='stale'`).all(projectId).map(x => x.id); if (!scriptIds.length) return;
  const marks = scriptIds.map(() => '?').join(','); const scenes = db.prepare(`SELECT id FROM scene_versions WHERE source_script_version_id IN (${marks})`).all(...scriptIds).map(x => x.id);
  if (scenes.length) { const m = scenes.map(() => '?').join(','); db.prepare(`UPDATE scene_versions SET status='stale' WHERE id IN (${m}) AND status NOT IN ('superseded','stale')`).run(...scenes); }
  db.prepare(`UPDATE voiceovers SET status='stale' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
  db.prepare(`UPDATE timestamps SET status='stale' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
  db.prepare(`UPDATE scene_visual_versions SET status='stale' WHERE scene_visual_id IN (SELECT id FROM scene_visuals WHERE project_id=?) AND status NOT IN ('superseded','stale')`).run(projectId);
  db.prepare(`UPDATE timelines SET status='stale' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
  db.prepare(`UPDATE rough_cuts SET status='stale' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
  db.prepare(`UPDATE fine_cuts SET status='stale' WHERE project_id=? AND status NOT IN ('superseded','stale')`).run(projectId);
}

export function createScriptVersion(projectId, content, actorId = 'system') {
  const research = latestResearch(projectId); if (!research || research.status !== 'approved') throw new Error('Approved research is required before script generation');
  const scriptArtifact = db.prepare('SELECT * FROM script_artifacts WHERE project_id=?').get(projectId); const previous = db.prepare('SELECT * FROM script_versions WHERE script_artifact_id=? ORDER BY version_number DESC LIMIT 1').get(scriptArtifact.id); const version = (previous?.version_number || 0) + 1; const scriptId = id('scriptv'); const t = now();
  tx(() => { if (previous) db.prepare(`UPDATE script_versions SET status='superseded' WHERE id=?`).run(previous.id); db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,created_at) VALUES(?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, version, research.id, content, 'ready_for_review', t); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'script_version_created', 'system', actorId, scriptId, '{}', t); });
  return db.prepare('SELECT * FROM script_versions WHERE id=?').get(scriptId);
}

function tableFor(type) { const map = { research:'research_artifacts', script:'script_versions', scene:'scene_versions', voiceover:'voiceovers', timestamp:'timestamps', visual:'scene_visual_versions', timeline:'timelines', rough_cut:'rough_cuts', fine_cut:'fine_cuts' }; if (!map[type]) throw new Error(`Unsupported artifact type: ${type}`); return map[type]; }
function inferArtifactTable(idValue) { for (const table of ['research_artifacts','script_versions','scene_versions','voiceovers','timestamps','scene_visual_versions','timelines','rough_cuts','fine_cuts']) if (db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(idValue)) return table; return null; }
function latestRiskOverride(artifactVersionId) { return db.prepare('SELECT * FROM risk_overrides WHERE artifact_version_id=? ORDER BY created_at DESC LIMIT 1').get(artifactVersionId); }
function riskForArtifact(artifactVersionId, projectId) { return db.prepare('SELECT * FROM risk_reports WHERE artifact_version_id=? AND project_id=? ORDER BY created_at DESC LIMIT 1').get(artifactVersionId, projectId); }

export function approveArtifact({ projectId, artifactType, artifactVersionId, actorId, approvalMode = 'human', linkedRiskOverrideId = null }) {
  const table = tableFor(artifactType); const artifact = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(artifactVersionId); if (!artifact) throw new Error('Artifact version not found'); assertApprovalMode(approvalMode);
  if (artifact.risk_blocked) throw new Error('Risk block must be overridden before approval'); const override = latestRiskOverride(artifactVersionId); const risk = riskForArtifact(artifactVersionId, projectId);
  if (override && approvalMode !== 'human') throw new Error('Approval after risk override must be human'); if (override && linkedRiskOverrideId !== override.id) throw new Error('Approval after risk override must link the active risk override'); if (!override && risk?.risk_level === 'high' && approvalMode === 'automatic') throw new Error('Automatic approval is forbidden for high risk artifacts');
  if (linkedRiskOverrideId && !db.prepare('SELECT 1 FROM risk_overrides WHERE id=? AND artifact_version_id=?').get(linkedRiskOverrideId, artifactVersionId)) throw new Error('Invalid linked risk override');
  const t = now(); tx(() => { db.prepare(`UPDATE ${table} SET status='approved',approval_mode=?,approved_at=? WHERE id=?`).run(approvalMode, t, artifactVersionId); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,linked_risk_override_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'artifact_approved', approvalMode === 'human' ? 'human' : 'automation_policy', actorId || null, artifactVersionId, linkedRiskOverrideId, JSON.stringify({ approval_mode: approvalMode }), t); });
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(artifactVersionId);
}

export function applyRiskOverride({ projectId, artifactVersionId, riskReportId, actorId, reason, findingIds = [], policyVersion = null }) {
  if (!actorId?.trim()) throw new Error('Risk override requires a human actor');
  if (!reason?.trim()) throw new Error('Risk override requires a reason');
  const table = inferArtifactTable(artifactVersionId); if (!table) throw new Error('Artifact version not found'); const artifact = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(artifactVersionId); if (!artifact.risk_blocked) throw new Error('Risk override requires an active risk block');
  const report = db.prepare('SELECT * FROM risk_reports WHERE id=? AND project_id=? AND artifact_version_id=?').get(riskReportId, projectId, artifactVersionId); if (!report) throw new Error('Risk report does not belong to artifact version');
  const overrideId = id('override'); const t = now(); tx(() => { db.prepare(`INSERT INTO risk_overrides(id,artifact_version_id,risk_report_id,finding_ids_json,actor_id,reason,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(overrideId, artifactVersionId, riskReportId, JSON.stringify(findingIds), actorId, reason, policyVersion, t); db.prepare(`UPDATE ${table} SET risk_blocked=0,status='ready_for_review',approval_mode='human' WHERE id=?`).run(artifactVersionId); db.prepare(`UPDATE risk_reports SET blocking=0 WHERE id=?`).run(riskReportId); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'risk_override', 'human', actorId, artifactVersionId, JSON.stringify({ risk_report_id: riskReportId, reason }), t); });
  return db.prepare('SELECT * FROM risk_overrides WHERE id=?').get(overrideId);
}

export function generationKey({ projectId, stage, inputArtifactVersions, provider, model, parameters, generationIndex }) { return crypto.createHash('sha256').update(JSON.stringify({ projectId, stage, inputArtifactVersions, provider, model, parameters, generationIndex })).digest('hex'); }

export function createVisual({ projectId, sceneId, sourceSceneVersionId, prompt, assetType = 'image', assetSource = 'ai', actorId = 'system' }) {
  const scene = db.prepare('SELECT * FROM scenes WHERE id=? AND project_id=?').get(sceneId, projectId); const sceneVersion = db.prepare('SELECT * FROM scene_versions WHERE id=? AND scene_id=?').get(sourceSceneVersionId, sceneId); if (!scene || !sceneVersion) throw new Error('Scene or scene version not found');
  const visualId = id('visual'); const versionId = id('visualv'); const t = now(); tx(() => { db.prepare(`INSERT INTO scene_visuals(id,project_id,scene_id,selection_state,created_at) VALUES(?,?,?,?,?)`).run(visualId, projectId, sceneId, 'candidate', t); db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,source_prompt,asset_type,asset_source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(versionId, visualId, 1, sourceSceneVersionId, prompt || '', assetType, assetSource, 'draft', t); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'visual_created', actorId === 'system' ? 'system' : 'human', actorId, versionId, json({ visual_id: visualId }), t); });
  return db.prepare('SELECT * FROM scene_visual_versions WHERE id=?').get(versionId);
}

export function createVisualVersion({ projectId, visualId, sourceSceneVersionId, prompt, assetType = 'image', assetSource = 'ai', actorId = 'system' }) {
  const visual = db.prepare('SELECT * FROM scene_visuals WHERE id=? AND project_id=? AND deleted_at IS NULL').get(visualId, projectId); const sceneVersion = db.prepare('SELECT * FROM scene_versions WHERE id=? AND scene_id=?').get(sourceSceneVersionId, visual?.scene_id); if (!visual || !sceneVersion) throw new Error('Visual or scene version not found');
  const previous = db.prepare('SELECT * FROM scene_visual_versions WHERE scene_visual_id=? ORDER BY version_number DESC LIMIT 1').get(visualId); const nextPrompt = prompt ?? previous?.source_prompt ?? '';
  if (previous && nextPrompt === previous.source_prompt && sourceSceneVersionId === previous.source_scene_version_id) throw new Error('Identical prompt and scene version require a new generation attempt, not a visual version');
  const version = (previous?.version_number || 0) + 1; const versionId = id('visualv'); const t = now(); tx(() => { db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,source_prompt,asset_type,asset_source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(versionId, visualId, version, sourceSceneVersionId, nextPrompt, assetType, assetSource, 'draft', t); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'visual_version_created', actorId === 'system' ? 'system' : 'human', actorId, versionId, json({ visual_id: visualId, source_scene_version_id: sourceSceneVersionId }), t); });
  return db.prepare('SELECT * FROM scene_visual_versions WHERE id=?').get(versionId);
}

export function selectVisual({ projectId, visualId, actorId = 'system' }) {
  const visual = db.prepare('SELECT * FROM scene_visuals WHERE id=? AND project_id=? AND deleted_at IS NULL').get(visualId, projectId); if (!visual) throw new Error('Visual not found'); const t = now();
  tx(() => { db.prepare(`UPDATE scene_visuals SET selection_state='candidate' WHERE project_id=? AND scene_id=? AND selection_state='selected'`).run(projectId, visual.scene_id); db.prepare(`UPDATE scene_visuals SET selection_state='selected' WHERE id=?`).run(visualId); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'visual_selected', actorId === 'system' ? 'system' : 'human', actorId, JSON.stringify({ visual_id: visualId }), t); });
  return db.prepare('SELECT * FROM scene_visuals WHERE id=?').get(visualId);
}

export function rejectVisual({ projectId, visualId, actorId = 'system' }) {
  const visual = db.prepare('SELECT * FROM scene_visuals WHERE id=? AND project_id=?').get(visualId, projectId); if (!visual) throw new Error('Visual not found'); const t = now();
  tx(() => { db.prepare(`UPDATE scene_visuals SET selection_state='rejected' WHERE id=?`).run(visualId); db.prepare(`UPDATE scene_visual_versions SET status='rejected' WHERE scene_visual_id=? AND status NOT IN ('superseded','stale')`).run(visualId); db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'visual_rejected', actorId === 'system' ? 'system' : 'human', actorId, JSON.stringify({ visual_id: visualId }), t); });
  return db.prepare('SELECT * FROM scene_visuals WHERE id=?').get(visualId);
}

export function createSceneAsset({ projectId, sourceType, objectKey, bucket = null, storageProvider = 'local', checksum = null, mimeType = null, size = null, width = null, height = null, durationMs = null, createdBy = 'system', license = {}, sourceGenerationAttemptId = null }) {
  if (!['generation_attempt','upload','stock','url'].includes(sourceType)) throw new Error('Invalid asset source type'); if (!objectKey?.trim()) throw new Error('Asset objectKey is required');
  if (sourceType === 'generation_attempt' && !sourceGenerationAttemptId) throw new Error('Generation assets require source_generation_attempt_id');
  if (sourceType !== 'generation_attempt' && sourceGenerationAttemptId) throw new Error('Only generation assets may reference an attempt');
  const assetId = id('asset'); const t = now();
  tx(() => {
    if (sourceGenerationAttemptId) {
      const attempt = db.prepare(`SELECT ga.id, v.project_id FROM generation_attempts ga JOIN scene_visual_versions vv ON vv.id=ga.visual_version_id JOIN scene_visuals v ON v.id=vv.scene_visual_id WHERE ga.id=?`).get(sourceGenerationAttemptId);
      if (!attempt || attempt.project_id !== projectId) throw new Error('Generation attempt does not belong to project');
    }
    db.prepare(`INSERT INTO scene_assets(id,project_id,source_type,source_generation_attempt_id,object_key,bucket,storage_provider,checksum,mime_type,size,width,height,duration_ms,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(assetId, projectId, sourceType, sourceGenerationAttemptId, objectKey, bucket, storageProvider, checksum, mimeType, size, width, height, durationMs, t, createdBy);
    db.prepare(`INSERT INTO asset_licenses(id,asset_id,license_type,license_url,commercial_use,attribution_required,license_status,verified_at,verified_by) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('license'), assetId, license.type || null, license.url || null, license.commercialUse == null ? null : license.commercialUse ? 1 : 0, license.attributionRequired == null ? null : license.attributionRequired ? 1 : 0, license.status || 'pending', license.verifiedAt || null, license.verifiedBy || null);
  });
  return db.prepare(`SELECT a.*, l.license_status, l.license_type, l.license_url, l.commercial_use, l.attribution_required FROM scene_assets a JOIN asset_licenses l ON l.asset_id=a.id WHERE a.id=?`).get(assetId);
}

export function completeGenerationAttempt({ projectId, attemptId, objectKey, asset = {}, license = {}, providerRequestId = null, costCents = 0 }) {
  const attempt = db.prepare(`SELECT ga.*, sv.scene_visual_id, v.project_id FROM generation_attempts ga JOIN scene_visual_versions sv ON sv.id=ga.visual_version_id JOIN scene_visuals v ON v.id=sv.scene_visual_id WHERE ga.id=? AND v.project_id=?`).get(attemptId, projectId);
  if (!attempt) throw new Error('Generation attempt not found');
  if (attempt.status === 'completed' && attempt.result_asset_id) return db.prepare('SELECT * FROM generation_attempts WHERE id=?').get(attemptId);
  if (!objectKey?.trim()) throw new Error('Completed generation requires an objectKey');
  return tx(() => {
    const locked = db.prepare(`SELECT ga.*, sv.scene_visual_id, v.project_id FROM generation_attempts ga JOIN scene_visual_versions sv ON sv.id=ga.visual_version_id JOIN scene_visuals v ON v.id=sv.scene_visual_id WHERE ga.id=? AND v.project_id=?`).get(attemptId, projectId);
    if (!locked) throw new Error('Generation attempt not found');
    if (locked.status === 'completed' && locked.result_asset_id) return locked;
    const existingAsset = db.prepare('SELECT * FROM scene_assets WHERE source_generation_attempt_id=?').get(attemptId);
    if (existingAsset) {
      db.prepare(`UPDATE generation_attempts SET status='completed',result_asset_id=?,provider_request_id=COALESCE(?,provider_request_id),cost_cents=?,completed_at=COALESCE(completed_at,?) WHERE id=?`).run(existingAsset.id, providerRequestId, costCents, now(), attemptId);
      db.prepare(`UPDATE scene_visual_versions SET source_asset_id=?,status='ready_for_review' WHERE id=?`).run(existingAsset.id, locked.visual_version_id);
      return db.prepare('SELECT * FROM generation_attempts WHERE id=?').get(attemptId);
    }
    const assetId = id('asset'); const t = now();
    db.prepare(`INSERT INTO scene_assets(id,project_id,source_type,source_generation_attempt_id,object_key,bucket,storage_provider,checksum,mime_type,size,width,height,duration_ms,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(assetId, projectId, 'generation_attempt', attemptId, objectKey, asset.bucket || null, asset.storageProvider || 'local', asset.checksum || null, asset.mimeType || null, asset.size ?? null, asset.width ?? null, asset.height ?? null, asset.durationMs ?? null, t, 'generation');
    db.prepare(`INSERT INTO asset_licenses(id,asset_id,license_type,license_url,commercial_use,attribution_required,license_status,verified_at,verified_by) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('license'), assetId, license.type || null, license.url || null, license.commercialUse == null ? null : license.commercialUse ? 1 : 0, license.attributionRequired == null ? null : license.attributionRequired ? 1 : 0, license.status || 'pending', license.verifiedAt || null, license.verifiedBy || null);
    db.prepare(`UPDATE generation_attempts SET status='completed',result_asset_id=?,provider_request_id=?,cost_cents=?,completed_at=? WHERE id=?`).run(assetId, providerRequestId, costCents, t, attemptId);
    db.prepare(`UPDATE scene_visual_versions SET source_asset_id=?,status='ready_for_review' WHERE id=?`).run(assetId, locked.visual_version_id);
    return db.prepare('SELECT * FROM generation_attempts WHERE id=?').get(attemptId);
  });
}

export function assignAssetToVisual({ projectId, visualVersionId, assetId, actorId = 'human' }) {
  const visual = db.prepare(`SELECT vv.* FROM scene_visual_versions vv JOIN scene_visuals v ON v.id=vv.scene_visual_id WHERE vv.id=? AND v.project_id=?`).get(visualVersionId, projectId); const asset = db.prepare('SELECT * FROM scene_assets WHERE id=? AND project_id=?').get(assetId, projectId); if (!visual || !asset) throw new Error('Visual version or asset not found');
  if (asset.source_type === 'generation_attempt' && !asset.source_generation_attempt_id) throw new Error('Generation asset provenance is incomplete');
  db.prepare(`UPDATE scene_visual_versions SET source_asset_id=?,status='ready_for_review' WHERE id=?`).run(assetId, visualVersionId);
  db.prepare(`INSERT INTO audit_events(id,project_id,event_type,actor_type,actor_id,artifact_version_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('audit'), projectId, 'visual_asset_assigned', actorId === 'system' ? 'system' : 'human', actorId, visualVersionId, json({ asset_id: assetId }), now());
  return db.prepare('SELECT * FROM scene_visual_versions WHERE id=?').get(visualVersionId);
}

export function createGenerationAttempt({ projectId, visualVersionId, provider, model, parameters = {}, generationIndex = null }) {
  const visual = db.prepare(`SELECT vv.*, v.project_id FROM scene_visual_versions vv JOIN scene_visuals v ON v.id=vv.scene_visual_id WHERE vv.id=? AND v.project_id=? AND v.deleted_at IS NULL`).get(visualVersionId, projectId);
  if (!visual) throw new Error('Visual version not found');
  if (!provider?.trim()) throw new Error('Generation provider is required');
  const max = db.prepare('SELECT MAX(generation_index) max FROM generation_attempts WHERE visual_version_id=?').get(visualVersionId)?.max || 0;
  const index = generationIndex == null ? max + 1 : generationIndex;
  if (index < 1 || !Number.isInteger(index)) throw new Error('generationIndex must be a positive integer');
  const key = generationKey({ projectId, stage: 'visuals', inputArtifactVersions: [visual.source_scene_version_id], provider, model, parameters, generationIndex: index });
  const existing = db.prepare('SELECT * FROM generation_attempts WHERE idempotency_key=?').get(key);
  if (existing) return { attempt: existing, reused: true };
  const attemptId = id('attempt'); const t = now();
  db.prepare(`INSERT INTO generation_attempts(id,visual_version_id,generation_index,idempotency_key,provider,model,parameters_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(attemptId, visualVersionId, index, key, provider, model, JSON.stringify(parameters), 'queued', t);
  return { attempt: db.prepare('SELECT * FROM generation_attempts WHERE id=?').get(attemptId), reused: false };
}

export function createProductionSnapshot(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');

  const research = db.prepare('SELECT id,version_number FROM research_artifacts WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;
  const script = db.prepare(`SELECT sv.id,sv.version_number FROM script_versions sv JOIN script_artifacts sa ON sa.id=sv.script_artifact_id WHERE sa.project_id=? ORDER BY sv.version_number DESC LIMIT 1`).get(projectId) || null;
  const scenes = db.prepare(`SELECT s.id scene_id,sv.id scene_version_id,sv.version_number FROM scenes s JOIN scene_versions sv ON sv.scene_id=s.id WHERE s.project_id=? AND sv.version_number=(SELECT MAX(x.version_number) FROM scene_versions x WHERE x.scene_id=s.id) ORDER BY s.scene_number`).all(projectId);
  const voiceover = db.prepare('SELECT id,version_number FROM voiceovers WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;
  const timestamps = db.prepare('SELECT id,version_number FROM timestamps WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;
  const timeline = db.prepare('SELECT id,version_number FROM timelines WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;
  const roughCut = db.prepare('SELECT id,version_number FROM rough_cuts WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;
  const fineCut = db.prepare('SELECT id,version_number FROM fine_cuts WHERE project_id=? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;

  const visualSelections = db.prepare(`SELECT v.scene_id,v.id scene_visual_id,vv.id scene_visual_version_id,
      (SELECT ga.id FROM generation_attempts ga WHERE ga.result_asset_id=vv.source_asset_id LIMIT 1) source_generation_attempt_id,
      vv.source_asset_id
    FROM scene_visuals v
    JOIN scene_visual_versions vv ON vv.scene_visual_id=v.id
    WHERE v.project_id=? AND v.selection_state='selected'
      AND vv.version_number=(SELECT MAX(x.version_number) FROM scene_visual_versions x WHERE x.scene_visual_id=v.id)
    ORDER BY v.scene_id`).all(projectId);

  return {
    project_id: projectId,
    created_at: now(),
    research_version_id: research?.id || null,
    script_version_id: script?.id || null,
    scene_versions: scenes,
    voiceover_id: voiceover?.id || null,
    timestamp_id: timestamps?.id || null,
    timeline_id: timeline?.id || null,
    rough_cut_id: roughCut?.id || null,
    fine_cut_id: fineCut?.id || null,
    visual_selections: visualSelections
  };
}

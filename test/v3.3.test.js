import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v33-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;

let db;
let createProject;
let createResearch;
let approveArtifact;
let applyRiskOverride;
let createVisual;
let createVisualVersion;
let createGenerationAttempt;
let completeGenerationAttempt;
let selectVisual;
let createProductionSnapshot;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({
    createProject,
    createResearch,
    approveArtifact,
    applyRiskOverride,
    createVisual,
    createVisualVersion,
    createGenerationAttempt,
    completeGenerationAttempt,
    selectVisual,
    createProductionSnapshot
  } = await import('../server/domain.js'));
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

function seedScene(projectId) {
  const researchId = `research_fixture_${crypto.randomUUID()}`;
  const scriptId = `scriptv_fixture_${crypto.randomUUID()}`;
  const scriptArtifact = db.prepare('SELECT id FROM script_artifacts WHERE project_id=?').get(projectId);
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(researchId, projectId, 1, 'content', 'content', 'fixture', 'approved', 'human', new Date().toISOString());
  db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(scriptId, scriptArtifact.id, 1, researchId, 'fixture', 'approved', 'human', new Date().toISOString());

  const sceneId = `scene_${crypto.randomUUID()}`;
  const sceneV4 = `scenev_${crypto.randomUUID()}`;
  const sceneV5 = `scenev_${crypto.randomUUID()}`;
  db.prepare('INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)').run(sceneId, projectId, 3, new Date().toISOString());
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneV4, sceneId, 4, scriptId, 'script', 'v4', 'approved', 'human', new Date().toISOString());
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,approval_mode,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(sceneV5, sceneId, 5, scriptId, 'script', 'v5', 'approved', 'human', new Date().toISOString());
  return { sceneId, sceneV4, sceneV5 };
}

function seedRiskArtifact(projectId) {
  const id = `research_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,approval_mode,risk_blocked,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, 1, 'content', 'content', 'risk test', 'ready_for_review', 'human', 1, new Date().toISOString());
  const reportId = `risk_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO risk_reports(id,project_id,artifact_type,artifact_version_id,risk_level,blocking,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(reportId, projectId, 'research', id, 'high', 1, '[{"id":"f1"}]', new Date().toISOString());
  return { id, reportId };
}

test('visual scene update creates a new version on the same entity', () => {
  const project = createProject({ title: 'visual-version-test' });
  const { sceneId, sceneV4, sceneV5 } = seedScene(project.id);
  const first = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneV4, prompt: 'same direction' });
  const visual = db.prepare('SELECT scene_visual_id FROM scene_visual_versions WHERE id=?').get(first.id);
  const second = createVisualVersion({ projectId: project.id, visualId: visual.scene_visual_id, sourceSceneVersionId: sceneV5, prompt: 'same direction' });
  assert.equal(second.version_number, 2);
  assert.equal(second.scene_visual_id, visual.scene_visual_id);
  assert.throws(() => createVisualVersion({ projectId: project.id, visualId: visual.scene_visual_id, sourceSceneVersionId: sceneV5, prompt: 'same direction' }), /new generation attempt/);
});

test('generation attempt resolves to one asset and snapshot keeps attempt-level provenance', () => {
  const project = createProject({ title: 'asset-lineage-test' });
  const { sceneId, sceneV4 } = seedScene(project.id);
  const visualVersion = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneV4, prompt: 'asset lineage' });
  const { attempt } = createGenerationAttempt({ projectId: project.id, visualVersionId: visualVersion.id, provider: 'test-provider', model: 'test-model', parameters: { seed: 42 } });
  const completed = completeGenerationAttempt({ projectId: project.id, attemptId: attempt.id, objectKey: 'visuals/test.png', license: { status: 'verified', attributionRequired: true } });
  const visual = db.prepare('SELECT * FROM scene_visual_versions WHERE id=?').get(visualVersion.id);
  const asset = db.prepare('SELECT * FROM scene_assets WHERE id=?').get(completed.result_asset_id);
  assert.equal(visual.source_asset_id, completed.result_asset_id);
  assert.equal(asset.source_generation_attempt_id, attempt.id);
  assert.equal(db.prepare('SELECT attribution_required FROM asset_licenses WHERE asset_id=?').get(asset.id).attribution_required, 1);
  selectVisual({ projectId: project.id, visualId: visual.scene_visual_id, actorId: 'human-1' });
  const snapshot = createProductionSnapshot(project.id);
  assert.equal(snapshot.visual_selections[0].scene_visual_version_id, visualVersion.id);
  assert.equal(snapshot.visual_selections[0].source_generation_attempt_id, attempt.id);
  assert.equal(snapshot.visual_selections[0].source_asset_id, asset.id);
});

test('risk override never approves and forces human approval', () => {
  const project = createProject({ title: 'risk-override-test' });
  const { id: artifactId, reportId } = seedRiskArtifact(project.id);
  const override = applyRiskOverride({ projectId: project.id, artifactVersionId: artifactId, riskReportId: reportId, actorId: 'human-1', reason: 'Reviewed finding and accepted residual risk', findingIds: ['f1'] });
  const afterOverride = db.prepare('SELECT status,risk_blocked,approval_mode FROM research_artifacts WHERE id=?').get(artifactId);
  assert.equal(afterOverride.status, 'ready_for_review');
  assert.equal(afterOverride.risk_blocked, 0);
  assert.equal(afterOverride.approval_mode, 'human');
  assert.throws(() => approveArtifact({ projectId: project.id, artifactType: 'research', artifactVersionId: artifactId, actorId: 'automation', approvalMode: 'automatic', linkedRiskOverrideId: override.id }), /after risk override must be human/);
  const approved = approveArtifact({ projectId: project.id, artifactType: 'research', artifactVersionId: artifactId, actorId: 'human-1', approvalMode: 'human', linkedRiskOverrideId: override.id });
  assert.equal(approved.status, 'approved');
  const audit = db.prepare(`SELECT linked_risk_override_id FROM audit_events WHERE event_type='artifact_approved' AND artifact_version_id=? ORDER BY created_at DESC LIMIT 1`).get(artifactId);
  assert.equal(audit.linked_risk_override_id, override.id);
});

test('content downgrade requires a reason and is audited', () => {
  const project = createProject({ title: 'change-type-test' });
  const base = createResearch(project.id, { topic: 'topic', summary: 'original', sources: [] });
  approveArtifact({ projectId: project.id, artifactType: 'research', artifactVersionId: base.id, actorId: 'human-1', approvalMode: 'human' });
  assert.throws(() => createResearch(project.id, { topic: 'topic', summary: 'changed summary', sources: [], changeType: 'metadata' }), /requires a reason/);
  const downgraded = createResearch(project.id, { topic: 'topic', summary: 'changed summary', sources: [], changeType: 'metadata', actorId: 'human-1', downgradeReason: 'Summary change is intentionally non-substantive' });
  assert.equal(downgraded.system_suggested_change_type, 'content');
  assert.equal(downgraded.change_type, 'metadata');
  const audit = db.prepare(`SELECT payload_json FROM audit_events WHERE event_type='change_type_downgraded' AND artifact_version_id=?`).get(downgraded.id);
  assert.ok(audit);
  assert.equal(JSON.parse(audit.payload_json).system_suggested_change_type, 'content');
});

test('visual reroll creates a new attempt on the same version', () => {
  const project = createProject({ title: 'visual-reroll-test' });
  const { sceneId, sceneV4 } = seedScene(project.id);
  const version = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneV4, prompt: 'same prompt' });
  const first = createGenerationAttempt({ projectId: project.id, visualVersionId: version.id, provider: 'test-provider', model: 'test-model', parameters: { seed: 1 } }).attempt;
  const second = createGenerationAttempt({ projectId: project.id, visualVersionId: version.id, provider: 'test-provider', model: 'test-model', parameters: { seed: 2 } }).attempt;
  assert.notEqual(first.id, second.id);
  assert.equal(first.visual_version_id, version.id);
  assert.equal(second.visual_version_id, version.id);
  assert.equal(second.generation_index, first.generation_index + 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scene_visual_versions WHERE scene_visual_id=?').get(version.scene_visual_id).count, 1);
});

test('new candidate line creates a new entity with its own version history', () => {
  const project = createProject({ title: 'visual-entity-test' });
  const { sceneId, sceneV4 } = seedScene(project.id);
  const first = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneV4, prompt: 'photorealistic' });
  const second = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneV4, prompt: 'illustrative' });
  assert.notEqual(first.scene_visual_id, second.scene_visual_id);
  assert.equal(first.version_number, 1);
  assert.equal(second.version_number, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scene_visuals WHERE scene_id=?').get(sceneId).count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scene_visual_versions WHERE scene_visual_id=?').get(first.scene_visual_id).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scene_visual_versions WHERE scene_visual_id=?').get(second.scene_visual_id).count, 1);
});

test('selection state is independent from version approval for the render gate', () => {
  const project = createProject({ title: 'visual-selection-gate-test' });
  const { sceneId, sceneV4 } = seedScene(project.id);
  const candidate = createVisual({ projectId: project.id, sceneId, sourceSceneVersionId: sceneV4, prompt: 'approved but not selected' });
  completeGenerationAttempt({ projectId: project.id, attemptId: createGenerationAttempt({ projectId: project.id, visualVersionId: candidate.id, provider: 'test-provider', model: 'test-model', parameters: {} }).attempt.id, objectKey: 'visuals/candidate.png', license: { status: 'verified' } });
  approveArtifact({ projectId: project.id, artifactType: 'visual', artifactVersionId: candidate.id, actorId: 'human-1', approvalMode: 'human' });
  const row = db.prepare('SELECT selection_state,status FROM scene_visuals v JOIN scene_visual_versions vv ON vv.scene_visual_id=v.id WHERE vv.id=?').get(candidate.id);
  assert.equal(row.selection_state, 'candidate');
  assert.equal(row.status, 'approved');
  assert.deepEqual(createProductionSnapshot(project.id).visual_selections, []);
  selectVisual({ projectId: project.id, visualId: candidate.scene_visual_id, actorId: 'human-1' });
  const selectedSnapshot = createProductionSnapshot(project.id);
  assert.equal(selectedSnapshot.visual_selections[0].scene_visual_id, candidate.scene_visual_id);
});

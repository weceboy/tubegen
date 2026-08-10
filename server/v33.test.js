import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from './db.js';
import {
  createProject,
  createResearch,
  createScriptVersion,
  createVisual,
  createVisualVersion,
  createGenerationAttempt,
  applyRiskOverride,
  approveArtifact
} from './domain.js';

function sceneFixture(projectId, scriptVersionId, sceneNumber = 1) {
  const sceneId = `scene_test_${crypto.randomUUID()}`;
  const sceneVersionId = `scenev_test_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, sceneNumber, new Date().toISOString());
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, scriptVersionId, 'script', 'narration', 'approved', new Date().toISOString());
  return { sceneId, sceneVersionId };
}

function approvedScriptFixture(title) {
  const project = createProject({ title });
  const research = createResearch(project.id, { topic: title, summary: 'facts', sources: [] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(research.id);
  const script = createScriptVersion(project.id, 'script');
  db.prepare(`UPDATE script_versions SET status='approved' WHERE id=?`).run(script.id);
  return { project, research, script };
}

test('Visual reroll creates a new attempt while scene/prompt stay on one version', () => {
  const { project, script } = approvedScriptFixture('v33 attempts');
  const scene = sceneFixture(project.id, script.id);
  const visual = createVisual({ projectId: project.id, sceneId: scene.sceneId, sourceSceneVersionId: scene.sceneVersionId, prompt: 'same prompt' });
  const first = createGenerationAttempt({ projectId: project.id, visualVersionId: visual.id, provider: 'mock', model: 'm', parameters: { prompt: 'same prompt' } });
  const second = createGenerationAttempt({ projectId: project.id, visualVersionId: visual.id, provider: 'mock', model: 'm', parameters: { prompt: 'same prompt' } });
  assert.equal(first.attempt.generation_index, 1);
  assert.equal(second.attempt.generation_index, 2);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM scene_visual_versions WHERE scene_visual_id=?').get(visual.scene_visual_id).count, 1);
});

test('Scene update creates a new version on the same visual entity', () => {
  const { project, script } = approvedScriptFixture('v33 visual version');
  const scene = sceneFixture(project.id, script.id);
  const visual = createVisual({ projectId: project.id, sceneId: scene.sceneId, sourceSceneVersionId: scene.sceneVersionId, prompt: 'original' });
  const sceneVersion2 = `scenev_test_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(sceneVersion2, scene.sceneId, 2, script.id, 'script', 'changed narration', 'approved', new Date().toISOString());
  const next = createVisualVersion({ projectId: project.id, visualId: visual.scene_visual_id, sourceSceneVersionId: sceneVersion2, prompt: 'original' });
  assert.equal(next.version_number, 2);
  assert.equal(next.scene_visual_id, visual.scene_visual_id);
  assert.equal(next.source_scene_version_id, sceneVersion2);
  assert.throws(() => createVisualVersion({ projectId: project.id, visualId: visual.scene_visual_id, sourceSceneVersionId: sceneVersion2, prompt: 'original' }), /new generation attempt/);
});

test('Risk override never approves and permanently forces human approval', () => {
  const { project, script } = approvedScriptFixture('v33 risk');
  db.prepare(`UPDATE script_versions SET status='ready_for_review',risk_blocked=1 WHERE id=?`).run(script.id);
  const reportId = `risk_test_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO risk_reports(id,project_id,artifact_type,artifact_version_id,risk_level,blocking,findings_json,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(reportId, project.id, 'script', script.id, 'high', 1, '[]', new Date().toISOString());
  const override = applyRiskOverride({ projectId: project.id, artifactVersionId: script.id, riskReportId: reportId, actorId: 'human-1', reason: 'Reviewed and accepted residual risk' });
  const afterOverride = db.prepare('SELECT status,risk_blocked,approval_mode FROM script_versions WHERE id=?').get(script.id);
  assert.equal(afterOverride.status, 'ready_for_review');
  assert.equal(afterOverride.risk_blocked, 0);
  assert.equal(afterOverride.approval_mode, 'human');
  assert.throws(() => approveArtifact({ projectId: project.id, artifactType: 'script', artifactVersionId: script.id, actorId: 'automation', approvalMode: 'automatic' }), /must be human/);
  const approved = approveArtifact({ projectId: project.id, artifactType: 'script', artifactVersionId: script.id, actorId: 'human-1', approvalMode: 'human', linkedRiskOverrideId: override.id });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approval_mode, 'human');
});

test('Research content downgrade requires reason and is audited', () => {
  const project = createProject({ title: 'v33 change type' });
  const first = createResearch(project.id, { topic: 'A', summary: 'facts', sources: [] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(first.id);
  assert.throws(() => createResearch(project.id, { topic: 'A', summary: 'new facts', sources: [], changeType: 'metadata' }), /requires a reason/);
  const downgraded = createResearch(project.id, { topic: 'A', summary: 'new facts', sources: [], changeType: 'metadata', downgradeReason: 'Editorially non-substantive wording change', actorId: 'human-1' });
  assert.equal(downgraded.system_suggested_change_type, 'content');
  assert.equal(downgraded.change_type, 'metadata');
  const event = db.prepare(`SELECT * FROM audit_events WHERE artifact_version_id=? AND event_type='change_type_downgraded'`).get(downgraded.id);
  assert.ok(event);
});

test('Mixed Research changes cannot be downgraded to metadata', () => {
  const project = createProject({ title: 'v33 mixed' });
  const first = createResearch(project.id, { topic: 'A', summary: 'facts', tags: [], sources: [{ url: 'https://example.com', title: 'old', publisher: 'P' }] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(first.id);
  assert.throws(() => createResearch(project.id, { topic: 'A', summary: 'new facts', tags: ['tag'], sources: [{ url: 'https://example.com', title: 'new', publisher: 'P' }], changeType: 'metadata', downgradeReason: 'reason' }), /mixed change/);
});

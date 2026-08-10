import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { createProject, createResearch, createScriptVersion, createVisual, createGenerationAttempt } from './domain.js';

function sceneFixture(projectId) {
  const sceneId = `scene_harden_${randomUUID()}`;
  const sceneVersionId = `scenev_harden_${randomUUID()}`;
  const t = new Date().toISOString();
  const research = createResearch(projectId, { topic: 'Fixture', summary: 'Fixture facts', sources: [] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(research.id);
  const script = createScriptVersion(projectId, 'Fixture script');
  db.prepare(`UPDATE script_versions SET status='approved' WHERE id=?`).run(script.id);
  db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, Date.now() % 1000000, t);
  db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(sceneVersionId, sceneId, 1, script.id, 'script', 'narration', 'approved', t);
  return { sceneId, sceneVersionId };
}

test('v3.3 classifies target length changes as content', () => {
  const project = createProject({ title: 'v33 target length' });
  createResearch(project.id, { topic: 'A', summary: 'facts', targetLength: '60s', sources: [] });
  const changed = createResearch(project.id, { topic: 'A', summary: 'facts', targetLength: '90s', sources: [] });
  assert.equal(changed.system_suggested_change_type, 'content');
  assert.equal(changed.change_type, 'content');
});

test('v3.3 classifies duplicate source add/remove as metadata', () => {
  const project = createProject({ title: 'v33 duplicate sources' });
  const source = { url: 'https://example.com/source', title: 'Example', publisher: 'Example Inc.' };
  const first = createResearch(project.id, { topic: 'A', summary: 'facts', sources: [source] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(first.id);

  const duplicate = createResearch(project.id, { topic: 'A', summary: 'facts', sources: [source, source] });
  assert.equal(duplicate.system_suggested_change_type, 'metadata');

  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(duplicate.id);
  const cleaned = createResearch(project.id, { topic: 'A', summary: 'facts', sources: [source] });
  assert.equal(cleaned.system_suggested_change_type, 'metadata');
});

test('v3.3 treats unlisted source-field changes as content', () => {
  const project = createProject({ title: 'v33 source safe default' });
  const source = { url: 'https://example.com/source', title: 'Example', publisher: 'Example Inc.', verified: false };
  const first = createResearch(project.id, { topic: 'A', summary: 'facts', sources: [source] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(first.id);

  const changed = createResearch(project.id, { topic: 'A', summary: 'facts', sources: [{ ...source, verified: true }] });
  assert.equal(changed.system_suggested_change_type, 'content');
});

test('v3.3 generation attempts cannot cross project boundaries', () => {
  const owner = createProject({ title: 'v33 owner' });
  const other = createProject({ title: 'v33 other' });
  const scene = sceneFixture(owner.id);
  const visual = createVisual({ projectId: owner.id, sceneId: scene.sceneId, sourceSceneVersionId: scene.sceneVersionId, prompt: 'same' });

  assert.throws(
    () => createGenerationAttempt({ projectId: other.id, visualVersionId: visual.id, provider: 'mock', model: 'm' }),
    /Visual version not found/
  );
});

test('v3.3 change-type downgrade is enforced by createResearch and audited', () => {
  const project = createProject({ title: 'v33 downgrade audit' });
  const first = createResearch(project.id, { topic: 'A', summary: 'original', sources: [] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(first.id);

  assert.throws(
    () => createResearch(project.id, {
      topic: 'A',
      summary: 'changed content',
      sources: [],
      changeType: 'metadata',
      actorId: 'actor-test'
    }),
    /requires a reason/
  );

  const changed = createResearch(project.id, {
    topic: 'A',
    summary: 'changed content',
    sources: [],
    changeType: 'metadata',
    actorId: 'actor-test',
    downgradeReason: 'The summary change is intentionally treated as metadata for this controlled correction.'
  });

  assert.equal(changed.system_suggested_change_type, 'content');
  assert.equal(changed.change_type, 'metadata');
  const audit = db.prepare(`SELECT * FROM audit_events WHERE event_type='change_type_downgraded' AND artifact_version_id=? ORDER BY created_at DESC LIMIT 1`).get(changed.id);
  assert.ok(audit);
  const payload = JSON.parse(audit.payload_json);
  assert.equal(payload.system_suggested_change_type, 'content');
  assert.equal(payload.final_change_type, 'metadata');
  assert.equal(payload.reason, 'The summary change is intentionally treated as metadata for this controlled correction.');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import { createProject, createResearch, createScriptVersion, generationKey } from './domain.js';

test('generation keys separate retries from explicit regeneration attempts', () => {
  const base = { projectId:'p', stage:'visuals', inputArtifactVersions:['scene-v1'], provider:'mock', model:'m', parameters:{prompt:'x'} };
  assert.equal(generationKey({ ...base, generationIndex:1 }), generationKey({ ...base, generationIndex:1 }));
  assert.notEqual(generationKey({ ...base, generationIndex:1 }), generationKey({ ...base, generationIndex:2 }));
});

test('research metadata changes do not stale downstream script', () => {
  const p = createProject({ title:'test metadata', channel:'test' });
  const r1 = createResearch(p.id, { topic:'A', summary:'facts', sources:[{url:'https://example.com', title:'same facts'}] });
  db.prepare(`UPDATE research_artifacts SET status='approved' WHERE id=?`).run(r1.id);
  const s = createScriptVersion(p.id, 'Approved script');
  db.prepare(`UPDATE script_versions SET status='approved' WHERE id=?`).run(s.id);
  const r2 = createResearch(p.id, { topic:'A', summary:'facts', sources:[{url:'https://example.com', title:'same facts', tags:['reviewed']}] });
  assert.equal(r2.change_type, 'metadata');
  assert.equal(db.prepare('SELECT status FROM script_versions WHERE id=?').get(s.id).status, 'approved');
});

test('adding a unique research source is a content change', () => {
  const p = createProject({ title:'source add classification', channel:'test' });
  createResearch(p.id, { topic:'A', summary:'facts', sources:[] });
  const next = createResearch(p.id, { topic:'A', summary:'facts', sources:[{url:'https://example.com', title:'new source'}] });
  assert.equal(next.system_suggested_change_type, 'content');
  assert.equal(next.change_type, 'content');
});

test('removing a unique research source is a content change', () => {
  const p = createProject({ title:'source removal classification', channel:'test' });
  createResearch(p.id, { topic:'A', summary:'facts', sources:[{url:'https://example.com', title:'source'}] });
  const next = createResearch(p.id, { topic:'A', summary:'facts', sources:[] });
  assert.equal(next.system_suggested_change_type, 'content');
  assert.equal(next.change_type, 'content');
});
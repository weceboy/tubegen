import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = path.join(os.tmpdir(), `autodoc-change-type-${crypto.randomUUID()}.sqlite`);
process.env.AUTODOC_DB = dbPath;
const { db } = await import('../server/db.js');
const { classifyResearchChange, applyResearchChangeType } = await import('../server/change-type.js');
const now = new Date().toISOString();
const projectId = `project_${crypto.randomUUID()}`;
db.prepare(`INSERT INTO projects(id,title,channel,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(projectId, 'change type', 'Default', 'draft', now, now);

after(() => { db.close(); for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch {} } });

let nextVersion = 1;
function version(suggested) {
  const id = `research_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,change_type,system_suggested_change_type,topic,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, projectId, nextVersion++, suggested, suggested, 'test', 'draft', now);
  return id;
}

test('metadata-only fields classify as metadata', () => {
  assert.equal(classifyResearchChange(['publisher', 'title', 'tags', 'internal_notes']), 'metadata');
});

test('unlisted fields conservatively classify as content', () => {
  assert.equal(classifyResearchChange(['summary']), 'content');
  assert.equal(classifyResearchChange(['new_source']), 'content');
});

test('content downgrade requires a reason', () => {
  const id = version('content');
  assert.throws(() => applyResearchChangeType({ researchVersionId: id, requestedChangeType: 'metadata', actorId: 'actor-1' }), /reason is required/);
});

test('content downgrade creates an audit event', () => {
  const id = version('content');
  const result = applyResearchChangeType({ researchVersionId: id, requestedChangeType: 'metadata', actorId: 'actor-1', reason: 'The summary is unchanged in substance.' });
  assert.equal(result.change_type, 'metadata');
  const audit = db.prepare(`SELECT event_type,actor_id,artifact_version_id,payload_json FROM audit_events WHERE id=?`).get(result.audit_event_id);
  assert.equal(audit.event_type, 'change_type_downgraded');
  assert.equal(audit.actor_id, 'actor-1');
  assert.equal(JSON.parse(audit.payload_json).system_suggested_change_type, 'content');
});

test('metadata to content is allowed without justification', () => {
  const id = version('metadata');
  const result = applyResearchChangeType({ researchVersionId: id, requestedChangeType: 'content' });
  assert.equal(result.change_type, 'content');
});

test('mixed cannot be downgraded to metadata', () => {
  const id = version('mixed');
  assert.throws(() => applyResearchChangeType({ researchVersionId: id, requestedChangeType: 'metadata', actorId: 'actor-1', reason: 'reason' }), /mixed changes cannot/);
});

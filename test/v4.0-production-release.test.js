import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-v40-release-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;
let db;
let createProject;
let createProductionRelease;
let revokeProductionRelease;
let verifyProductionRelease;

before(async () => {
  ({ db } = await import('../server/db.js'));
  ({ createProject } = await import('../server/domain.js'));
  ({ createProductionRelease, revokeProductionRelease, verifyProductionRelease } = await import('../server/production-release-service.js'));
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

function fixture() {
  const project = createProject({ title: 'release-fixture' });
  const now = new Date().toISOString();
  const publishId = `publish_${project.id}`;
  const jobId = `job_${project.id}`;
  const assetId = `asset_${project.id}`;
  db.exec(`CREATE TABLE IF NOT EXISTS production_publishes (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, render_job_id TEXT NOT NULL UNIQUE,
    output_asset_id TEXT NOT NULL, attestation_hash TEXT NOT NULL, published_by TEXT NOT NULL,
    published_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published'
  )`);
  db.prepare(`INSERT INTO production_publishes VALUES(?,?,?,?,?,?,?,?)`).run(publishId, project.id, jobId, assetId, 'a'.repeat(64), 'tester', now, 'published');
  return { project, publishId };
}

test('v4.0 release is numbered, verifiable and immutable', () => {
  const { project, publishId } = fixture();
  const first = createProductionRelease(project.id, `job_${project.id}`, { actorId: 'release-manager' });
  assert.equal(first.release_number, 1);
  assert.equal(first.status, 'active');
  assert.equal(verifyProductionRelease(project.id, first.id).status, 'valid');
  const second = createProductionRelease(project.id, `job_${project.id}`, { actorId: 'other' });
  assert.equal(second.id, first.id);
  assert.equal(second.publish_id, publishId);
});

test('v4.0 release revocation requires a reason and is terminal', () => {
  const { project } = fixture();
  const release = createProductionRelease(project.id, `job_${project.id}`, { actorId: 'release-manager' });
  assert.throws(() => revokeProductionRelease(project.id, release.id, ''), /reason/i);
  const revoked = revokeProductionRelease(project.id, release.id, 'superseded by corrected master', { actorId: 'release-manager' });
  assert.equal(revoked.status, 'revoked');
  assert.equal(verifyProductionRelease(project.id, release.id).status, 'revoked');
  assert.equal(revokeProductionRelease(project.id, release.id, 'second reason').status, 'revoked');
});

test('v4.0 release verification detects manifest tampering', () => {
  const { project } = fixture();
  const release = createProductionRelease(project.id, `job_${project.id}`);
  db.prepare('UPDATE production_publishes SET attestation_hash=? WHERE id=?').run('f'.repeat(64), release.publish_id);
  const result = verifyProductionRelease(project.id, release.id);
  assert.equal(result.status, 'drifted');
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `autodoc-queue-${process.pid}.sqlite`);
process.env.AUTODOC_DB = dbPath;

const { db } = await import('./db.js');
const { enqueueJob, claimNextJob, completeJob, failJob } = await import('./queue.js');
const { createProject } = await import('./domain.js');

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('job enqueue is idempotent', () => {
  const project = createProject({ title: 'queue-idempotent' });
  const key = `test-${Date.now()}-${Math.random()}`;
  const a = enqueueJob({ projectId: project.id, stage: 'visuals', jobType: 'generate_visual', idempotencyKey: key, payload: { scene: '1' } });
  const b = enqueueJob({ projectId: project.id, stage: 'visuals', jobType: 'generate_visual', idempotencyKey: key, payload: { scene: '1' } });
  assert.equal(a.reused, false);
  assert.equal(b.reused, true);
  assert.equal(a.job.id, b.job.id);
  db.prepare('DELETE FROM jobs WHERE id=?').run(a.job.id);
});

test('claim and complete transitions are durable', () => {
  const project = createProject({ title: 'queue-claim' });
  const created = enqueueJob({ projectId: project.id, stage: 'research', jobType: 'research', idempotencyKey: `test-${Date.now()}-${Math.random()}` });
  const claimed = claimNextJob();
  assert.equal(claimed.id, created.job.id);
  assert.equal(claimed.status, 'running');
  const done = completeJob(claimed.id);
  assert.equal(done.status, 'completed');
  db.prepare('DELETE FROM jobs WHERE id=?').run(claimed.id);
});

test('retry returns a failed job to queue until max attempts', () => {
  const project = createProject({ title: 'queue-retry' });
  const created = enqueueJob({ projectId: project.id, stage: 'research', jobType: 'research', maxAttempts: 2, idempotencyKey: `test-${Date.now()}-${Math.random()}` });
  const claimed = claimNextJob();
  const retried = failJob(claimed.id, 'temporary');
  assert.equal(retried.status, 'queued');
  const claimedAgain = claimNextJob();
  const terminal = failJob(claimedAgain.id, 'permanent');
  assert.equal(terminal.status, 'failed');
  db.prepare('DELETE FROM jobs WHERE id=?').run(created.job.id);
});

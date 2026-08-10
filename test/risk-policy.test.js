import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = path.join(os.tmpdir(), `autodoc-risk-policy-${crypto.randomUUID()}.sqlite`);
process.env.AUTODOC_DB = dbPath;

const { db } = await import('../server/db.js');
const { resolveRiskPolicy, upsertRiskPolicy, assertApprovalPolicy } = await import('../server/risk-policy.js');

const projectId = `proj_test_${crypto.randomUUID()}`;
const createdAt = new Date().toISOString();

db.prepare(`INSERT INTO projects(id,title,channel,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
  .run(projectId, 'Risk policy test', 'YouTube', 'draft', createdAt, createdAt);

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
});

test('risk policy inherits each action field independently', () => {
  upsertRiskPolicy({ scopeType: 'global', highAction: 'human_review', mediumAction: 'automatic', lowAction: 'automatic', blockedAction: 'blocked', policyVersion: 'g1' });
  upsertRiskPolicy({ scopeType: 'channel', scopeId: 'YouTube', highAction: 'manual_confirmation', lowAction: 'human', policyVersion: 'c1' });
  upsertRiskPolicy({ scopeType: 'project', scopeId: projectId, highAction: 'human', policyVersion: 'p1' });

  const resolved = resolveRiskPolicy({ projectId });
  assert.deepEqual(resolved.policy, {
    high_action: 'human',
    medium_action: 'automatic',
    low_action: 'human',
    blocked_action: 'blocked'
  });
});

test('risk policy can require manual confirmation without affecting other fields', () => {
  upsertRiskPolicy({ scopeType: 'channel', scopeId: 'YouTube', mediumAction: 'manual_confirmation', policyVersion: 'c2' });
  const artifactId = `artifact_test_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO risk_reports(id,project_id,artifact_type,artifact_version_id,risk_level,blocking,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(`risk_${crypto.randomUUID()}`, projectId, 'script', artifactId, 'medium', 0, new Date().toISOString());

  assert.throws(
    () => assertApprovalPolicy({ projectId, artifactVersionId: artifactId, approvalMode: 'automatic' }),
    /manual approval|manual confirmation/i
  );

  assert.doesNotThrow(
    () => assertApprovalPolicy({ projectId, artifactVersionId: artifactId, approvalMode: 'manual_confirmation' })
  );
});

test('blocking policy is enforced independently of risk level', () => {
  const artifactId = `artifact_blocked_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO risk_reports(id,project_id,artifact_type,artifact_version_id,risk_level,blocking,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(`risk_${crypto.randomUUID()}`, projectId, 'scene', artifactId, 'low', 1, new Date().toISOString());

  assert.throws(
    () => assertApprovalPolicy({ projectId, artifactVersionId: artifactId, approvalMode: 'human' }),
    /blocks approval/i
  );
});

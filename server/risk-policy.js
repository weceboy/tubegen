import crypto from 'node:crypto';
import { db } from './db.js';

export const RISK_ACTION_FIELDS = ['high_action', 'medium_action', 'low_action', 'blocked_action'];

function normalizePolicy(policy) {
  const out = {};
  for (const field of RISK_ACTION_FIELDS) {
    if (policy?.[field] !== undefined && policy[field] !== null && policy[field] !== '') out[field] = policy[field];
  }
  return out;
}

function parseRow(row) {
  if (!row) return {};
  return normalizePolicy({
    high_action: row.high_action,
    medium_action: row.medium_action,
    low_action: row.low_action,
    blocked_action: row.blocked_action
  });
}

export function resolveRiskPolicy({ projectId, channel = null } = {}) {
  if (!projectId) throw new Error('projectId is required');
  const project = db.prepare('SELECT channel FROM projects WHERE id=?').get(projectId);
  if (!project) throw new Error('Project not found');
  const channelName = channel ?? project.channel;
  const projectPolicy = db.prepare("SELECT * FROM risk_policies WHERE scope_type='project' AND scope_id=?").get(projectId);
  const channelPolicy = db.prepare("SELECT * FROM risk_policies WHERE scope_type='channel' AND scope_id=?").get(channelName);
  const globalPolicy = db.prepare("SELECT * FROM risk_policies WHERE scope_type='global' AND scope_id='global'").get();

  const sources = { project: parseRow(projectPolicy), channel: parseRow(channelPolicy), global: parseRow(globalPolicy) };
  const resolved = {};
  for (const field of RISK_ACTION_FIELDS) {
    if (sources.project[field] !== undefined) resolved[field] = sources.project[field];
    else if (sources.channel[field] !== undefined) resolved[field] = sources.channel[field];
    else if (sources.global[field] !== undefined) resolved[field] = sources.global[field];
    else resolved[field] = null;
  }
  return { projectId, channel: channelName, policy: resolved, sources };
}

function normalizedAction(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

export function assertApprovalPolicy({ projectId, artifactVersionId, approvalMode }) {
  const risk = db.prepare('SELECT risk_level, blocking FROM risk_reports WHERE project_id=? AND artifact_version_id=? ORDER BY created_at DESC LIMIT 1').get(projectId, artifactVersionId);
  if (!risk) return null;
  const resolved = resolveRiskPolicy({ projectId }).policy;
  const field = risk.blocking ? 'blocked_action' : `${String(risk.risk_level || '').toLowerCase()}_action`;
  const action = normalizedAction(resolved[field]);
  if (!action) return { risk, field, action: null };

  if (action === 'blocked' || action === 'block' || action === 'deny') {
    throw new Error(`Risk policy blocks approval for ${risk.risk_level || 'blocked'} risk artifacts`);
  }
  if (action === 'human_review' || action === 'human' || action.includes('explicit_acceptance')) {
    if (approvalMode !== 'human') throw new Error(`Risk policy requires human approval for ${risk.risk_level || 'blocked'} risk artifacts`);
  } else if (action === 'manual_confirmation' || action === 'manual') {
    if (approvalMode !== 'manual_confirmation') throw new Error(`Risk policy requires manual confirmation for ${risk.risk_level || 'blocked'} risk artifacts`);
  } else if (action === 'automatic' || action === 'auto') {
    if (risk.risk_level === 'high' && approvalMode === 'automatic') throw new Error('Automatic approval is forbidden for high risk artifacts');
  }
  return { risk, field, action };
}

export function upsertRiskPolicy({ scopeType, scopeId = 'global', highAction, mediumAction, lowAction, blockedAction, policyVersion = null }) {
  if (!['project', 'channel', 'global'].includes(scopeType)) throw new Error('Invalid risk policy scope');
  if (scopeType === 'global') scopeId = 'global';
  const values = normalizePolicy({ high_action: highAction, medium_action: mediumAction, low_action: lowAction, blocked_action: blockedAction });
  const existing = db.prepare('SELECT id FROM risk_policies WHERE scope_type=? AND scope_id=?').get(scopeType, scopeId);
  const timestamp = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE risk_policies SET high_action=?,medium_action=?,low_action=?,blocked_action=?,policy_version=?,updated_at=? WHERE id=?`)
      .run(values.high_action ?? null, values.medium_action ?? null, values.low_action ?? null, values.blocked_action ?? null, policyVersion, timestamp, existing.id);
    return db.prepare('SELECT * FROM risk_policies WHERE id=?').get(existing.id);
  }
  const id = `risk_policy_${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO risk_policies(id,scope_type,scope_id,high_action,medium_action,low_action,blocked_action,policy_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, scopeType, scopeId, values.high_action ?? null, values.medium_action ?? null, values.low_action ?? null, values.blocked_action ?? null, policyVersion, timestamp, timestamp);
  return db.prepare('SELECT * FROM risk_policies WHERE id=?').get(id);
}

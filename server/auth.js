import crypto from 'node:crypto';

function parseTokens() {
  const raw = process.env.AUTODOC_AUTH_TOKENS || '';
  if (!raw.trim()) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AUTODOC_AUTH_TOKENS must be valid JSON');
  }
  const entries = Object.entries(parsed);
  return new Map(entries.map(([token, value]) => [token, {
    actorId: value?.actorId || 'api',
    role: value?.role || 'viewer',
    projects: Array.isArray(value?.projects) ? value.projects : []
  }]));
}

function tokenEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function authenticate(req) {
  const tokens = parseTokens();
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const supplied = bearer || req.headers['x-autodoc-token'] || '';
  if (!tokens.size) {
    if (process.env.NODE_ENV === 'production') throw Object.assign(new Error('Authentication is not configured'), { code: 'AUTH_CONFIG_REQUIRED', status: 503 });
    return { actorId: req.headers['x-autodoc-actor'] || 'local-dev', role: 'admin', projects: ['*'], authenticated: false };
  }
  for (const [token, identity] of tokens) {
    if (tokenEqual(String(supplied), token)) return { ...identity, authenticated: true };
  }
  throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED', status: 401 });
}

export function authorize(identity, { projectId = null, roles = [] } = {}) {
  if (roles.length && !roles.includes(identity.role)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
  if (projectId && !identity.projects.includes('*') && !identity.projects.includes(projectId)) {
    throw Object.assign(new Error('Forbidden'), { code: 'PROJECT_FORBIDDEN', status: 403 });
  }
}

export function securityHeaders(origin = '') {
  const configured = (process.env.AUTODOC_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  const allowOrigin = configured.includes(origin) ? origin : '';
  return {
    ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin, 'vary': 'Origin' } : {}),
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-autodoc-token',
    'access-control-max-age': '600'
  };
}

export function actorInput(identity, input = {}) {
  return { ...input, actorId: identity.actorId };
}

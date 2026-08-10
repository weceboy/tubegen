import test from 'node:test';
import assert from 'node:assert/strict';

const original = {
  tokens: process.env.AUTODOC_AUTH_TOKENS,
  env: process.env.NODE_ENV,
  origins: process.env.AUTODOC_ALLOWED_ORIGINS
};

test.after(() => {
  for (const [key, value] of Object.entries({ AUTODOC_AUTH_TOKENS: original.tokens, NODE_ENV: original.env, AUTODOC_ALLOWED_ORIGINS: original.origins })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('authentication resolves actor, role and project scope', async () => {
  process.env.NODE_ENV = 'production';
  process.env.AUTODOC_AUTH_TOKENS = JSON.stringify({
    'token-editor': { actorId: 'editor-1', role: 'editor', projects: ['project-a'] }
  });
  const { authenticate, authorize } = await import('../server/auth.js?security-test=1');
  const identity = authenticate({ headers: { authorization: 'Bearer token-editor' } });
  assert.deepEqual(identity, { actorId: 'editor-1', role: 'editor', projects: ['project-a'], authenticated: true });
  authorize(identity, { projectId: 'project-a', roles: ['editor'] });
  assert.throws(() => authorize(identity, { projectId: 'project-b' }), /Forbidden/);
  assert.throws(() => authorize(identity, { projectId: 'project-a', roles: ['approver'] }), /Forbidden/);
});

test('production fails closed when authentication is not configured', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.AUTODOC_AUTH_TOKENS;
  const { authenticate } = await import('../server/auth.js?security-test=2');
  assert.throws(() => authenticate({ headers: {} }), /Authentication is not configured/);
});

test('CORS only allows explicitly configured origins', async () => {
  process.env.AUTODOC_ALLOWED_ORIGINS = 'https://studio.example.com,https://review.example.com';
  const { securityHeaders } = await import('../server/auth.js?security-test=3');
  const allowed = securityHeaders('https://studio.example.com');
  const denied = securityHeaders('https://evil.example.com');
  assert.equal(allowed['access-control-allow-origin'], 'https://studio.example.com');
  assert.equal(denied['access-control-allow-origin'], undefined);
});

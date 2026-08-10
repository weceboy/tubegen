import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

test('v4.1 new project flow is wired to the production API', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'src', 'project-creation.js'), 'utf8');

  assert.match(index, /src\/project-creation\.js/);
  assert.match(script, /data-action=\\?\"new\\?\"/);
  assert.match(script, /fetch\(['\"]\/api\/projects['\"]/);
  assert.match(script, /method:\s*['\"]POST['\"]/);
  assert.match(script, /title:/);
  assert.match(script, /channel:/);
  assert.match(script, /targetDurationSeconds/);
  assert.match(script, /window\.location\.reload\(\)/);
});

test('v4.1 new project flow exposes validation and backend errors', () => {
  const script = fs.readFileSync(path.join(root, 'src', 'project-creation.js'), 'utf8');
  assert.match(script, /required/);
  assert.match(script, /response\.ok/);
  assert.match(script, /data\.error/);
  assert.match(script, /project-create-error/);
});

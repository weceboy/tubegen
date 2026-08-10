import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = path.join(os.tmpdir(), `autodoc-v33-${crypto.randomUUID()}.sqlite`);
process.env.AUTODOC_DB = dbPath;
const { db } = await import('../server/db.js');
const now = new Date().toISOString();
const id = (p) => `${p}_${crypto.randomUUID()}`;
const projectId = id('project');
const sceneId = id('scene');
const scriptId = id('script');
const researchId = id('research');
const scriptVersionId = id('script_version');
const sceneV4 = id('scene_version');
const sceneV5 = id('scene_version');

db.prepare(`INSERT INTO projects(id,title,channel,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(projectId, 'v3.3 acceptance', 'Default', 'draft', now, now);
db.prepare(`INSERT INTO research_artifacts(id,project_id,version_number,topic,status,created_at) VALUES(?,?,?,?,?,?)`).run(researchId, projectId, 1, 'test', 'approved', now);
db.prepare(`INSERT INTO scenes(id,project_id,scene_number,created_at) VALUES(?,?,?,?)`).run(sceneId, projectId, 3, now);
db.prepare(`INSERT INTO script_artifacts(id,project_id,created_at) VALUES(?,?,?)`).run(scriptId, projectId, now);
db.prepare(`INSERT INTO script_versions(id,script_artifact_id,version_number,source_research_version_id,content,status,created_at) VALUES(?,?,?,?,?,?,?)`).run(scriptVersionId, scriptId, 1, researchId, 'test script', 'approved', now);
for (const [sv, n] of [[sceneV4, 4], [sceneV5, 5]]) db.prepare(`INSERT INTO scene_versions(id,scene_id,version_number,source_script_version_id,narration_source,narration_text,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(sv, sceneId, n, scriptVersionId, 'script', `scene ${n}`, 'approved', now);

after(() => { db.close(); for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + s); } catch {} });

test('scene change creates a new version on the same visual entity', () => {
  const visual = id('visual');
  db.prepare(`INSERT INTO scene_visuals(id,project_id,scene_id,selection_state,created_at) VALUES(?,?,?,?,?)`).run(visual, projectId, sceneId, 'candidate', now);
  for (const [version, sourceScene] of [[1, sceneV4], [2, sceneV5]]) db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,source_prompt,asset_type,asset_source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('visual_version'), visual, version, sourceScene, 'same prompt', 'image', 'ai', 'approved', now);
  const rows = db.prepare('SELECT scene_visual_id,version_number,source_scene_version_id FROM scene_visual_versions WHERE scene_visual_id=? ORDER BY version_number').all(visual);
  assert.equal(rows.length, 2); assert.equal(rows[0].scene_visual_id, rows[1].scene_visual_id); assert.equal(rows[1].source_scene_version_id, sceneV5);
});

test('selection state does not imply approval and approval does not imply selection', () => {
  const visual = id('visual'); const version = id('visual_version');
  db.prepare(`INSERT INTO scene_visuals(id,project_id,scene_id,selection_state,created_at) VALUES(?,?,?,?,?)`).run(visual, projectId, sceneId, 'candidate', now);
  db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,asset_type,asset_source,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(version, visual, 1, sceneV4, 'image', 'ai', 'approved', now);
  const row = db.prepare(`SELECT s.selection_state,v.status FROM scene_visuals s JOIN scene_visual_versions v ON v.scene_visual_id=s.id WHERE v.id=?`).get(version);
  assert.deepEqual(row, { selection_state: 'candidate', status: 'approved' });
});

test('selected approved visual resolves to attempt, asset and verified license', () => {
  const visual = id('visual'); const version = id('visual_version'); const attempt = id('attempt'); const asset = id('asset');
  db.prepare(`INSERT INTO scene_visuals(id,project_id,scene_id,selection_state,created_at) VALUES(?,?,?,?,?)`).run(visual, projectId, sceneId, 'selected', now);
  db.prepare(`INSERT INTO scene_assets(id,project_id,source_type,object_key,created_at) VALUES(?,?,?,?,?)`).run(asset, projectId, 'generation_attempt', 'renders/scene-03/v3.webp', now);
  db.prepare(`INSERT INTO scene_visual_versions(id,scene_visual_id,version_number,source_scene_version_id,asset_type,asset_source,status,source_asset_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(version, visual, 3, sceneV5, 'image', 'ai', 'approved', asset, now);
  db.prepare(`INSERT INTO generation_attempts(id,visual_version_id,generation_index,idempotency_key,provider,status,result_asset_id) VALUES(?,?,?,?,?,?,?)`).run(attempt, version, 1, id('idem'), 'test-provider', 'completed', asset);
  db.prepare(`INSERT INTO asset_licenses(id,asset_id,license_type,license_status,verified_at) VALUES(?,?,?,?,?)`).run(id('license'), asset, 'generated', 'verified', now);
  const row = db.prepare(`SELECT v.source_asset_id,a.object_key,l.license_status,g.id attempt_id FROM scene_visual_versions v JOIN scene_assets a ON a.id=v.source_asset_id JOIN asset_licenses l ON l.asset_id=a.id JOIN generation_attempts g ON g.result_asset_id=a.id WHERE v.id=?`).get(version);
  assert.equal(row.source_asset_id, asset); assert.equal(row.object_key, 'renders/scene-03/v3.webp'); assert.equal(row.license_status, 'verified'); assert.equal(row.attempt_id, attempt);
});

test('risk override is recorded separately and does not create approval', () => {
  const artifact = id('artifact'); const report = id('risk'); const override = id('override');
  db.prepare(`INSERT INTO risk_reports(id,project_id,artifact_type,artifact_version_id,risk_level,blocking,created_at) VALUES(?,?,?,?,?,?,?)`).run(report, projectId, 'script', artifact, 'high', 1, now);
  db.prepare(`INSERT INTO risk_overrides(id,artifact_version_id,risk_report_id,finding_ids_json,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?)`).run(override, artifact, report, '["finding-1"]', id('actor'), 'Accepted documented risk', now);
  assert.equal(db.prepare('SELECT id FROM audit_events WHERE linked_risk_override_id=?').get(override), undefined);
  assert.equal(db.prepare('SELECT id,reason FROM risk_overrides WHERE id=?').get(override).reason, 'Accepted documented risk');
});

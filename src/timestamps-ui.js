import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = { ...getConnection(), live: false, project: null, mode: 'view' };

function apiPath(suffix) { return `/api/projects/${encodeURIComponent(state.projectId)}${suffix}`; }
function latestTimestamps() { return state.project?.timestamps?.[0] || null; }
function approvedVoiceover() { return state.project?.voiceovers?.find(v => v.status === 'approved') || null; }
function approvedScenes() { return (state.project?.scenes || []).filter(s => s.status === 'approved'); }

async function loadLiveProject() {
  if (!state.projectId) return false;
  try {
    state.project = await apiRequest(apiPath(''), 'GET', state.token);
    state.live = true;
    return true;
  } catch (error) { state.live = false; notify(error.message); return false; }
}

async function saveDraft(mappings) {
  const voiceover = approvedVoiceover();
  if (!voiceover) { notify('An approved voiceover is required before timestamps'); return; }
  for (const m of mappings) {
    if (!Number.isInteger(m.startMs) || !Number.isInteger(m.endMs) || m.startMs < 0 || m.endMs <= m.startMs) { notify(`Invalid timestamp range for scene ${m.sceneNumber}`); return; }
  }
  try {
    await apiRequest(apiPath('/timestamps'), 'POST', state.token, { body: JSON.stringify({
      voiceoverId: voiceover.id, mappings: mappings.map(m => ({ sceneId: m.sceneId, startMs: m.startMs, endMs: m.endMs }))
    }) });
    notify('Timestamp version created');
    state.mode = 'view';
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

async function approve(id) {
  try {
    await apiRequest(apiPath('/approve'), 'POST', state.token, { body: JSON.stringify({ artifactType: 'timestamp', artifactVersionId: id, approvalMode: 'human' }) });
    notify('Timestamps approved');
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

function draftForm() {
  const scenes = approvedScenes();
  if (!approvedVoiceover()) return `<div class="stage-panel"><h4>NEW TIMESTAMP VERSION</h4><p class="muted">An approved voiceover is required first.</p><button class="btn" data-t="cancel">Cancel</button></div>`;
  if (!scenes.length) return `<div class="stage-panel"><h4>NEW TIMESTAMP VERSION</h4><p class="muted">No approved scenes to map yet.</p><button class="btn" data-t="cancel">Cancel</button></div>`;
  return `<div class="stage-panel">
    <h4>NEW TIMESTAMP VERSION</h4>
    <p class="muted">Enter start/end milliseconds for each approved scene.</p>
    <div class="stage-mapping"><label><b>SCENE</b></label><label>START MS</label><label>END MS</label></div>
    ${scenes.map(s => `<div class="stage-mapping" data-t-scene="${s.id}" data-t-number="${s.scene_number}"><label>${String(s.scene_number).padStart(2, '0')} · ${escapeHtml((s.narration_text || '').slice(0, 40))}</label><input class="t-start" type="number" min="0"><input class="t-end" type="number" min="0"></div>`).join('')}
    <div class="inspector-row"><button class="btn" data-t="cancel">Cancel</button><button class="btn primary" data-t="save">Save</button></div>
  </div>`;
}

function readPanel(t) {
  if (!t) return `<div class="stage-panel"><p class="muted">No timestamps yet.</p><button class="btn primary" data-t="add">+ Create timestamps</button></div>`;
  return `<div class="stage-panel">
    <h4>TIMESTAMPS v${t.version_number} <span class="badge ${t.status === 'approved' ? 'green' : t.status === 'ready_for_review' ? 'amber' : ''}">${t.status}</span></h4>
    <div class="inspector-row">
      <button class="btn" data-t="add">New version</button>
      ${t.status !== 'approved' ? `<button class="btn primary" data-t="approve">Approve</button>` : ''}
    </div>
  </div>`;
}

function render(host) {
  const t = latestTimestamps();
  host.innerHTML = `<div class="stage-livebar"><input id="t-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="t-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-t="connect">Connect</button>${state.live ? '<button class="btn" data-t="refresh">Refresh</button>' : ''}</div>
  ${!state.live ? `<div class="stage-empty">Connect to a live project to manage real timestamps. The mapping shown elsewhere on this page is illustrative preview data.</div>` : `<div class="stage-body">${state.mode === 'add' ? draftForm() : readPanel(t)}</div>`}`;
}

const rerender = mountStageOverlay('Timestamps', render, async () => { if (state.projectId) await loadLiveProject(); });

document.addEventListener('click', async event => {
  const action = event.target.closest('[data-t]')?.dataset.t;
  if (!action) return;
  if (action === 'connect' || action === 'refresh') {
    state.projectId = document.querySelector('#t-project-id')?.value || state.projectId;
    state.token = document.querySelector('#t-api-token')?.value || state.token;
    setConnection(state.projectId, state.token);
    await loadLiveProject();
    rerender();
    return;
  }
  if (action === 'add') { state.mode = 'add'; rerender(); return; }
  if (action === 'cancel') { state.mode = 'view'; rerender(); return; }
  if (action === 'save') {
    const rows = [...document.querySelectorAll('[data-t-scene]')].map(row => ({
      sceneId: row.dataset.tScene,
      sceneNumber: row.dataset.tNumber,
      startMs: Number(row.querySelector('.t-start')?.value),
      endMs: Number(row.querySelector('.t-end')?.value)
    }));
    await saveDraft(rows);
    rerender();
    return;
  }
  if (action === 'approve') {
    const t = latestTimestamps();
    if (t) await approve(t.id);
    rerender();
  }
});

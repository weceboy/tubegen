import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = { ...getConnection(), live: false, project: null, mode: 'view', lastSnapshotId: null };

function apiPath(suffix) { return `/api/projects/${encodeURIComponent(state.projectId)}${suffix}`; }
function latestVoiceover() { return state.project?.voiceovers?.[0] || null; }

async function loadLiveProject() {
  if (!state.projectId) return false;
  try {
    state.project = await apiRequest(apiPath(''), 'GET', state.token);
    state.live = true;
    return true;
  } catch (error) { state.live = false; notify(error.message); return false; }
}

async function createSnapshot() {
  try {
    const snapshot = await apiRequest(apiPath('/narration-snapshots'), 'POST', state.token);
    state.lastSnapshotId = snapshot.id;
    notify('Narration snapshot created — ready to record a voiceover version');
  } catch (error) { notify(error.message); }
}

async function saveDraft(fields) {
  if (!state.lastSnapshotId) { notify('Create a narration snapshot first'); return; }
  if (!fields.voiceModel.trim()) { notify('Voice model is required'); return; }
  try {
    await apiRequest(apiPath('/voiceovers'), 'POST', state.token, { body: JSON.stringify({
      narrationSnapshotId: state.lastSnapshotId, voiceModel: fields.voiceModel,
      objectKey: fields.objectKey || undefined, durationMs: fields.durationMs ? Number(fields.durationMs) : undefined
    }) });
    notify('Voiceover version created');
    state.mode = 'view';
    state.lastSnapshotId = null;
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

async function approve(id) {
  try {
    await apiRequest(apiPath('/approve'), 'POST', state.token, { body: JSON.stringify({ artifactType: 'voiceover', artifactVersionId: id, approvalMode: 'human' }) });
    notify('Voiceover approved');
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

function draftForm() {
  if (!state.lastSnapshotId) {
    return `<div class="stage-panel"><h4>NEW VOICEOVER</h4><p class="muted">A narration snapshot captures the current approved scene narration. Create one, then record a voiceover version against it.</p>
      <div class="inspector-row"><button class="btn" data-v="cancel">Cancel</button><button class="btn primary" data-v="snapshot">Create narration snapshot</button></div>
    </div>`;
  }
  return `<div class="stage-panel">
    <h4>NEW VOICEOVER VERSION</h4>
    <p class="muted">Narration snapshot ${escapeHtml(state.lastSnapshotId)} ready.</p>
    <label>VOICE MODEL</label><input id="v-f-model" placeholder="e.g. ElevenLabs / Adam">
    <label>OBJECT KEY (optional)</label><input id="v-f-key" placeholder="storage path, filled in once rendered">
    <label>DURATION MS (optional)</label><input id="v-f-duration" type="number" min="0">
    <div class="inspector-row"><button class="btn" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Save</button></div>
  </div>`;
}

function readPanel(v) {
  if (!v) return `<div class="stage-panel"><p class="muted">No voiceover yet.</p><button class="btn primary" data-v="add">+ Create voiceover</button></div>`;
  return `<div class="stage-panel">
    <h4>VOICEOVER v${v.version_number} <span class="badge ${v.status === 'approved' ? 'green' : v.status === 'ready_for_review' ? 'amber' : ''}">${v.status}</span></h4>
    <label>VOICE MODEL</label><p class="stage-readtext">${escapeHtml(v.voice_model || '—')}</p>
    <label>DURATION</label><p class="stage-readtext">${v.duration_ms ? `${Math.round(v.duration_ms / 1000)}s` : '—'}</p>
    <div class="inspector-row">
      <button class="btn" data-v="add">New version</button>
      ${v.status !== 'approved' ? `<button class="btn primary" data-v="approve">Approve</button>` : ''}
    </div>
  </div>`;
}

function render(host) {
  const v = latestVoiceover();
  host.innerHTML = `<div class="stage-livebar"><input id="v-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="v-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-v="connect">Connect</button>${state.live ? '<button class="btn" data-v="refresh">Refresh</button>' : ''}</div>
  ${!state.live ? `<div class="stage-empty">Connect to a live project to manage the real voiceover. The player shown elsewhere on this page is illustrative preview data.</div>` : `<div class="stage-body">${state.mode === 'add' ? draftForm() : readPanel(v)}</div>`}`;
}

const rerender = mountStageOverlay('Voiceover', render, async () => { if (state.projectId) await loadLiveProject(); });

document.addEventListener('click', async event => {
  const action = event.target.closest('[data-v]')?.dataset.v;
  if (!action) return;
  if (action === 'connect' || action === 'refresh') {
    state.projectId = document.querySelector('#v-project-id')?.value || state.projectId;
    state.token = document.querySelector('#v-api-token')?.value || state.token;
    setConnection(state.projectId, state.token);
    await loadLiveProject();
    rerender();
    return;
  }
  if (action === 'add') { state.mode = 'add'; rerender(); return; }
  if (action === 'cancel') { state.mode = 'view'; state.lastSnapshotId = null; rerender(); return; }
  if (action === 'snapshot') { await createSnapshot(); rerender(); return; }
  if (action === 'save') {
    await saveDraft({
      voiceModel: document.querySelector('#v-f-model')?.value || '',
      objectKey: document.querySelector('#v-f-key')?.value || '',
      durationMs: document.querySelector('#v-f-duration')?.value || ''
    });
    rerender();
    return;
  }
  if (action === 'approve') {
    const v = latestVoiceover();
    if (v) await approve(v.id);
    rerender();
  }
});

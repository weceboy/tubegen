import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = { ...getConnection(), live: false, project: null, mode: 'view' };

function apiPath(suffix) { return `/api/projects/${encodeURIComponent(state.projectId)}${suffix}`; }
function latestScript() { return state.project?.scripts?.[0] || null; }
function approvedResearch() { return state.project?.research?.find(r => r.status === 'approved') || null; }

async function loadLiveProject() {
  if (!state.projectId) return false;
  try {
    state.project = await apiRequest(apiPath(''), 'GET', state.token);
    state.live = true;
    return true;
  } catch (error) { state.live = false; notify(error.message); return false; }
}

async function saveDraft(content) {
  if (!content.trim()) { notify('Script content is required'); return; }
  if (!approvedResearch()) { notify('An approved research version is required before script generation'); return; }
  try {
    await apiRequest(apiPath('/scripts'), 'POST', state.token, { body: JSON.stringify({ content }) });
    notify('Script version created');
    state.mode = 'view';
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

async function approve(id) {
  try {
    await apiRequest(apiPath('/approve'), 'POST', state.token, { body: JSON.stringify({ artifactType: 'script', artifactVersionId: id, approvalMode: 'human' }) });
    notify('Script approved');
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

function draftForm(existing) {
  return `<div class="stage-panel">
    <h4>${existing ? 'NEW SCRIPT VERSION' : 'NEW SCRIPT'}</h4>
    ${!approvedResearch() ? '<p class="muted">No approved research version yet — script creation is blocked.</p>' : ''}
    <label>CONTENT</label><textarea id="s-f-content" class="large">${escapeHtml(existing?.content || '')}</textarea>
    <div class="inspector-row"><button class="btn" data-s="cancel">Cancel</button><button class="btn primary" data-s="save" ${approvedResearch() ? '' : 'disabled'}>Save</button></div>
  </div>`;
}

function readPanel(s) {
  if (!s) return `<div class="stage-panel"><p class="muted">No script yet.</p><button class="btn primary" data-s="add" ${approvedResearch() ? '' : 'disabled'}>+ Create script</button>${!approvedResearch() ? '<p class="muted">Requires an approved research version.</p>' : ''}</div>`;
  return `<div class="stage-panel">
    <h4>SCRIPT v${s.version_number} <span class="badge ${s.status === 'approved' ? 'green' : s.status === 'ready_for_review' ? 'amber' : ''}">${s.status}</span></h4>
    <label>CONTENT</label><p class="stage-readtext">${escapeHtml(s.content || '—')}</p>
    <div class="inspector-row">
      <button class="btn" data-s="add">New version</button>
      ${s.status !== 'approved' ? `<button class="btn primary" data-s="approve">Approve</button>` : ''}
    </div>
  </div>`;
}

function render(host) {
  const s = latestScript();
  host.innerHTML = `<div class="stage-livebar"><input id="s-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="s-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-s="connect">Connect</button>${state.live ? '<button class="btn" data-s="refresh">Refresh</button>' : ''}</div>
  ${!state.live ? `<div class="stage-empty">Connect to a live project to manage the real script. The editor shown elsewhere on this page is illustrative preview data.</div>` : `<div class="stage-body">${state.mode === 'add' ? draftForm(s) : readPanel(s)}</div>`}`;
}

const rerender = mountStageOverlay('Script', render, async () => { if (state.projectId) await loadLiveProject(); });

document.addEventListener('click', async event => {
  const action = event.target.closest('[data-s]')?.dataset.s;
  if (!action) return;
  if (action === 'connect' || action === 'refresh') {
    state.projectId = document.querySelector('#s-project-id')?.value || state.projectId;
    state.token = document.querySelector('#s-api-token')?.value || state.token;
    setConnection(state.projectId, state.token);
    await loadLiveProject();
    rerender();
    return;
  }
  if (action === 'add') { state.mode = 'add'; rerender(); return; }
  if (action === 'cancel') { state.mode = 'view'; rerender(); return; }
  if (action === 'save') {
    await saveDraft(document.querySelector('#s-f-content')?.value || '');
    rerender();
    return;
  }
  if (action === 'approve') {
    const s = latestScript();
    if (s) await approve(s.id);
    rerender();
  }
});

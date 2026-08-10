import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = { ...getConnection(), live: false, project: null, mode: 'view' };

function apiPath(suffix) { return `/api/projects/${encodeURIComponent(state.projectId)}${suffix}`; }
function latestResearch() { return state.project?.research?.[0] || null; }

async function loadLiveProject() {
  if (!state.projectId) return false;
  try {
    state.project = await apiRequest(apiPath(''), 'GET', state.token);
    state.live = true;
    return true;
  } catch (error) { state.live = false; notify(error.message); return false; }
}

async function saveDraft(fields) {
  if (!fields.topic.trim()) { notify('Topic is required'); return; }
  try {
    await apiRequest(apiPath('/research'), 'POST', state.token, { body: JSON.stringify({
      topic: fields.topic, audience: fields.audience, angle: fields.angle, summary: fields.summary,
      targetLength: fields.targetLength,
      sources: fields.sourcesText.split('\n').map(s => s.trim()).filter(Boolean).map(url => ({ url }))
    }) });
    notify('Research version created');
    state.mode = 'view';
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

async function approve(id) {
  try {
    await apiRequest(apiPath('/approve'), 'POST', state.token, { body: JSON.stringify({ artifactType: 'research', artifactVersionId: id, approvalMode: 'human' }) });
    notify('Research approved');
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

function draftForm(existing) {
  const d = { topic: existing?.topic || '', audience: existing?.audience || '', angle: existing?.angle || '', summary: existing?.summary || '', targetLength: existing?.target_length || '', sourcesText: '' };
  return `<div class="stage-panel">
    <h4>${existing ? 'NEW RESEARCH VERSION' : 'NEW RESEARCH'}</h4>
    <label>TOPIC</label><input id="r-f-topic" value="${escapeHtml(d.topic)}">
    <label>TARGET AUDIENCE</label><input id="r-f-audience" value="${escapeHtml(d.audience)}">
    <label>ANGLE</label><textarea id="r-f-angle">${escapeHtml(d.angle)}</textarea>
    <label>TARGET LENGTH</label><input id="r-f-length" value="${escapeHtml(d.targetLength)}" placeholder="e.g. 4-5 min">
    <label>SUMMARY</label><textarea id="r-f-summary" class="large">${escapeHtml(d.summary)}</textarea>
    <label>SOURCES (one URL per line)</label><textarea id="r-f-sources"></textarea>
    <div class="inspector-row"><button class="btn" data-r="cancel">Cancel</button><button class="btn primary" data-r="save">Save</button></div>
  </div>`;
}

function readPanel(r) {
  if (!r) return `<div class="stage-panel"><p class="muted">No research yet.</p><button class="btn primary" data-r="add">+ Create research</button></div>`;
  return `<div class="stage-panel">
    <h4>RESEARCH v${r.version_number} <span class="badge ${r.status === 'approved' ? 'green' : r.status === 'ready_for_review' ? 'amber' : ''}">${r.status}</span></h4>
    <label>TOPIC</label><p class="stage-readtext">${escapeHtml(r.topic || '—')}</p>
    <label>AUDIENCE</label><p class="stage-readtext">${escapeHtml(r.audience || '—')}</p>
    <label>ANGLE</label><p class="stage-readtext">${escapeHtml(r.angle || '—')}</p>
    <label>SUMMARY</label><p class="stage-readtext">${escapeHtml(r.summary || '—')}</p>
    <div class="inspector-row">
      <button class="btn" data-r="add">New version</button>
      ${r.status !== 'approved' ? `<button class="btn primary" data-r="approve">Approve</button>` : ''}
    </div>
  </div>`;
}

function render(host) {
  const r = latestResearch();
  host.innerHTML = `<div class="stage-livebar"><input id="r-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="r-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-r="connect">Connect</button>${state.live ? '<button class="btn" data-r="refresh">Refresh</button>' : ''}</div>
  ${!state.live ? `<div class="stage-empty">Connect to a live project to manage real research. The panel shown elsewhere on this page is illustrative preview data.</div>` : `<div class="stage-body">${state.mode === 'add' ? draftForm(r) : readPanel(r)}</div>`}`;
}

const rerender = mountStageOverlay('Research', render, async () => { if (state.projectId) await loadLiveProject(); });

document.addEventListener('click', async event => {
  const action = event.target.closest('[data-r]')?.dataset.r;
  if (!action) return;
  if (action === 'connect' || action === 'refresh') {
    state.projectId = document.querySelector('#r-project-id')?.value || state.projectId;
    state.token = document.querySelector('#r-api-token')?.value || state.token;
    setConnection(state.projectId, state.token);
    await loadLiveProject();
    rerender();
    return;
  }
  if (action === 'add') { state.mode = 'add'; rerender(); return; }
  if (action === 'cancel') { state.mode = 'view'; rerender(); return; }
  if (action === 'save') {
    await saveDraft({
      topic: document.querySelector('#r-f-topic')?.value || '',
      audience: document.querySelector('#r-f-audience')?.value || '',
      angle: document.querySelector('#r-f-angle')?.value || '',
      summary: document.querySelector('#r-f-summary')?.value || '',
      targetLength: document.querySelector('#r-f-length')?.value || '',
      sourcesText: document.querySelector('#r-f-sources')?.value || ''
    });
    rerender();
    return;
  }
  if (action === 'approve') {
    const r = latestResearch();
    if (r) await approve(r.id);
    rerender();
  }
});

import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = {
  ...getConnection(), live: false, project: null, buildErrors: null, gate: null, renderResult: null,
  renderJobs: [], publishes: [], releases: [], manifests: [], packages: [], bundles: [],
  revokeForm: false, deliverForm: false, exportForm: false
};

function apiPath(suffix) { return `/api/projects/${encodeURIComponent(state.projectId)}${suffix}`; }
function activeRelease() { return state.releases.find(r => r.status === 'active') || state.releases[0] || null; }
function isPublished(jobId) { return state.publishes.some(p => p.render_job_id === jobId); }

async function loadLiveProject() {
  if (!state.projectId) return false;
  try {
    state.project = await apiRequest(apiPath(''), 'GET', state.token);
    state.live = true;
    return true;
  } catch (error) { state.live = false; notify(error.message); return false; }
}

async function loadDeliveryState() {
  if (!state.projectId) return;
  try {
    const [jobs, publishes, releases, manifests, packages, bundles] = await Promise.all([
      apiRequest(apiPath('/render-jobs'), 'GET', state.token),
      apiRequest(apiPath('/publishes'), 'GET', state.token),
      apiRequest(apiPath('/releases'), 'GET', state.token),
      apiRequest(apiPath('/delivery-manifests'), 'GET', state.token),
      apiRequest(apiPath('/delivery-packages'), 'GET', state.token),
      apiRequest(apiPath('/delivery-bundles'), 'GET', state.token)
    ]);
    state.renderJobs = jobs; state.publishes = publishes; state.releases = releases;
    state.manifests = manifests; state.packages = packages; state.bundles = bundles;
  } catch (error) { notify(error.message); }
}

const BUILD_PATH = { timeline: '/timeline', rough: '/rough-cuts', fine: '/fine-cuts' };
const ARTIFACT_TYPE = { timeline: 'timeline', rough: 'rough_cut', fine: 'fine_cut' };

async function build(kind) {
  try {
    const payload = await apiRequest(apiPath(BUILD_PATH[kind]), 'POST', state.token, { body: JSON.stringify({}) });
    if (payload.errors) { state.buildErrors = { kind, errors: payload.errors }; notify('Not ready yet — see blocking requirements'); }
    else { state.buildErrors = null; notify(`${kind === 'timeline' ? 'Timeline' : kind === 'rough' ? 'Rough cut' : 'Fine cut'} built`); await loadLiveProject(); }
  } catch (error) { notify(error.message); }
}

async function approve(kind, id) {
  try {
    await apiRequest(apiPath('/approve'), 'POST', state.token, { body: JSON.stringify({ artifactType: ARTIFACT_TYPE[kind], artifactVersionId: id, approvalMode: 'human' }) });
    notify('Approved');
    await loadLiveProject();
  } catch (error) { notify(error.message); }
}

async function checkGate() {
  try { state.gate = await apiRequest(apiPath('/render-gate'), 'GET', state.token); notify(state.gate.ok ? 'Render gate is ready' : 'Render gate is blocked — see requirements'); }
  catch (error) { notify(error.message); }
}

async function requestRender() {
  try {
    state.renderResult = await apiRequest(apiPath('/render'), 'POST', state.token, { body: JSON.stringify({}) });
    notify(state.renderResult.accepted ? 'Final render requested' : 'Render blocked — see gate requirements');
    await loadLiveProject();
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function publishJob(jobId) {
  if (!jobId) return;
  try {
    await apiRequest(apiPath('/publish'), 'POST', state.token, { body: JSON.stringify({ jobId }) });
    notify('Render published');
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function createRelease() {
  const publish = state.publishes[0];
  if (!publish) { notify('Publish a completed render first'); return; }
  try {
    await apiRequest(apiPath('/releases'), 'POST', state.token, { body: JSON.stringify({ renderJobId: publish.render_job_id }) });
    notify('Release created');
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function revokeRelease() {
  const release = activeRelease();
  if (!release) return;
  const reason = document.querySelector('#e-revoke-reason')?.value || '';
  try {
    await apiRequest(apiPath(`/releases/${encodeURIComponent(release.id)}/revoke`), 'POST', state.token, { body: JSON.stringify({ reason }) });
    notify('Release revoked');
    state.revokeForm = false;
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function createManifest() {
  const release = activeRelease();
  if (!release) return;
  try {
    await apiRequest(apiPath(`/releases/${encodeURIComponent(release.id)}/delivery-manifest`), 'POST', state.token);
    notify('Delivery manifest created');
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function createPackage() {
  const release = activeRelease();
  if (!release) return;
  try {
    await apiRequest(apiPath(`/releases/${encodeURIComponent(release.id)}/delivery-package`), 'POST', state.token);
    notify('Delivery package created');
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function deliverPackage() {
  const pkg = state.packages[0];
  if (!pkg) return;
  const deliveryReference = document.querySelector('#e-delivery-ref')?.value || '';
  try {
    await apiRequest(apiPath(`/delivery-packages/${encodeURIComponent(pkg.id)}/deliver`), 'POST', state.token, { body: JSON.stringify({ deliveryReference }) });
    notify('Marked as delivered');
    state.deliverForm = false;
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function createBundle() {
  const release = activeRelease();
  if (!release) return;
  try {
    await apiRequest(apiPath(`/releases/${encodeURIComponent(release.id)}/delivery-bundle`), 'POST', state.token);
    notify('Delivery bundle created');
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

async function exportBundle() {
  const bundle = state.bundles[0];
  if (!bundle) return;
  const exportReference = document.querySelector('#e-export-ref')?.value || '';
  try {
    await apiRequest(apiPath(`/delivery-bundles/${encodeURIComponent(bundle.id)}/export`), 'POST', state.token, { body: JSON.stringify({ exportReference }) });
    notify('Bundle exported');
    state.exportForm = false;
    await loadDeliveryState();
  } catch (error) { notify(error.message); }
}

function errorList(errors) {
  if (!errors?.length) return '';
  return `<div class="stage-errors">${errors.map(e => `<div>${escapeHtml(e.message || e.code || JSON.stringify(e))}</div>`).join('')}</div>`;
}

function artifactPanel(title, latest, kind, buildLabel) {
  const showErrors = state.buildErrors?.kind === kind ? state.buildErrors.errors : null;
  return `<div class="stage-panel">
    <h4>${title} ${latest ? `<span class="badge ${latest.status === 'approved' ? 'green' : latest.status === 'ready_for_review' ? 'amber' : ''}">v${latest.version_number} · ${latest.status}</span>` : '<span class="badge">not built</span>'}</h4>
    <div class="inspector-row">
      <button class="btn" data-e="build-${kind}">${buildLabel}</button>
      ${latest && latest.status !== 'approved' ? `<button class="btn primary" data-e="approve-${kind}">Approve</button>` : ''}
    </div>
    ${errorList(showErrors)}
  </div>`;
}

function gatePanel() {
  const g = state.gate;
  return `<div class="stage-panel">
    <h4>FINAL RENDER GATE ${g ? `<span class="badge ${g.ok ? 'green' : 'amber'}">${g.ok ? 'ready' : 'blocked'}</span>` : ''}</h4>
    <div class="inspector-row"><button class="btn" data-e="check-gate">Check render gate</button><button class="btn primary" data-e="request-render" ${g?.ok ? '' : 'disabled'}>Request final render</button></div>
    ${g && !g.ok ? errorList(g.errors) : ''}
    ${state.renderResult ? `<p class="muted">${state.renderResult.accepted ? `Render job queued (job ${escapeHtml(state.renderResult.job?.id || '')}). No real renderer is configured by default — see the render jobs panel below.` : 'Render request rejected — resolve the gate requirements above.'}</p>` : ''}
  </div>`;
}

function renderJobsPanel() {
  const jobs = state.renderJobs;
  return `<div class="stage-panel">
    <h4>RENDER JOBS</h4>
    ${jobs.length ? jobs.slice(0, 5).map(j => `<div class="stage-row"><span>${escapeHtml(j.id)} <span class="badge ${j.status === 'completed' ? 'green' : j.status === 'failed' ? '' : 'amber'}">${j.status}</span></span>${j.status === 'completed' ? (isPublished(j.id) ? '<span class="muted">published</span>' : `<button class="btn" data-e="publish-job" data-job-id="${escapeHtml(j.id)}">Publish</button>`) : ''}</div>`).join('')
      : '<p class="muted">No render jobs yet — request a final render above, then run <code>npm run worker:render</code> to process the queue.</p>'}
  </div>`;
}

function publishReleasePanel() {
  const publish = state.publishes[0] || null;
  const release = activeRelease();
  return `<div class="stage-panel">
    <h4>PUBLISH &amp; RELEASE ${release ? `<span class="badge ${release.status === 'active' ? 'green' : ''}">release v${release.release_number} · ${release.status}</span>` : publish ? '<span class="badge amber">published, not released</span>' : '<span class="badge">not published</span>'}</h4>
    <p class="muted">${publish ? `Published render job ${escapeHtml(publish.render_job_id)}.` : 'Publish a completed render job in the panel above to continue.'}</p>
    <div class="inspector-row">
      <button class="btn primary" data-e="create-release" ${publish ? '' : 'disabled'}>Create release</button>
      ${release && release.status === 'active' && !state.revokeForm ? '<button class="btn danger" data-e="show-revoke">Revoke release</button>' : ''}
    </div>
    ${state.revokeForm ? `<label>REVOKE REASON</label><input id="e-revoke-reason" placeholder="why is this release being revoked?"><div class="inspector-row"><button class="btn" data-e="hide-revoke">Cancel</button><button class="btn danger" data-e="revoke-release">Confirm revoke</button></div>` : ''}
  </div>`;
}

function deliveryPanel() {
  const release = activeRelease();
  const manifest = state.manifests[0] || null;
  const pkg = state.packages[0] || null;
  const bundle = state.bundles[0] || null;
  return `<div class="stage-panel">
    <h4>DELIVERY</h4>
    ${!release ? '<p class="muted">Create an active release first.</p>' : `
    <div class="stage-row"><span>Manifest ${manifest ? '<span class="badge green">created</span>' : '<span class="badge">none</span>'}</span><button class="btn" data-e="create-manifest">Create manifest</button></div>
    <div class="stage-row"><span>Package ${pkg ? `<span class="badge ${pkg.status === 'delivered' ? 'green' : 'amber'}">${pkg.status}</span>` : '<span class="badge">none</span>'}</span><button class="btn" data-e="create-package" ${manifest ? '' : 'disabled'}>Create package</button></div>
    ${pkg && pkg.status !== 'delivered' ? (state.deliverForm ? `<label>DELIVERY REFERENCE</label><input id="e-delivery-ref" placeholder="s3://... or similar"><div class="inspector-row"><button class="btn" data-e="hide-deliver">Cancel</button><button class="btn primary" data-e="deliver-package">Confirm delivered</button></div>` : `<div class="inspector-row"><button class="btn primary" data-e="show-deliver">Mark delivered</button></div>`) : ''}
    <div class="stage-row"><span>Bundle ${bundle ? `<span class="badge ${bundle.status === 'exported' ? 'green' : 'amber'}">${bundle.status}</span>` : '<span class="badge">none</span>'}</span><button class="btn" data-e="create-bundle" ${pkg ? '' : 'disabled'}>Create bundle</button></div>
    ${bundle && bundle.status !== 'exported' ? (state.exportForm ? `<label>EXPORT REFERENCE</label><input id="e-export-ref" placeholder="file:// or similar"><div class="inspector-row"><button class="btn" data-e="hide-export">Cancel</button><button class="btn primary" data-e="export-bundle">Confirm export</button></div>` : `<div class="inspector-row"><button class="btn primary" data-e="show-export">Export bundle</button></div>`) : ''}
    `}
  </div>`;
}

function render(host) {
  const timeline = state.project?.timelines?.[0] || null;
  const rough = state.project?.roughCuts?.[0] || null;
  const fine = state.project?.fineCuts?.[0] || null;
  host.innerHTML = `<div class="stage-livebar"><input id="e-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="e-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-e="connect">Connect</button>${state.live ? '<button class="btn" data-e="refresh">Refresh</button>' : ''}</div>
  ${!state.live ? `<div class="stage-empty">Connect to a live project to build and render real artifacts. The preview shown elsewhere on this page is illustrative.</div>` : `<div class="stage-body">
    ${artifactPanel('TIMELINE', timeline, 'timeline', 'Build timeline')}
    ${artifactPanel('ROUGH CUT', rough, 'rough', 'Build rough cut')}
    ${artifactPanel('FINE CUT', fine, 'fine', 'Build fine cut')}
    ${gatePanel()}
    ${renderJobsPanel()}
    ${publishReleasePanel()}
    ${deliveryPanel()}
  </div>`}`;
}

const rerender = mountStageOverlay('Edit', render, async () => { if (state.projectId) { await loadLiveProject(); await loadDeliveryState(); } });

document.addEventListener('click', async event => {
  const action = event.target.closest('[data-e]')?.dataset.e;
  if (!action) return;
  if (action === 'connect' || action === 'refresh') {
    state.projectId = document.querySelector('#e-project-id')?.value || state.projectId;
    state.token = document.querySelector('#e-api-token')?.value || state.token;
    setConnection(state.projectId, state.token);
    await loadLiveProject();
    await loadDeliveryState();
    rerender();
    return;
  }
  if (action.startsWith('build-')) { await build(action.slice(6)); rerender(); return; }
  if (action.startsWith('approve-')) {
    const kind = action.slice(8);
    const latest = kind === 'timeline' ? state.project?.timelines?.[0] : kind === 'rough' ? state.project?.roughCuts?.[0] : state.project?.fineCuts?.[0];
    if (latest) await approve(kind, latest.id);
    rerender();
    return;
  }
  if (action === 'check-gate') { await checkGate(); rerender(); return; }
  if (action === 'request-render') { await requestRender(); rerender(); return; }
  if (action === 'publish-job') { await publishJob(event.target.closest('[data-job-id]')?.dataset.jobId); rerender(); return; }
  if (action === 'create-release') { await createRelease(); rerender(); return; }
  if (action === 'show-revoke') { state.revokeForm = true; rerender(); return; }
  if (action === 'hide-revoke') { state.revokeForm = false; rerender(); return; }
  if (action === 'revoke-release') { await revokeRelease(); rerender(); return; }
  if (action === 'create-manifest') { await createManifest(); rerender(); return; }
  if (action === 'create-package') { await createPackage(); rerender(); return; }
  if (action === 'show-deliver') { state.deliverForm = true; rerender(); return; }
  if (action === 'hide-deliver') { state.deliverForm = false; rerender(); return; }
  if (action === 'deliver-package') { await deliverPackage(); rerender(); return; }
  if (action === 'create-bundle') { await createBundle(); rerender(); return; }
  if (action === 'show-export') { state.exportForm = true; rerender(); return; }
  if (action === 'hide-export') { state.exportForm = false; rerender(); return; }
  if (action === 'export-bundle') { await exportBundle(); rerender(); }
});

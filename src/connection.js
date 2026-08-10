export function getConnection() {
  return {
    projectId: localStorage.getItem('autodoc-project-id') || '',
    token: localStorage.getItem('autodoc-api-token') || ''
  };
}

export function setConnection(projectId, token) {
  localStorage.setItem('autodoc-project-id', projectId.trim());
  localStorage.setItem('autodoc-api-token', token.trim());
}

function apiHeaders(token) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export async function apiRequest(path, method = 'GET', token = '', options = {}) {
  const response = await fetch(path, { ...options, method, headers: { ...apiHeaders(token), ...(options.headers || {}) } });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!response.ok) throw new Error(payload.error || `API request failed (${response.status})`);
  return payload;
}

export function notify(message) {
  const t = document.querySelector('#toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.remove('show'), 2400);
}

export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

let overlayStyleInjected = false;
function ensureOverlayStyle() {
  if (overlayStyleInjected) return;
  overlayStyleInjected = true;
  const style = document.createElement('style');
  style.id = 'stage-overlay-style';
  style.textContent = `
.stage-livebar{display:flex;gap:7px;align-items:center;padding:11px 13px;border-bottom:1px solid var(--line)}
.stage-livebar input{min-width:0;flex:1;background:#0b1118;border:1px solid var(--line);color:var(--text);border-radius:5px;padding:7px;font-size:11px}
.stage-livebar button{white-space:nowrap}
.stage-empty{padding:20px;color:#718093;font-size:12px}
.stage-body{padding:14px;display:grid;gap:14px}
.stage-panel{border:1px solid var(--line);border-radius:7px;background:#0d141c;padding:14px}
.stage-panel h4{margin:0 0 9px;font-size:12px;display:flex;align-items:center;gap:8px}
.stage-panel label{display:block;color:#718093;font-size:9px;letter-spacing:.08em;margin:12px 0 5px;text-transform:uppercase}
.stage-panel input,.stage-panel textarea{width:100%;box-sizing:border-box;background:#0b1118;color:var(--text);border:1px solid var(--line);border-radius:5px;padding:8px;font:inherit;resize:vertical;transition:border-color .12s ease}
.stage-panel input:focus,.stage-panel textarea:focus{border-color:#527ca8;outline:none}
.stage-panel textarea{min-height:62px}
.stage-panel textarea.large{min-height:120px}
.stage-readtext{background:#0b1118;border:1px solid var(--line);border-radius:5px;padding:8px;color:#c3ccd6;white-space:pre-wrap;margin:0;min-height:20px}
.stage-row{display:flex;justify-content:space-between;gap:10px}
.stage-errors{display:grid;gap:5px;margin-top:8px}
.stage-errors div{background:#1f1414;border:1px solid #422;border-radius:5px;padding:6px 8px;color:#f3a3a3;font-size:11px}
.stage-mapping{display:grid;grid-template-columns:1fr 100px 100px;gap:8px;align-items:center;margin:6px 0}
.stage-mapping input{width:100%;box-sizing:border-box;background:#0b1118;border:1px solid var(--line);color:var(--text);border-radius:5px;padding:6px;font-size:11px}
.stage-mapping label{font-size:11px;color:#b8c2ce;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn.danger{background:#3a1414;border-color:#5c2222;color:#f3a3a3}
.btn.danger:hover{background:#4a1818}
`;
  document.head.appendChild(style);
}

// Mounts a stage-scoped overlay: `render(host)` is called whenever the given
// pipeline stage becomes selected and its main-workspace DOM is (re)created
// by the mock app shell. `onMount` (if given) runs once per stage visit,
// before that first render, so each stage picks up state other stages may
// have changed (e.g. an approval) instead of showing a stale snapshot from
// whenever this module first loaded the project. Returns a `rerender()` you
// can call after actions to refresh without waiting for the next DOM
// mutation.
export function mountStageOverlay(stageLabel, render, onMount) {
  ensureOverlayStyle();
  function host() {
    const project = document.querySelector('#project');
    if (!project) return null;
    const selectedStage = project.querySelector('.stage.selected b');
    if (!selectedStage || selectedStage.textContent !== stageLabel) return null;
    return project.querySelector('.main-workspace');
  }
  function rerender() {
    const h = host();
    if (h) render(h);
    return h;
  }
  async function patch() {
    const h = host();
    if (h && !h.dataset.overlayEnhanced) {
      h.dataset.overlayEnhanced = stageLabel;
      if (onMount) await onMount();
      render(h);
    }
  }
  const observer = new MutationObserver(() => queueMicrotask(patch));
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(patch, 0);
  return rerender;
}

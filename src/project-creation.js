import { enhanceSelect } from './select.js';
import { getConnection, setConnection } from './connection.js';

const style = document.createElement('style');
style.textContent = `
.project-create-backdrop{position:fixed;inset:0;background:rgba(6,9,13,.66);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:1000;padding:20px;animation:project-create-fade .15s ease}
.project-create-modal{width:min(520px,100%);background:#111923;border:1px solid #263445;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:22px;animation:project-create-pop .16s cubic-bezier(.2,.9,.3,1.2)}
@keyframes project-create-fade{from{opacity:0}to{opacity:1}}
@keyframes project-create-pop{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.project-create-modal h2{margin:0 0 6px;font-size:20px}.project-create-modal p{margin:0 0 18px;color:#8290a1;font-size:12px}
.project-create-form{display:grid;gap:13px}.project-create-form label{display:grid;gap:6px;color:#8e9bad;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.project-create-form input{width:100%;box-sizing:border-box;background:#0b1118;color:#e8edf4;border:1px solid #2a394b;border-radius:7px;padding:10px 11px;font:inherit;outline:none;transition:border-color .12s ease}
.project-create-form input:focus{border-color:#527ca8}
.project-create-form input:focus-visible{outline:2px solid var(--blue);outline-offset:1px}
.project-create-error{min-height:16px;color:#f87171;font-size:11px;transition:opacity .12s ease}
.project-create-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:5px}
`;
document.head.appendChild(style);

let activeEscapeHandler = null;

function closeModal() {
  document.querySelector('.project-create-backdrop')?.remove();
  if (activeEscapeHandler) {
    document.removeEventListener('keydown', activeEscapeHandler);
    activeEscapeHandler = null;
  }
}

function openModal() {
  if (document.querySelector('.project-create-backdrop')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'project-create-backdrop';
  backdrop.innerHTML = `
    <div class="project-create-modal" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
      <h2 id="project-create-title">New project</h2>
      <p>Create a real production project. It will be persisted by the backend and opened after creation.</p>
      <form class="project-create-form">
        <label>Project name<input name="title" maxlength="200" autocomplete="off" placeholder="e.g. New Survival Video" required></label>
        <label>Channel<input name="channel" maxlength="100" value="Default" placeholder="Default"></label>
        <label>Target duration<select name="targetDurationSeconds"><option value="">Not set</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="180">3 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option></select></label>
        <div class="project-create-error" aria-live="polite"></div>
        <div class="project-create-actions"><button type="button" class="btn" data-project-cancel>Cancel</button><button type="submit" class="btn primary">Create project</button></div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);
  const form = backdrop.querySelector('form');
  const error = backdrop.querySelector('.project-create-error');
  enhanceSelect(form.elements.targetDurationSeconds);
  const isSubmitting = () => form.querySelector('button[type="submit"]').disabled;
  backdrop.addEventListener('click', event => { if (event.target === backdrop && !isSubmitting()) closeModal(); });
  backdrop.querySelector('[data-project-cancel]').addEventListener('click', () => { if (!isSubmitting()) closeModal(); });
  activeEscapeHandler = event => {
    if (event.key === 'Escape' && !isSubmitting()) closeModal();
  };
  document.addEventListener('keydown', activeEscapeHandler);
  form.elements.title.focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Creating…';
    const payload = {
      title: form.elements.title.value.trim(),
      channel: form.elements.channel.value.trim() || 'Default'
    };
    if (form.elements.targetDurationSeconds.value) payload.targetDurationSeconds = Number(form.elements.targetDurationSeconds.value);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Project creation failed (${response.status})`);
      setConnection(data.id, getConnection().token);
      closeModal();
      window.location.reload();
    } catch (err) {
      error.textContent = err.message || 'Project creation failed';
      submit.disabled = false;
      submit.textContent = 'Create project';
    }
  });
}

document.addEventListener('click', event => {
  const trigger = event.target.closest?.('[data-action="new"]');
  if (!trigger) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openModal();
}, true);

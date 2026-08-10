const style = document.createElement('style');
style.textContent = `
.custom-select{position:relative}
.custom-select-trigger{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#0b1118;color:#e8edf4;border:1px solid #2a394b;border-radius:7px;padding:10px 11px;font:inherit;text-align:left}
.custom-select-trigger:hover{border-color:#3a4d63}
.custom-select-trigger:focus-visible{outline:2px solid var(--blue,#3b82f6);outline-offset:2px}
.custom-select-trigger i{font-style:normal;color:#657385;transition:transform .15s ease;flex-shrink:0}
.custom-select.open .custom-select-trigger{border-color:#527ca8}
.custom-select.open .custom-select-trigger i{transform:rotate(180deg)}
.custom-select-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:40;background:#151d27;border:1px solid #2a394b;border-radius:8px;padding:4px;box-shadow:0 12px 32px rgba(0,0,0,.45);max-height:240px;overflow-y:auto;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .12s ease,transform .12s ease}
.custom-select.open .custom-select-list{opacity:1;transform:none;pointer-events:auto}
.custom-select-option{padding:8px 10px;border-radius:5px;color:#c3ccd6;cursor:pointer;font-size:13px}
.custom-select-option:hover,.custom-select-option.active{background:#1b2634;color:#fff}
.custom-select-option.selected{color:#60a5fa}
.native-select-hidden{position:absolute;opacity:0;width:0;height:0;padding:0;margin:0;border:0;pointer-events:none;overflow:hidden}
`;
document.head.appendChild(style);

let openInstance = null;

export function enhanceSelect(select) {
  if (!select || select.dataset.enhanced) return;
  select.dataset.enhanced = '1';
  select.classList.add('native-select-hidden');
  select.tabIndex = -1;

  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.innerHTML = '<span class="custom-select-label"></span><i>▾</i>';
  const list = document.createElement('div');
  list.className = 'custom-select-list';
  list.setAttribute('role', 'listbox');

  select.insertAdjacentElement('afterend', wrap);
  wrap.append(trigger, list, select);

  const label = trigger.querySelector('.custom-select-label');
  let activeIndex = select.selectedIndex;

  const options = () => [...select.options];

  function syncLabel() {
    label.textContent = select.options[select.selectedIndex]?.textContent || '';
  }

  function renderList() {
    list.innerHTML = options().map((o, i) => `<div class="custom-select-option ${i === select.selectedIndex ? 'selected' : ''} ${i === activeIndex ? 'active' : ''}" role="option" aria-selected="${i === select.selectedIndex}" data-index="${i}">${o.textContent}</div>`).join('');
  }

  function close() {
    wrap.classList.remove('open');
    document.removeEventListener('click', onOutsideClick);
    if (openInstance === closeAny) openInstance = null;
  }
  const closeAny = close;

  function onOutsideClick(event) {
    if (!wrap.contains(event.target)) close();
  }

  function open() {
    if (openInstance) openInstance();
    activeIndex = select.selectedIndex;
    renderList();
    wrap.classList.add('open');
    document.addEventListener('click', onOutsideClick);
    openInstance = close;
  }

  function choose(index) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncLabel();
    close();
    trigger.focus();
  }

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    wrap.classList.contains('open') ? close() : open();
  });

  list.addEventListener('click', event => {
    const opt = event.target.closest('.custom-select-option');
    if (opt) choose(Number(opt.dataset.index));
  });

  trigger.addEventListener('keydown', event => {
    const opts = options();
    if (!wrap.classList.contains('open')) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = Math.min(activeIndex + 1, opts.length - 1); renderList(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderList(); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(activeIndex); }
  });

  syncLabel();
}

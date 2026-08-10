import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = {
  scene: 0,
  mode: 'view', // 'view' | 'add' | 'edit'
  ...getConnection(),
  live: false,
  project: null
};

const css = `
.sc-livebar{display:flex;gap:7px;align-items:center;padding:11px 13px;border-bottom:1px solid var(--line)}
.sc-livebar input{min-width:0;flex:1;background:#0b1118;border:1px solid var(--line);color:var(--text);border-radius:5px;padding:7px;font-size:11px}
.sc-livebar button{white-space:nowrap}
.sc-empty,.sc-empty-list{padding:20px;color:#718093;font-size:12px}
.sc-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px}
.sc-list{border-right:1px solid var(--line);max-height:560px;overflow:auto}
.sc-row{display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:center;padding:10px 13px;border-bottom:1px solid #1d2631;cursor:pointer}
.sc-row:last-child{border:0}
.sc-row:hover,.sc-row.active{background:#16202c}
.sc-row-main small{display:block;color:#718093;margin-top:3px}
.sc-readtext{background:#0b1118;border:1px solid var(--line);border-radius:5px;padding:8px;color:#c3ccd6;white-space:pre-wrap;margin:0;min-height:20px}
.sc-form-row{display:flex;gap:7px;margin-top:13px}
.sc-form-row>*{flex:1}
`;

(function ensureStyle(){
  const style=document.createElement('style');
  style.id='sc-ui-style';
  style.textContent=css;
  document.head.appendChild(style);
})();

function apiPath(projectId,suffix){return `/api/projects/${encodeURIComponent(projectId)}${suffix}`}
function liveScenes(){return state.project?.scenes||[]}
function approvedScript(){return state.project?.scripts?.find(s=>s.status==='approved')||null}
function selected(){return liveScenes()[state.scene]||null}
function nextSceneNumber(){const nums=liveScenes().map(s=>s.scene_number);return nums.length?Math.max(...nums)+1:1}
function truncate(text,n){return text.length>n?text.slice(0,n-1)+'…':text}

async function loadLiveProject(){
  if(!state.projectId)return false;
  try{
    state.project=await apiRequest(apiPath(state.projectId,''),'GET',state.token);
    state.live=true;
    if(state.scene>=liveScenes().length)state.scene=0;
    return true;
  }catch(error){state.live=false;notify(error.message);return false}
}

function startAdd(){state.mode='add'}
function startEdit(){if(selected())state.mode='edit'}
function cancelDraft(){state.mode='view'}

async function saveDraft(fields){
  const script=approvedScript();
  if(!script){notify('An approved script version is required before creating scenes');return}
  if(!fields.narrationText.trim()){notify('Narration text is required');return}
  try{
    await apiRequest(apiPath(state.projectId,'/scenes'),'POST',state.token,{body:JSON.stringify({
      sourceScriptVersionId:script.id,
      sceneNumber:fields.sceneNumber,
      narrationText:fields.narrationText,
      imagePrompt:fields.imagePrompt||undefined,
      motionPrompt:fields.motionPrompt||undefined
    })});
    notify(state.mode==='edit'?'New scene version saved':'Scene created');
    state.mode='view';
    await loadLiveProject();
  }catch(error){notify(error.message)}
}

function sceneRow(s,i){
  return `<div class="sc-row ${i===state.scene&&state.mode==='view'?'active':''}" data-sc-scene="${i}">
    <span class="v33-num">${String(s.scene_number).padStart(2,'0')}</span>
    <div class="sc-row-main"><b>${escapeHtml(truncate(s.narration_text||'(no narration yet)',72))}</b><small>v${s.version_number||1} · ${s.status||'draft'}</small></div>
    <span class="badge ${s.status==='approved'?'green':s.status==='ready_for_review'?'amber':''}">${s.status||'draft'}</span>
  </div>`;
}

function draftForm(existing){
  const d={sceneNumber:existing?existing.scene_number:nextSceneNumber(),narrationText:existing?.narration_text||'',imagePrompt:existing?.image_prompt||'',motionPrompt:existing?.motion_prompt||''};
  return `<div class="inspector">
    <span class="eyebrow">${existing?'EDIT SCENE · NEW VERSION':'NEW SCENE'}</span>
    <label>SCENE NUMBER</label><input id="sc-f-number" type="number" min="1" value="${d.sceneNumber}" ${existing?'readonly':''}>
    <label>NARRATION</label><textarea id="sc-f-narration">${escapeHtml(d.narrationText)}</textarea>
    <label>IMAGE PROMPT</label><textarea id="sc-f-image">${escapeHtml(d.imagePrompt)}</textarea>
    <label>MOTION PROMPT</label><textarea id="sc-f-motion">${escapeHtml(d.motionPrompt)}</textarea>
    <div class="sc-form-row"><button class="btn" data-sc="cancel">Cancel</button><button class="btn primary" data-sc="save">Save</button></div>
  </div>`;
}

function readPanel(s){
  if(!s)return '<div class="sc-empty-list">Select a scene, or add a new one.</div>';
  return `<div class="inspector">
    <span class="eyebrow">SCENE ${String(s.scene_number).padStart(2,'0')} · v${s.version_number||1}</span>
    <label>STATUS</label><div><span class="badge ${s.status==='approved'?'green':s.status==='ready_for_review'?'amber':''}">${s.status||'draft'}</span></div>
    <label>NARRATION</label><p class="sc-readtext">${escapeHtml(s.narration_text||'—')}</p>
    <label>IMAGE PROMPT</label><p class="sc-readtext">${escapeHtml(s.image_prompt||'—')}</p>
    <label>MOTION PROMPT</label><p class="sc-readtext">${escapeHtml(s.motion_prompt||'—')}</p>
    <div class="inspector-row">
      <button class="btn" data-sc="edit">Edit (new version)</button>
      ${s.status!=='approved'?`<button class="btn primary" data-sc="approve">Approve</button>`:''}
    </div>
  </div>`;
}

async function approveScene(s){
  try{
    await apiRequest(apiPath(state.projectId,'/approve'),'POST',state.token,{body:JSON.stringify({artifactType:'scene',artifactVersionId:s.version_id,approvalMode:'human'})});
    notify('Scene approved');
    await loadLiveProject();
  }catch(error){notify(error.message)}
}

function renderPanel(host){
  const script=approvedScript();
  const list=liveScenes();
  host.innerHTML=`<div class="sc-livebar"><input id="sc-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="sc-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-sc="connect">Connect</button>${state.live?'<button class="btn" data-sc="refresh">Refresh</button>':''}</div>
  ${!state.live
    ? `<div class="sc-empty">Connect to a live project to create and edit real scenes. The scene table shown elsewhere on this page is illustrative preview data.</div>`
    : `<div class="scene-toolbar"><div><b>${list.length} scene${list.length===1?'':'s'}</b><span class="muted">${script?`script v${script.version_number} approved`:'no approved script version — scene creation is blocked'}</span></div><button class="btn primary" data-sc="add" ${script?'':'disabled'}>＋ Add scene</button></div>
      <div class="sc-layout">
        <div class="sc-list">${list.length?list.map((s,i)=>sceneRow(s,i)).join(''):'<div class="sc-empty-list">No scenes yet.</div>'}</div>
        <aside class="v33-inspector">${state.mode==='add'?draftForm(null):state.mode==='edit'?draftForm(selected()):readPanel(selected())}</aside>
      </div>`}`;
}

const rerender=mountStageOverlay('Scenes',renderPanel,async()=>{if(state.projectId)await loadLiveProject();});

document.addEventListener('click',async event=>{
  const row=event.target.closest('[data-sc-scene]');
  if(row){state.scene=Number(row.dataset.scScene);state.mode='view';rerender();return}
  const action=event.target.closest('[data-sc]')?.dataset.sc;
  if(!action)return;
  if(action==='connect'||action==='refresh'){
    state.projectId=document.querySelector('#sc-project-id')?.value||state.projectId;
    state.token=document.querySelector('#sc-api-token')?.value||state.token;
    setConnection(state.projectId,state.token);
    await loadLiveProject();
    rerender();return;
  }
  if(action==='add'){startAdd();rerender();return}
  if(action==='edit'){startEdit();rerender();return}
  if(action==='cancel'){cancelDraft();rerender();return}
  if(action==='approve'){const s=selected();if(s)await approveScene(s);rerender();return}
  if(action==='save'){
    const fields={
      sceneNumber:Number(document.querySelector('#sc-f-number')?.value||nextSceneNumber()),
      narrationText:document.querySelector('#sc-f-narration')?.value||'',
      imagePrompt:document.querySelector('#sc-f-image')?.value||'',
      motionPrompt:document.querySelector('#sc-f-motion')?.value||''
    };
    await saveDraft(fields);
    rerender();
    return;
  }
});

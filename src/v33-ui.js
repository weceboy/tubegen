import { scenes } from './data.js';
import { getConnection, setConnection, apiRequest, notify, escapeHtml, mountStageOverlay } from './connection.js';

const state = {
  scene: 2,
  entity: 1,
  version: 2,
  attempt: 2,
  selected: false,
  approved: false,
  riskBlocked: false,
  asset: true,
  license: 'verified',
  live: false,
  ...getConnection(),
  project: null,
  visuals: [],
  assetForm: false
};

const css = `
.v33-studio{padding:14px}.v33-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.v33-toolbar h3{margin:2px 0;font-size:14px}.v33-toolbar p{margin:0;color:#718093;font-size:10px}.v33-filters{display:flex;gap:6px;flex-wrap:wrap}.v33-filter{border:1px solid var(--line);background:#101821;color:#8996a6;border-radius:5px;padding:6px 8px;font-size:10px}.v33-filter.active{color:#fff;border-color:#3b82f6;background:#14233a}.v33-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(290px,.65fr);gap:12px}.v33-scenes,.v33-inspector{border:1px solid var(--line);border-radius:7px;background:#0d141c;min-width:0}.v33-scenes{overflow:hidden}.v33-scene{display:grid;grid-template-columns:48px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid #1d2631;cursor:pointer}.v33-scene:last-child{border:0}.v33-scene:hover,.v33-scene.active{background:#16202c}.v33-num{font-size:10px;color:#718093}.v33-thumb{width:76px;height:48px;border-radius:5px;object-fit:cover;display:block;background:#1a222c}.v33-scene-main{display:grid;grid-template-columns:76px 1fr;gap:9px;align-items:center}.v33-scene-main b,.v33-scene-main small{display:block}.v33-scene-main small{color:#718093;margin-top:3px;line-height:1.35}.v33-pills{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap}.v33-pill{font-size:9px;padding:3px 6px;border-radius:9px;background:#222c38;color:#a8b3c0}.v33-pill.green{background:#0c3823;color:#4ade80}.v33-pill.blue{background:#102b50;color:#60a5fa}.v33-pill.amber{background:#402e08;color:#fbbf24}.v33-pill.red{background:#421719;color:#f87171}.v33-inspector{padding:12px}.v33-hero{position:relative}.v33-hero img{width:100%;height:190px;object-fit:cover;border-radius:6px;display:block;background:#1a222c}.v33-source{position:absolute;left:8px;top:8px}.v33-section{border-top:1px solid var(--line);padding-top:11px;margin-top:11px}.v33-section h4{margin:0 0 7px;font-size:11px}.v33-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px}.v33-meta div{background:#101821;border:1px solid #202b38;border-radius:5px;padding:7px}.v33-meta b{display:block;color:#657385;font-size:8px;text-transform:uppercase;letter-spacing:.08em}.v33-meta span{display:block;margin-top:3px;color:#d5dce5;font-size:10px}.v33-flow{display:flex;align-items:center;gap:5px;overflow:auto;padding:2px 0}.v33-flow span{white-space:nowrap;border:1px solid #263241;border-radius:5px;padding:6px 7px;font-size:9px;color:#aab5c2}.v33-flow i{color:#526276;font-style:normal}.v33-flow .live{border-color:#1b5636;color:#4ade80}.v33-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.v33-actions .wide{grid-column:1/-1}.v33-history{display:grid;gap:5px}.v33-history div{display:flex;justify-content:space-between;gap:10px;padding:6px 0;color:#8795a5;font-size:9px}.v33-history b{color:#d5dce5}.v33-gate{border:1px solid #273241;border-radius:6px;padding:9px;background:#101821}.v33-gate strong{display:block;font-size:10px}.v33-gate small{display:block;color:#718093;line-height:1.4;margin-top:4px}.v33-gate.ok{border-color:#1b5636}.v33-gate.warn{border-color:#79520b}.v33-attempts{display:flex;gap:5px;flex-wrap:wrap}.v33-attempt{border:1px solid #263241;background:#101821;border-radius:5px;padding:5px 7px;font-size:9px;color:#8996a6}.v33-attempt.current{border-color:#3b82f6;color:#60a5fa}.v33-banner{display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:8px 10px;border-radius:6px;background:#101821;border:1px solid #263241;color:#9aa7b7;font-size:10px}.v33-banner b{color:#e9eef5}.v33-banner .dot{width:7px;height:7px;border-radius:50%;background:#f59e0b}.v33-banner .dot.ok{background:#22c55e}.v33-live{margin-left:auto;color:#4ade80;font-size:9px}.v33-livebar{display:flex;gap:7px;align-items:center;padding:7px 9px;margin-bottom:9px;background:#0b1118;border:1px solid #202b38;border-radius:5px}.v33-livebar input{min-width:0;flex:1;background:#101821;border:1px solid #263241;color:#d5dce5;border-radius:4px;padding:6px;font-size:10px}.v33-livebar button{white-space:nowrap}.v33-section label{display:block;color:#657385;font-size:8px;letter-spacing:.08em;margin:8px 0 4px;text-transform:uppercase}.v33-section input,.v33-section select{width:100%;box-sizing:border-box;background:#101821;border:1px solid #263241;color:#d5dce5;border-radius:4px;padding:6px;font-size:10px}.v33-form-row{display:flex;gap:6px;margin-top:9px}.v33-form-row>*{flex:1}.btn.danger{background:#3a1414;border-color:#5c2222;color:#f3a3a3}.btn.danger:hover{background:#4a1818}@media(max-width:900px){.v33-layout{grid-template-columns:1fr}.v33-scene-main{grid-template-columns:64px 1fr}.v33-thumb{width:64px;height:42px}}@media(max-width:600px){.v33-toolbar{align-items:flex-start;flex-direction:column}.v33-scene{grid-template-columns:34px 1fr}.v33-pills{grid-column:2;justify-content:flex-start}.v33-actions{grid-template-columns:1fr}.v33-livebar{flex-wrap:wrap}.v33-livebar input{flex-basis:100%}}
`;

(function ensureStyle(){
  const style=document.createElement('style');
  style.id='v33-ui-style';
  style.textContent=css;
  document.head.appendChild(style);
})();

const PLACEHOLDER_IMG='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="#1a222c"/></svg>');

// When connected to a live project, scene identity/prompts must come from the
// real scenes (with their scene_versions.id) rather than the bundled mock
// data — createVisual() requires a real sourceSceneVersionId.
function liveScenesList(){return state.live && state.project?.scenes?.length ? state.project.scenes : null}
function displayScenes(){
  const live=liveScenesList();
  if(!live) return scenes;
  return live.map(s=>({
    id:s.id, num:s.scene_number, nar:s.narration_text||'(no narration yet)', ip:s.image_prompt||'',
    mp:s.motion_prompt||'', source:'Live', time:'', dur:`v${s.version_number||1}`,
    approved:s.status==='approved', status:s.status==='approved'?'Fertig':s.status==='ready_for_review'?'In Prüfung':'Offen',
    img:PLACEHOLDER_IMG, sourceSceneVersionId:s.version_id||null
  }));
}

function selectedScene(){const list=displayScenes();return list[state.scene]||list[0]}
function currentVisual(){return state.visuals[state.scene]||state.visuals.find(v=>v.scene_id===selectedScene()?.id)||null}
function apiPath(projectId,suffix){return `/api/projects/${encodeURIComponent(projectId)}${suffix}`}
function persistConnection(){setConnection(state.projectId,state.token)}
async function loadLiveProject(){if(!state.projectId)return false;try{state.project=await apiRequest(apiPath(state.projectId,''),'GET',state.token);state.visuals=state.project.visuals||[];state.live=true;if(state.scene>=displayScenes().length)state.scene=0;const v=state.visuals.find(x=>x.scene_id===selectedScene()?.id)||state.visuals[state.scene]||state.visuals[0];if(v){state.entity=v.id;state.version=v.version_number||1;state.selected=v.selection_state==='selected';state.approved=v.version_status==='approved';state.asset=Boolean(v.source_asset_id);const asset=state.project.assets?.find(a=>a.id===v.source_asset_id);state.license=asset?.license_status||'unverified';}return true}catch(error){state.live=false;notify(error.message);return false}}
async function persistAction(action){
  if(!state.live)return false;
  const visual=currentVisual();
  if(action!=='candidate'&&!visual)return false;
  const projectId=state.projectId;
  try{
    if(action==='reroll'){if(!visual.version_id)throw new Error('Current visual has no version');await apiRequest(apiPath(projectId,'/visual-attempts'),'POST',state.token,{body:JSON.stringify({visualVersionId:visual.version_id,generationIndex:state.attempt+1,provider:'configured',model:'default',parameters:{}})});notify('New generation attempt queued')}
    else if(action==='version'){await apiRequest(apiPath(projectId,`/visuals/${encodeURIComponent(visual.id)}/versions`),'POST',state.token,{body:JSON.stringify({sourceSceneVersionId:visual.source_scene_version_id,prompt:visual.source_prompt,assetType:visual.asset_type||'image',assetSource:'generation'})});notify('New visual version created')}
    else if(action==='candidate'){const s=selectedScene();if(!s?.sourceSceneVersionId)throw new Error('Scene has no version yet — create it on the Scenes stage first');await apiRequest(apiPath(projectId,'/visuals'),'POST',state.token,{body:JSON.stringify({sceneId:s.id,sourceSceneVersionId:s.sourceSceneVersionId,assetType:'image',assetSource:'generation',prompt:s.ip})});notify('New candidate line created')}
    else if(action==='select'){await apiRequest(apiPath(projectId,`/visuals/${encodeURIComponent(visual.id)}/select`),'POST',state.token,{body:JSON.stringify({selected:!state.selected})});notify(state.selected?'Visual unselected':'Visual selected')}
    else if(action==='approve'){if(!visual.version_id)throw new Error('Current visual has no version');if(!state.selected)throw new Error('Select the visual before approval');if(state.license!=='verified')throw new Error('Verified asset license is required');if(state.riskBlocked)throw new Error('Risk override is required before approval');await apiRequest(apiPath(projectId,'/approve'),'POST',state.token,{body:JSON.stringify({artifactType:'visual',artifactVersionId:visual.version_id,approvalMode:'human'})});notify('Visual version approved')}
    else if(action==='reject'){await apiRequest(apiPath(projectId,`/visuals/${encodeURIComponent(visual.id)}/reject`),'POST',state.token);notify('Visual rejected')}
    else if(action==='assign-asset'){
      if(!visual.version_id)throw new Error('Current visual has no version');
      const objectKey=document.querySelector('#v33-f-objectkey')?.value.trim();
      if(!objectKey)throw new Error('Object key is required');
      const sourceType=document.querySelector('#v33-f-sourcetype')?.value||'upload';
      const licenseStatus=document.querySelector('#v33-f-licensestatus')?.value||'pending';
      const licenseType=document.querySelector('#v33-f-licensetype')?.value.trim()||undefined;
      const licenseUrl=document.querySelector('#v33-f-licenseurl')?.value.trim()||undefined;
      const asset=await apiRequest(apiPath(projectId,'/assets'),'POST',state.token,{body:JSON.stringify({sourceType,objectKey,license:{status:licenseStatus,type:licenseType,url:licenseUrl}})});
      await apiRequest(apiPath(projectId,`/visual-versions/${encodeURIComponent(visual.version_id)}/asset`),'POST',state.token,{body:JSON.stringify({assetId:asset.id})});
      notify('Asset assigned');
      state.assetForm=false;
    }
    else return false;
    await loadLiveProject();return true;
  }catch(error){notify(error.message);return true}
}

function assetSummary(){
  if(state.asset)return `<div class="v33-meta"><div><b>License</b><span>${escapeHtml(state.license)}</span></div><div><b>Asset</b><span>assigned</span></div></div><button class="btn" data-v33="asset-form" style="margin-top:9px">Reassign asset</button>`;
  return `<p style="color:#8795a5;font-size:10px;margin:0 0 8px">No asset assigned yet — required before a visual can be approved.</p><button class="btn" data-v33="asset-form">＋ Assign asset</button>`;
}
function assetForm(){
  return `<label>SOURCE TYPE</label><select id="v33-f-sourcetype"><option value="upload">upload</option><option value="stock">stock</option><option value="url">url</option></select>
    <label>OBJECT KEY</label><input id="v33-f-objectkey" placeholder="storage path or URL">
    <label>LICENSE STATUS</label><select id="v33-f-licensestatus"><option value="verified">verified</option><option value="pending">pending</option><option value="unverified">unverified</option><option value="rejected">rejected</option></select>
    <label>LICENSE TYPE (optional)</label><input id="v33-f-licensetype" placeholder="e.g. royalty-free">
    <label>LICENSE URL (optional)</label><input id="v33-f-licenseurl">
    <div class="v33-form-row"><button class="btn" data-v33="asset-cancel">Cancel</button><button class="btn primary" data-v33="assign-asset">Save</button></div>`;
}

function renderStudio(host){
  const list=displayScenes();
  const s=selectedScene();
  const visual=currentVisual();
  const approved=state.approved,selected=state.selected;
  const gate=selected&&approved&&state.asset&&state.license==='verified'&&!state.riskBlocked;
  const entityLabel=visual?.id||`visual_${String(state.entity).padStart(2,'0')}`;
  const versionLabel=visual?.version_number||state.version;
  const attemptLabel=state.attempt;
  host.innerHTML=`<div class="v33-studio">
    <div class="v33-banner"><span class="dot ${gate?'ok':''}"></span><span><b>v3.3 Visual Gate</b> · ${gate?'Production ready':'Selection + approval + verified license required'}</span><span class="v33-live">${state.live?'● LIVE API':'○ LOCAL PREVIEW'}</span></div>
    <div class="v33-livebar"><input id="v33-project-id" value="${escapeHtml(state.projectId)}" placeholder="Project ID"><input id="v33-api-token" type="password" value="${escapeHtml(state.token)}" placeholder="Bearer token (optional in dev)"><button class="btn" data-v33="connect">Connect</button>${state.live?'<button class="btn" data-v33="refresh">Refresh</button>':''}</div>
    <div class="v33-toolbar"><div><span class="eyebrow">VISUAL CANDIDATE STUDIO</span><h3>Scene visuals · Entity / Version / Attempt / Asset</h3><p>Reroll bleibt auf derselben Version. Prompt- oder Scene-Änderung erzeugt eine neue Version.</p></div><div class="v33-filters"><button class="v33-filter active">All ${state.visuals.length||list.length}</button><button class="v33-filter">Review ${state.visuals.filter(v=>v.version_status==='ready_for_review').length||0}</button><button class="v33-filter">Selected ${selected?'1':'0'}</button></div></div>
    <div class="v33-layout"><div class="v33-scenes">${list.map((x,i)=>`<div class="v33-scene ${i===state.scene?'active':''}" data-v33-scene="${i}"><span class="v33-num">${String(x.num??x.id).padStart(2,'0')}</span><div class="v33-scene-main"><img class="v33-thumb" src="${x.img}"><div><b>${escapeHtml(x.nar)}</b><small>${x.source} · ${x.time} · ${x.dur}</small></div></div><div class="v33-pills"><span class="v33-pill ${x.approved?'green':'amber'}">${x.approved?'approved':'review'}</span>${i===state.scene&&selected?'<span class="v33-pill blue">selected</span>':''}</div></div>`).join('')}</div>
      <aside class="v33-inspector"><div class="v33-hero"><img src="${s.img}"><span class="v33-pill v33-source">${s.source}</span></div>
        <div class="v33-section"><h4>Current candidate line</h4><div class="v33-meta"><div><b>Entity</b><span>${escapeHtml(entityLabel)}</span></div><div><b>Selection</b><span>${selected?'selected':'candidate'}</span></div><div><b>Version</b><span>v${versionLabel}</span></div><div><b>Status</b><span>${approved?'approved':'ready_for_review'}</span></div></div></div>
        <div class="v33-section"><h4>Artifact provenance</h4><div class="v33-flow"><span>Scene ${String(s.num??s.id).padStart(2,'0')}</span><i>→</i><span class="live">Visual v${versionLabel}</span><i>→</i><span>Attempt ${attemptLabel}</span><i>→</i><span>Asset</span></div></div>
        <div class="v33-section"><h4>Generation attempts</h4><div class="v33-attempts"><span class="v33-attempt">Attempt 1</span><span class="v33-attempt current">Attempt ${attemptLabel} · current</span></div></div>
        <div class="v33-section"><h4>Asset &amp; license</h4>${state.assetForm?assetForm():assetSummary()}</div>
        <div class="v33-section"><h4>v3.3 Gate</h4><div class="v33-gate ${gate?'ok':'warn'}"><strong>${gate?'✓ Ready for final render':'○ Blocked'}</strong><small>${gate?'selected + approved + verified license':'Selection: '+(selected?'selected':'candidate')+' · Approval: '+(approved?'approved':'pending')+' · License: '+state.license}</small></div></div>
        <div class="v33-actions"><button class="btn" data-v33="reroll">↻ Reroll</button><button class="btn" data-v33="version">＋ New version</button><button class="btn" data-v33="candidate">＋ Candidate line</button><button class="btn" data-v33="select">${selected?'Unselect':'Select'}</button><button class="btn danger" data-v33="reject">✕ Reject</button><button class="btn success wide" data-v33="approve">${approved?'Approved':'Approve version'}</button></div>
        <div class="v33-section"><h4>Version history</h4><div class="v33-history"><div><b>v${versionLabel}</b><span>current · Scene ${s.num??s.id}</span></div>${Number(versionLabel)>1?`<div><b>v${Number(versionLabel)-1}</b><span>superseded</span></div>`:''}</div></div>
      </aside></div></div>`;
}

const rerender=mountStageOverlay('Visuals',renderStudio,async()=>{if(state.projectId)await loadLiveProject();});

document.addEventListener('click',async event=>{
  const scene=event.target.closest('[data-v33-scene]');
  if(scene){state.scene=Number(scene.dataset.v33Scene);if(state.live)await loadLiveProject();rerender();return}
  const action=event.target.closest('[data-v33]')?.dataset.v33;
  if(!action)return;
  if(action==='connect'||action==='refresh'){
    state.projectId=document.querySelector('#v33-project-id')?.value||state.projectId;
    state.token=document.querySelector('#v33-api-token')?.value||state.token;
    persistConnection();
    await loadLiveProject();
    rerender();return;
  }
  if(action==='asset-form'){state.assetForm=true;rerender();return}
  if(action==='asset-cancel'){state.assetForm=false;rerender();return}
  if(action==='reroll')state.attempt+=1;
  if(action==='version'){state.version+=1;state.attempt=1;state.approved=false;state.selected=false;}
  if(action==='candidate'){state.entity+=1;state.version=1;state.attempt=1;state.approved=false;state.selected=false;}
  if(action==='select')state.selected=!state.selected;
  if(action==='approve')state.approved=!state.approved;
  await persistAction(action);
  rerender();
});

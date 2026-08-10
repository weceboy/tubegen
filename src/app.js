import {project as mockProject,stages as mockStages,scenes,activity,dashboardProjects} from './data.js';
import {getConnection,setConnection,apiRequest} from './connection.js';

const app=document.querySelector('#app');
let currentStage=2;
let selectedScene=2;
let liveProjects=[];
let liveProject=null;
let liveQueueJobs=[];
let liveAssets=[];
const $=s=>document.querySelector(s);
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const toast=msg=>{const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2200)};

function currentProject(){return liveProject?.project||mockProject}
function deriveStages(lp){
  const research=lp.research?.[0]||null;
  const script=lp.scripts?.[0]||null;
  const scenesArr=lp.scenes||[];
  const approvedScenes=scenesArr.filter(s=>s.status==='approved').length;
  const voice=lp.voiceovers?.[0]||null;
  const ts=lp.timestamps?.[0]||null;
  const visuals=lp.visuals||[];
  const approvedVisuals=visuals.filter(v=>v.version_status==='approved').length;
  const timeline=lp.timelines?.[0]||null;
  const rough=lp.roughCuts?.[0]||null;
  const fine=lp.fineCuts?.[0]||null;
  const stateFor=(artifact,approved)=>!artifact?'open':approved?'done':'warn';
  return [
    {n:'01',key:'research',name:'Research',state:stateFor(research,research?.status==='approved'),meta:research?`v${research.version_number} · ${research.status}`:'not started',artifact:'Research document'},
    {n:'02',key:'script',name:'Script',state:stateFor(script,script?.status==='approved'),meta:script?`v${script.version_number} · ${script.status}`:'not started',artifact:'Approved script'},
    {n:'03',key:'scenes',name:'Scenes',state:scenesArr.length?(approvedScenes===scenesArr.length?'done':'warn'):'open',meta:scenesArr.length?`${scenesArr.length} scenes · ${approvedScenes} approved`:'no scenes yet',artifact:'Scene breakdown'},
    {n:'04',key:'voiceover',name:'Voiceover',state:stateFor(voice,voice?.status==='approved'),meta:voice?`v${voice.version_number} · ${voice.status}`:'not started',artifact:'Voiceover audio'},
    {n:'05',key:'timestamps',name:'Timestamps',state:stateFor(ts,ts?.status==='approved'),meta:ts?`v${ts.version_number} · ${ts.status}`:'not started',artifact:'SRT + JSON'},
    {n:'06',key:'visuals',name:'Visuals',state:visuals.length?(approvedVisuals===visuals.length?'done':'warn'):'open',meta:visuals.length?`${approvedVisuals}/${visuals.length} approved`:'no visuals yet',artifact:'Scene assets'},
    {n:'07',key:'edit',name:'Edit',state:fine?.status==='approved'?'done':(timeline||rough||fine)?'warn':'open',meta:fine?`fine cut · ${fine.status}`:rough?`rough cut · ${rough.status}`:timeline?`timeline · ${timeline.status}`:'not started',artifact:'Remotion render'}
  ];
}
function currentStages(){return liveProject?deriveStages(liveProject):mockStages}

app.innerHTML=`<div class="app"><aside class="sidebar"><div class="brand">AutoDoc <span>BETA</span></div><nav>
<div class="nav-group">Workspace</div><button class="nav active" data-view="dashboard">⌂ <b>Dashboard</b></button><button class="nav" data-view="projects">▣ <b>Projects</b></button><button class="nav" data-view="channels">▤ <b>Channels</b></button>
<div class="nav-group">Production</div><button class="nav" data-view="queue">☷ <b>Queue</b><em id="queueCount">0</em></button><button class="nav" data-view="assets">▧ <b>Assets</b></button><button class="nav" data-view="templates">◇ <b>Templates</b></button>
<div class="nav-group">System</div><button class="nav" data-view="providers">◉ <b>Providers</b></button><button class="nav" data-view="settings">⚙ <b>Settings</b></button></nav><div class="sidebar-bottom"><div class="budget"><small>MONTHLY BUDGET</small><strong>$47.20</strong><span>of $200.00</span><i><b></b></i><small>23% used</small></div></div></aside>
<main><header><div class="breadcrumbs"><span id="crumb">Dashboard</span> <span>›</span> <strong id="crumbProject"></strong></div><div class="head-actions"><button class="btn" data-action="preview">▶ Preview</button><button class="btn" data-action="share">Share</button><button class="btn primary" data-action="new">＋ New project</button></div></header><div class="page"><section id="dashboard" class="view active"></section><section id="projects" class="view"></section><section id="project" class="view"></section><section id="channels" class="view"></section><section id="queue" class="view"></section><section id="assets" class="view"></section><section id="templates" class="view"></section><section id="providers" class="view"></section><section id="settings" class="view"></section></div></main></div><div id="toast" class="toast"></div>`;

function dashboard(){return `<div class="page-title"><div><div class="eyebrow">PRODUCTION CONTROL</div><h1>Dashboard</h1><p>What needs attention today?</p></div><button class="btn primary" data-action="new">＋ Start project</button></div><div class="metrics"><div><small>ACTIVE PROJECTS</small><b>${liveProjects.length}</b><span>updated live</span></div><div><small>IN PRODUCTION</small><b>4</b><span>2 jobs running</span></div><div><small>APPROVALS</small><b class="amber">3</b><span>need your review</span></div><div><small>THIS WEEK</small><b>$18.40</b><span>avg. $2.05 / video</span></div></div><div class="dash-grid"><div class="card"><div class="card-title"><div><h2>Needs attention</h2><p>Actions blocking production</p></div><span class="counter">3</span></div><div class="attention">${dashboardProjects.map((x,i)=>`<div><span class="status ${x.status}"></span><section><b>${x.title}</b><small>${x.stage} · ${x.detail}</small></section><button class="btn" data-dashboard="${i}">${x.action}</button></div>`).join('')}</div></div><div class="card"><div class="card-title"><div><h2>Production queue</h2><p>Current jobs</p></div><button class="link" data-action="queue">View all →</button></div><div class="queue"><div><b>New Survival Video</b><span>Visuals</span><i><b style="width:52%"></b></i><small>8 / 16</small></div><div><b>Greek Envoys 481 BC</b><span>Voiceover</span><i><b style="width:22%"></b></i><small>22%</small></div><div><b>Off-Grid Water Filter</b><span>Rendering</span><i><b style="width:76%"></b></i><small>76%</small></div></div></div></div><div class="card artifact-principle"><div class="card-title"><div><h2>Artifact flow</h2><p>Every stage consumes the previous artifact and produces the next one.</p></div></div><div class="artifact-flow">${mockStages.map((s,i)=>`<div class="flow-item"><span class="flow-num">${s.n}</span><b>${s.name}</b><small>${s.artifact}</small>${i<mockStages.length-1?'<i>→</i>':''}</div>`).join('')}</div></div>`}

function projectsView(){
  const rows=liveProjects.length?liveProjects.map(p=>`<div class="project-row"><div><span class="status ${p.status==='in_production'?'amber':p.status==='draft'?'':'green'}"></span><b>${esc(p.title)}</b><small>${esc(p.channel||'Default')} · ${p.target_duration_seconds?Math.round(p.target_duration_seconds/60)+' min target':'no target set'}</small></div><div class="project-stage"><span>Status</span><b>${esc(p.status||'draft')}</b></div><div><span class="muted">updated ${p.updated_at?new Date(p.updated_at).toLocaleDateString():'—'}</span></div><button class="btn" data-open-project-id="${esc(p.id)}">Open →</button></div>`).join('')
    :'<div class="project-row"><div><b>No projects yet</b><small>Create one to get started.</small></div></div>';
  return `<div class="page-title"><div><div class="eyebrow">WORKSPACE</div><h1>Projects</h1><p>Production folders and their current artifacts.</p></div><button class="btn primary" data-action="new">＋ New project</button></div><div class="project-list">${rows}</div>`
}

function channelsView(){
  const groups={};
  liveProjects.forEach(p=>{const ch=p.channel||'Default';(groups[ch]=groups[ch]||[]).push(p)});
  const names=Object.keys(groups).sort();
  const body=names.length?names.map(name=>`<div class="card"><div class="card-title"><div><h3>${esc(name)}</h3><p>${groups[name].length} project${groups[name].length===1?'':'s'}</p></div></div><div class="artifacts">${groups[name].map(p=>`<div style="cursor:pointer" data-open-project-id="${esc(p.id)}"><span>${esc(p.title)}</span><span class="badge">${esc(p.status||'draft')}</span></div>`).join('')}</div></div>`).join('')
    :'<p class="muted">No projects yet — create one to see it grouped by channel here.</p>';
  return `<div class="page-title"><div><div class="eyebrow">WORKSPACE</div><h1>Channels</h1><p>Projects grouped by their channel.</p></div></div><div class="dash-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${body}</div>`
}

function queueView(){
  const jobs=liveQueueJobs;
  const rows=jobs.length?jobs.slice(0,50).map(j=>`<div><span><b>${esc(j.job_type||'job')}</b> <span class="badge ${j.status==='completed'?'green':j.status==='failed'?'':'amber'}">${esc(j.status)}</span> <small class="muted">${esc(j.projectTitle)}</small></span><span class="muted">${j.created_at?new Date(j.created_at).toLocaleString():''}</span></div>`).join('')
    :'<p class="muted">No jobs yet. Jobs appear here once a stage queues generation work.</p>';
  return `<div class="page-title"><div><div class="eyebrow">PRODUCTION</div><h1>Queue</h1><p>Generation jobs across all your projects.</p></div></div><div class="card"><div class="card-title"><div><h3>Recent jobs</h3><p>${jobs.length} total</p></div></div><div class="artifacts">${rows}</div></div>`
}

function assetsView(){
  const assets=liveAssets;
  const rows=assets.length?assets.slice(0,50).map(a=>`<div><span><b>${esc(a.object_key||a.id)}</b> <span class="badge ${a.license_status==='verified'?'green':'amber'}">${esc(a.license_status||'unlicensed')}</span> <small class="muted">${esc(a.projectTitle)}</small></span><span class="muted">${esc(a.source_type||'')}</span></div>`).join('')
    :'<p class="muted">No assets yet. Upload or generate one from a project\'s Visuals stage.</p>';
  return `<div class="page-title"><div><div class="eyebrow">PRODUCTION</div><h1>Assets</h1><p>Every asset uploaded or generated across your projects.</p></div></div><div class="card"><div class="card-title"><div><h3>All assets</h3><p>${assets.length} total</p></div></div><div class="artifacts">${rows}</div></div>`
}

function comingSoonView(title,copy){
  return `<div class="page-title"><div><div class="eyebrow">SYSTEM</div><h1>${esc(title)}</h1><p>${esc(copy)}</p></div></div><div class="card"><div class="card-title"><div><h3>Not built yet</h3><p>This section needs a real design decision before it can be wired up honestly.</p></div></div><div class="side-block"><p>${esc(copy)}</p></div></div>`
}
function templatesView(){return comingSoonView('Templates','There is no template data model yet — project, scene, or script templates would each need their own schema and domain logic before this page could do more than link to Projects.')}
function providersView(){return comingSoonView('Providers','Provider credentials are not stored anywhere yet. Building this page for real means designing encrypted secret storage first (see README "Next build stages") — a plain form here would either do nothing or store API keys unsafely, so it is left out until that exists.')}

function settingsView(){
  const cp=currentProject();
  if(!liveProject)return `<div class="page-title"><div><div class="eyebrow">SYSTEM</div><h1>Settings</h1><p>Open a project to edit its settings.</p></div></div><div class="card"><div class="card-title"><div><h3>No project connected</h3><p>Open a project from the Projects list first.</p></div></div></div>`;
  return `<div class="page-title"><div><div class="eyebrow">SYSTEM</div><h1>Settings</h1><p>Settings for the currently open project.</p></div></div><div class="card inner">
    <label>PROJECT NAME</label><input id="settings-title" value="${esc(cp.title)}">
    <label>CHANNEL</label><input id="settings-channel" value="${esc(cp.channel||'Default')}">
    <label>STATUS</label><select id="settings-status"><option value="draft" ${cp.status==='draft'?'selected':''}>draft</option><option value="in_production" ${cp.status==='in_production'?'selected':''}>in_production</option><option value="archived" ${cp.status==='archived'?'selected':''}>archived</option></select>
    <label>TARGET DURATION (seconds, optional)</label><input id="settings-duration" type="number" min="0" value="${cp.target_duration_seconds??''}">
    <div class="inspector-row" style="margin-top:14px"><button class="btn primary" data-action="saveSettings">Save changes</button></div>
  </div>`
}

function projectView(){
  const cp=currentProject();
  const st=currentStages();
  const s=st[currentStage]||st[0];
  const durationLabel=cp.target_duration_seconds?`${Math.round(cp.target_duration_seconds/60)} min target`:(cp.duration||'no target set');
  const updatedLabel=cp.updated_at?new Date(cp.updated_at).toLocaleString():(cp.updated||'—');
  return `<div class="project-head"><div><div class="eyebrow">PROJECT · ${esc((cp.channel||'Default').toUpperCase())}</div><h1>${esc(cp.title)}</h1><p>${esc(durationLabel)} · ${esc(cp.status||'draft')} · updated ${esc(updatedLabel)}</p></div><div class="project-actions"><button class="btn" data-action="preview">▶ Preview</button><button class="btn" data-action="projectSettings">⚙</button></div></div><div class="pipeline">${st.map((x,i)=>`<button class="stage ${x.state} ${i===currentStage?'selected':''}" data-stage="${i}"><span>${x.n}</span><b>${x.name}</b><small>${x.meta}</small><i></i></button>`).join('')}</div><div class="artifact-banner"><div><span class="eyebrow">CURRENT ARTIFACT</span><strong>${s.artifact}</strong><small>${stageInput(s.key)} → ${s.artifact}</small></div><div class="artifact-actions">${stageActions(s.key)}</div></div><div class="stage-layout"><div class="main-workspace"><div class="workspace-head"><div><span class="stage-label">${s.n} · ${s.name.toUpperCase()}</span><h2>${stageTitle(s.key)}</h2><p>${stageDescription(s.key)}</p></div></div>${stageWorkspace(s.key)}</div><aside class="right-panel">${rightPanel(s.key)}</aside></div><div class="bottom-grid"><div class="card"><div class="card-title"><div><h3>Artifacts</h3><p>Outputs from this stage</p></div></div><div class="artifacts">${artifactList(s.key,st)}</div></div><div class="card"><div class="card-title"><div><h3>Activity</h3><p>Job history & changes</p></div></div><div class="activity">${activityFeed()}</div></div><div class="card"><div class="card-title"><div><h3>Notes</h3><p>Project notes</p></div></div><div class="notes"><textarea id="notes" placeholder="Add a note...">${localStorage.getItem('autodoc-notes')||''}</textarea><button class="btn" data-action="saveNote">Save</button></div></div></div>`
}

const stageTitle=k=>({research:'Research brief',script:'Script editor',scenes:'Scene breakdown',voiceover:'Voiceover production',timestamps:'Timestamp mapping',visuals:'Visual review',edit:'Edit & render'}[k]);
const stageDescription=k=>({research:'Define the topic, audience and production angle before creating the script.',script:'The approved voiceover script becomes the input artifact for scene production.',scenes:'Turn the script into concrete scenes with narration, image prompts and motion prompts.',voiceover:'Turn the approved script into a versioned audio artifact.',timestamps:'Transcribe the voiceover and map exact timings back to scenes.',visuals:'Select, generate and approve one production-ready visual per scene.',edit:'Assemble all approved artifacts in Remotion and create rough and final renders.'}[k]);
const stageInput=k=>({research:'Idea / brief',script:'Research document',scenes:'Approved script',voiceover:'Approved script',timestamps:'Voiceover audio',visuals:'Scene breakdown',edit:'Approved scenes + voice + timing + visuals'}[k]);
function stageActions(k){const a={research:'<button class="btn primary" data-action="generate">Generate research</button>',script:'<button class="btn" data-action="humanize">Run humanizer</button><button class="btn primary" data-action="approve">Approve script</button>',scenes:'<button class="btn" data-action="generate">Generate scenes</button><button class="btn primary" data-action="approveAll">Approve breakdown</button>',voiceover:'<button class="btn" data-action="generate">Generate voiceover</button><button class="btn primary" data-action="approve">Approve audio</button>',timestamps:'<button class="btn" data-action="generate">Run Whisper</button><button class="btn primary" data-action="export">Export SRT</button>',visuals:'<button class="btn" data-action="generate">Generate missing</button><button class="btn primary" data-action="approveAll">Approve selection</button>',edit:'<button class="btn" data-action="rough">Create rough cut</button><button class="btn primary" data-action="render">Final render</button>'};return a[k]}
function stageWorkspace(k){if(k==='research')return researchWorkspace();if(k==='script')return scriptWorkspace();if(k==='scenes')return scenesWorkspace();if(k==='voiceover')return voiceWorkspace();if(k==='timestamps')return timestampWorkspace();if(k==='visuals')return visualsWorkspace();return editWorkspace()}
function researchWorkspace(){return `<div class="form-grid"><div class="card inner"><label>TOPIC</label><input value="${mockProject.research.topic}"><label>TARGET AUDIENCE</label><input value="${mockProject.research.audience}"><label>ANGLE</label><textarea>${mockProject.research.angle}</textarea><label>TARGET LENGTH</label><input value="${mockProject.research.targetLength}"><label>STATUS</label><div><span class="badge green">Research approved</span></div></div><div class="card inner"><label>RESEARCH SUMMARY</label><textarea class="large">${mockProject.research.summary}</textarea><label>SOURCES</label>${mockProject.research.sources.map(x=>`<div class="source">↗ ${x}<span>verified</span></div>`).join('')}</div></div>`}
function scriptWorkspace(){return `<div class="editor-wrap"><div class="editor-meta"><span>Script v${mockProject.script.version}</span><span>${mockProject.script.wordCount} words · ~4:18</span><span class="badge green">Approved</span></div><textarea class="script-editor">${mockProject.script.text}</textarea><div class="editor-footer"><span>Autosaved · 16:41</span><span>${mockProject.script.humanized?'Humanized ✓':'Not humanized'}</span><span>Approval gate ✓</span></div><div class="version-strip"><b>Version history</b><span>v1 · AI generated · 16:32</span><span>v2 · Humanized · 16:41</span><span class="current">v3 · Edited · current</span></div></div>`}
function scenesWorkspace(){return `<div class="scene-toolbar"><div><b>16 scenes</b><span class="muted">13 approved · 2 review · 1 open</span></div><div><button class="filter active">All</button><button class="filter">Review</button><button class="filter">Open</button></div></div><div class="scene-table"><table><thead><tr><th>#</th><th>TIME</th><th>NARRATION</th><th>IMAGE PROMPT</th><th>MOTION PROMPT</th><th>STATUS</th></tr></thead><tbody>${scenes.map((s,i)=>`<tr class="${i===selectedScene?'selected':''}" data-scene="${i}"><td><b>${String(s.id).padStart(2,'0')}</b></td><td>${s.time}<small>${s.dur}</small></td><td>${esc(s.nar)}</td><td><div class="visual-cell"><img src="${s.img}"><span>${esc(s.ip)}</span></div></td><td>${esc(s.mp)}</td><td><span class="badge ${s.status==='Fertig'?'green':s.status==='In Prüfung'?'amber':'neutral'}">${s.status}</span></td></tr>`).join('')}</tbody></table></div>`}
function voiceWorkspace(){return `<div class="voice-card"><div class="voice-top"><div><span class="eyebrow">AUDIO ARTIFACT v${mockProject.voiceover.version}</span><h3>${mockProject.voiceover.voice} · ${mockProject.voiceover.model}</h3><p>${mockProject.voiceover.duration} · WAV · 48 kHz</p></div><span class="badge green">Ready · Approved</span></div><div class="waveform">${Array.from({length:70},(_,i)=>`<i style="height:${12+(i*17)%42}px"></i>`).join('')}</div><div class="player"><button class="play" data-action="play">▶</button><span>00:00</span><div class="track"><b></b></div><span>03:42</span></div><div class="voice-versions"><b>Version history</b><span>v2 · current · 16:40</span><span>v1 · 16:25</span></div></div>`}
function timestampWorkspace(){return `<div class="timeline-card"><div class="timeline-head"><b>Voiceover → scene mapping</b><span class="badge green">Whisper complete</span></div><div class="ruler">${['00:00','00:30','01:00','01:30','02:00','02:30','03:00','03:42'].map(x=>`<span>${x}</span>`).join('')}</div><div class="timeline">${scenes.slice(0,8).map((s,i)=>`<div style="width:${8+i%3}%"><b>Scene ${s.id}</b><small>${s.time.split(' – ')[0]}</small></div>`).join('')}</div><table class="mini-table"><thead><tr><th>Scene</th><th>Start</th><th>End</th><th>Duration</th><th>Confidence</th></tr></thead><tbody>${scenes.slice(0,8).map(s=>`<tr><td>${String(s.id).padStart(2,'0')}</td><td>${s.time.split(' – ')[0]}</td><td>${s.time.split(' – ')[1]}</td><td>${s.dur}</td><td><span class="badge green">98%</span></td></tr>`).join('')}</tbody></table><div class="export-row"><button class="btn" data-action="export">Export SRT</button><button class="btn" data-action="export">Export JSON</button></div></div>`}
function visualsWorkspace(){return `<div class="visual-summary"><b>16 scenes · 13 ready</b><span>2 in review · 1 open</span><span class="muted">Approval gate: manual</span></div><div class="visual-grid">${scenes.map((s,i)=>`<div class="visual-card ${i===selectedScene?'selected':''}" data-scene="${i}"><div class="visual-img"><img src="${s.img}"><span>${s.source}</span></div><div><b>Scene ${String(s.id).padStart(2,'0')}</b><p>${esc(s.nar)}</p><span class="badge ${s.status==='Fertig'?'green':s.status==='In Prüfung'?'amber':'neutral'}">${s.status}</span></div><div class="visual-actions"><button class="btn" data-action="regenerate">↻ Regenerate</button><button class="btn" data-action="approveScene">✓ Approve</button></div></div>`).join('')}</div>`}
function editWorkspace(){return `<div class="edit-preview"><div class="video-placeholder"><div>▶</div><span>Rough Cut Preview</span></div><div class="edit-info"><div><b>Inputs</b><p>Voiceover ✓ · Timestamps ✓ · Scenes ✓ · Visuals 13/16</p></div><div class="render-state"><span class="status amber"></span>Blocked by visual approvals</div></div><div class="edit-timeline">${Array.from({length:16},(_,i)=>`<i style="width:${5+i%4}%"></i>`).join('')}</div><div class="render-steps"><span class="done">✓ Remotion project linked</span><span class="done">✓ Rough cut ready</span><span>○ Fine cut not started</span><span>○ Final render blocked</span></div></div>`}
function sceneInspector(){const s=scenes[selectedScene];return `<div class="inspector"><div class="inspector-image"><img src="${s.img}"><span>SCENE ${String(s.id).padStart(2,'0')} · ${s.source}</span></div><label>NARRATION</label><textarea>${s.nar}</textarea><label>IMAGE PROMPT</label><textarea>${s.ip}</textarea><label>MOTION PROMPT</label><textarea>${s.mp}</textarea><div class="inspector-row"><button class="btn" data-action="regenerate">Regenerate</button><button class="btn primary" data-action="approveScene">Approve</button></div></div>`}
function visualInspector(){const s=scenes[selectedScene];return `<div class="inspector"><div class="inspector-image tall"><img src="${s.img}"><span>SCENE ${String(s.id).padStart(2,'0')}</span></div><div class="inspector-meta"><b>Source</b><span>${s.source}</span><b>Status</b><span>${s.status}</span></div><label>IMAGE PROMPT</label><textarea>${s.ip}</textarea><label>MOTION PROMPT</label><textarea>${s.mp}</textarea><div class="inspector-row"><button class="btn" data-action="regenerate">Regenerate</button><button class="btn primary" data-action="approveScene">Approve</button></div></div>`}
function rightPanel(k){if(k==='scenes'||k==='visuals')return k==='scenes'?sceneInspector():visualInspector();const cp=currentProject();return `<div class="side-block"><span class="eyebrow">INPUT ARTIFACT</span><h3>${stageInput(k)}</h3><p>This stage consumes the previous approved artifact and creates a versioned production output.</p></div><div class="side-block"><span class="eyebrow">AUTOMATION GATE</span><div class="toggle-row"><span>Auto-run next stage</span><button class="toggle on">●</button></div><div class="toggle-row"><span>Require approval</span><button class="toggle">○</button></div></div><div class="side-block"><span class="eyebrow">COST</span><div class="cost"><b>${cp.cost!=null?'$'+Number(cp.cost).toFixed(2):'—'}</b><span>${cp.estimatedCost!=null?'estimated total $'+Number(cp.estimatedCost).toFixed(2):'not tracked yet'}</span></div></div>`}
function artifactList(k,st){
  if(!liveProject){const map={research:[['Research document','Approved','green'],['3 verified sources','Ready','green']],script:[[`Script v${mockProject.script.version}`,'Approved','green'],['Humanized revision','Complete','green']],scenes:[['Scene breakdown','13 approved / 3 review','amber'],['Image prompts · 16','Complete','green'],['Motion prompts · 16','Complete','green']],voiceover:[[`Audio v${mockProject.voiceover.version}`,'Approved','green'],['Voice metadata','Ready','green']],timestamps:[['SRT','Ready','green'],['JSON scene mapping','Ready','green']],visuals:[['Scene assets','13 / 16 approved','amber'],['3 assets','Need review','amber']],edit:[['Remotion project','Linked','green'],['Rough cut','Ready','green'],['Final render','Blocked','amber']]};return (map[k]||[]).map(x=>`<div><span>${x[0]}</span><span class="badge ${x[2]}">${x[1]}</span></div>`).join('')}
  const s=(st||currentStages()).find(x=>x.key===k);
  if(!s)return '';
  return `<div><span>${esc(s.artifact)}</span><span class="badge ${s.state==='done'?'green':s.state==='warn'?'amber':''}">${esc(s.meta)}</span></div>`
}
function activityFeed(){
  if(!liveProject)return activity.map(a=>`<div><span class="status ${a[2]}"></span><span>${a[1]}</span><time>${a[0]}</time></div>`).join('');
  const items=(liveProject.audit||[]).slice(0,8);
  if(!items.length)return '<div><span class="status"></span><span>No activity yet</span><time></time></div>';
  return items.map(e=>`<div><span class="status"></span><span>${esc(e.event_type)}</span><time>${esc(new Date(e.created_at).toLocaleTimeString())}</time></div>`).join('')
}

function render(){if($('#dashboard'))$('#dashboard').innerHTML=dashboard();if($('#projects'))$('#projects').innerHTML=projectsView();if($('#project'))$('#project').innerHTML=projectView();if($('#channels'))$('#channels').innerHTML=channelsView();if($('#queue'))$('#queue').innerHTML=queueView();if($('#assets'))$('#assets').innerHTML=assetsView();if($('#templates'))$('#templates').innerHTML=templatesView();if($('#providers'))$('#providers').innerHTML=providersView();if($('#settings'))$('#settings').innerHTML=settingsView();bind();}
function bind(){document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{currentStage=Number(b.dataset.stage);show('project');render()});document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>{selectedScene=Number(b.dataset.scene);render()});document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>show(b.dataset.view));document.querySelectorAll('[data-open-project-id]').forEach(b=>b.onclick=()=>{setConnection(b.dataset.openProjectId,getConnection().token);window.location.reload()});document.querySelectorAll('[data-dashboard]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.dashboard);if(i===0){currentStage=5;show('project')}else toast(`${dashboardProjects[i].title}: ${dashboardProjects[i].action} queued`)});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));}
function show(view){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));const el=$(`#${view}`);if(el)el.classList.add('active');document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view));if(view==='project'){$('#crumb').textContent='Projects';$('#crumbProject').textContent=currentProject().title}render()}
async function saveSettings(){
  if(!liveProject){toast('No project connected');return}
  const conn=getConnection();
  const payload={
    title:$('#settings-title')?.value?.trim(),
    channel:$('#settings-channel')?.value?.trim(),
    status:$('#settings-status')?.value,
    targetDurationSeconds:$('#settings-duration')?.value?Number($('#settings-duration').value):null
  };
  try{
    await apiRequest(`/api/projects/${encodeURIComponent(conn.projectId)}`,'PATCH',conn.token,{body:JSON.stringify(payload)});
    liveProject=await apiRequest(`/api/projects/${encodeURIComponent(conn.projectId)}`,'GET',conn.token);
    liveProjects=await apiRequest('/api/projects','GET',conn.token).catch(()=>liveProjects);
    toast('Project settings saved');
    if($('#crumbProject'))$('#crumbProject').textContent=currentProject().title;
    render();
  }catch(error){toast(error.message||'Failed to save settings')}
}
async function action(a){const messages={new:'Project creation flow is ready for the next backend step.',preview:'Preview opened from the current production artifacts.',share:'Share link copied.',projectSettings:'Project settings opened.',generate:'Job queued — the output will become the next stage artifact.',humanize:'Humanizer job completed. Script revision updated.',approve:'Artifact approved. Next stage is now unlocked.',approveAll:'All eligible items approved. Next stage is now unlocked.',approveScene:'Scene asset approved.',regenerate:'Regeneration job queued for the selected scene.',play:'Playing voiceover artifact.',export:'Export prepared: SRT / JSON.',rough:'Rough cut job queued in Remotion.',render:'Final render queued.',saveNote:'Project note saved.',queue:'Queue view opened.'};if(a==='saveNote'){localStorage.setItem('autodoc-notes',$('#notes')?.value||'')}if(a==='saveSettings'){await saveSettings();return}toast(messages[a]||'Action completed.');}

render();
async function loadQueueAndAssets(){
  if(!liveProjects.length){liveQueueJobs=[];liveAssets=[];return}
  const token=getConnection().token;
  const details=await Promise.all(liveProjects.map(p=>apiRequest(`/api/projects/${encodeURIComponent(p.id)}`,'GET',token).catch(()=>null)));
  const jobs=[],assets=[];
  details.forEach((d,i)=>{
    if(!d)return;
    const projectTitle=liveProjects[i].title,projectId=liveProjects[i].id;
    (d.jobs||[]).forEach(j=>jobs.push({...j,projectTitle,projectId}));
    (d.assets||[]).forEach(a=>assets.push({...a,projectTitle,projectId}));
  });
  jobs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  assets.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  liveQueueJobs=jobs;liveAssets=assets;
}
async function bootstrapLive(){
  const conn=getConnection();
  try{liveProjects=await apiRequest('/api/projects','GET',conn.token)}catch(error){liveProjects=[]}
  if(conn.projectId){
    try{liveProject=await apiRequest(`/api/projects/${encodeURIComponent(conn.projectId)}`,'GET',conn.token)}catch(error){liveProject=null}
  }
  await loadQueueAndAssets();
  const badge=$('#queueCount');if(badge)badge.textContent=liveQueueJobs.filter(j=>j.status==='queued'||j.status==='running').length;
  if(liveProject)show('project');else render();
}
bootstrapLive();

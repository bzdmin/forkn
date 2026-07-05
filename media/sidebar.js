const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const promptEl=$('prompt'), tabsEl=$('tabs'), modelEl=$('model'), modelDot=$('modelDot'),
      runBtn=$('runBtn'), queueBtn=$('queueBtn'), taskListEl=$('taskList'),
      statsEl=$('stats'), settingsBtn=$('settingsBtn'), settingsPanel=$('settingsPanel'),
      settingsRows=$('settingsRows'), tplRow=$('tplRow'), tplNew=$('tplNew');

let providers=[], sel='', settingsOpen=false, lastTasks=[], detailTaskId=null, telemetryState=null;
const PCLS={'claude-code':'pc','codex':'px','antigravity':'pa','opencode':'po'};
const PCOLOR={'claude-code':'#E87C5B','codex':'#10A37F','antigravity':'#4285F4','opencode':'#CCCCCC'};

// Hard reset on every fresh webview load: always start on the task list,
// never on the detail/"Back to tasks" view (F5 / extension reload must not
// land on a stale detail screen).
detailTaskId=null;
const _detailViewEl=$('detailView');
if(_detailViewEl) _detailViewEl.style.display='none';

vscode.postMessage({type:'ready'});

/* -- Run / Queue -- */
let submitLocked=false;
function submitTask(){
  if(submitLocked) return;
  const p=promptEl.value.trim(); if(!p||!sel) return;
  submitLocked=true;
  runBtn.disabled=true; queueBtn.disabled=true;
  runBtn.style.opacity='0.6'; queueBtn.style.opacity='0.6';
  vscode.postMessage({type:'runTask',prompt:p,provider:sel,model:modelEl.value});
  promptEl.value='';promptEl.style.height='auto';
  setTimeout(()=>{
    submitLocked=false;
    runBtn.disabled=false; queueBtn.disabled=false;
    runBtn.style.opacity='1'; queueBtn.style.opacity='1';
  },1000);
}
runBtn.onclick=submitTask;
queueBtn.onclick=submitTask;
promptEl.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();submitTask();}});
promptEl.addEventListener('input',()=>{promptEl.style.height='auto';promptEl.style.height=Math.min(promptEl.scrollHeight,160)+'px';});

/* -- Settings -- */
settingsBtn.onclick=()=>{settingsOpen=!settingsOpen;settingsPanel.classList.toggle('open',settingsOpen);settingsBtn.classList.toggle('active',settingsOpen);if(settingsOpen)renderSettings();};

function renderSettings(){
  settingsRows.innerHTML=providers.map(p=>{
    const ok=p.detected;
    let acts='';
    if(!ok) acts='<div class="s-actions"><button class="s-browse" data-browse="'+p.id+'">Browse&#8230;</button><input class="s-input" data-pi="'+p.id+'" placeholder="paste path"/><button class="s-apply" data-apply="'+p.id+'">Set</button></div>';
    else acts='<div class="s-actions"><button class="s-browse" data-browse="'+p.id+'">Change&#8230;</button>'+(p.id==='antigravity'?'<button class="s-browse" data-auth="'+p.id+'">Sign in</button>':'')+'</div>';
    return '<div class="s-row"><div class="s-top"><span class="s-dot" style="background:'+p.color+'"></span><span class="s-name" style="color:'+p.color+'">'+H(p.label)+'</span><span class="s-badge '+(ok?'ok':'no')+'">'+(ok?'&#9989; Detected':'&#10060; Not found')+'</span></div>'
      +(p.detectedPath?'<div class="s-path" title="'+H(p.detectedPath)+'">'+H(p.detectedPath)+'</div>':'')
      +(p.version?'<div class="s-ver">'+H(p.version)+'</div>':'')
      +acts+'</div>';
  }).join('')
    +(telemetryState?
      '<div class="settings-title" style="margin-top:12px">Telemetry</div>'
      +'<div class="s-row"><label class="t-row"><input type="checkbox" id="tEnabled"'+(telemetryState.enabled?' checked':'')+'/><span>Share anonymous usage data (events, durations, error types). Never your code or prompts.</span></label></div>'
      +'<div class="s-row"><label class="t-row"><input type="checkbox" id="tPrompts"'+(telemetryState.sharePrompts?' checked':'')+'/><span>Include prompt text in error reports only, to help debug failures. Never sent for successful tasks.</span></label></div>'
      :'');
  settingsRows.querySelectorAll('[data-browse]').forEach(b=>b.onclick=()=>vscode.postMessage({type:'browsePath',provider:b.dataset.browse}));
  settingsRows.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>vscode.postMessage({type:'authenticate',provider:b.dataset.auth}));
  const tE=document.getElementById('tEnabled');if(tE)tE.onchange=()=>vscode.postMessage({type:'setTelemetry',key:'enabled',value:tE.checked});
  const tP=document.getElementById('tPrompts');if(tP)tP.onchange=()=>vscode.postMessage({type:'setTelemetry',key:'sharePrompts',value:tP.checked});
  settingsRows.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>{const i=settingsRows.querySelector('[data-pi="'+b.dataset.apply+'"]');if(i&&i.value.trim())vscode.postMessage({type:'setPath',provider:b.dataset.apply,path:i.value.trim()});});
  settingsRows.querySelectorAll('.s-input').forEach(i=>i.addEventListener('keydown',e=>{if(e.key==='Enter'&&i.value.trim())vscode.postMessage({type:'setPath',provider:i.dataset.pi,path:i.value.trim()});}));
}

/* -- Templates -- */
tplRow.addEventListener('click',e=>{const t=e.target.closest('.tpl[data-tpl]');if(t){promptEl.value=t.dataset.tpl;if(t.dataset.prov){pickProvider(t.dataset.prov);if(t.dataset.model)modelEl.value=t.dataset.model;}promptEl.focus();}});
tplNew.onclick=()=>{vscode.postMessage({type:'requestNewTemplate',draft:promptEl.value.trim()});};
function addTpl(name,text,prov,model){const s=document.createElement('span');s.className='tpl';s.dataset.custom='1';s.textContent=name;s.dataset.tpl=text;if(prov)s.dataset.prov=prov;if(model)s.dataset.model=model;tplNew.before(s);}

/* -- Tabs -- */
tabsEl.addEventListener('click',e=>{const t=e.target.closest('.tab');if(!t||t.classList.contains('disabled'))return;pickProvider(t.dataset.p);});
function pickProvider(id){
  sel=id;
  tabsEl.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.p===id));
  modelDot.style.background=PCOLOR[id]||'#888';
  const p=providers.find(x=>x.id===id);
  if(p) modelEl.innerHTML=p.models.map(m=>'<option value="'+m.id+'">'+m.label+'</option>').join('');
}

/* -- Messages -- */
window.addEventListener('message',ev=>{
  const m=ev.data;
  if(m.type==='providers'){
    providers=m.providers;
    if(m.telemetry)telemetryState=m.telemetry;
    if(m.templates){tplRow.querySelectorAll('.tpl[data-custom]').forEach(el=>el.remove());m.templates.forEach(t=>addTpl(t.name,t.prompt,t.provider,t.model));}
    tabsEl.innerHTML=providers.map(p=>{
      const dis=p.detected?'':' disabled';
      const tip=p.detected?'':' title="Not found &#8212; click &#9881;"';
      return '<div class="tab'+dis+'" data-p="'+p.id+'"'+tip+'><span class="tab-dot" style="background:'+p.color+'"></span><span class="tab-label">'+H(p.label)+'</span>'+(p.beta?'<span class="tab-beta">BETA</span>':'')+'</div>';
    }).join('');
    const first=providers.find(p=>p.detected)||providers[0];
    if(first) pickProvider(first.id);
    if(settingsOpen) renderSettings();
  }
  if(m.type==='templateCreated'){addTpl(m.name,m.prompt,m.provider,m.model);}
  if(m.type==='tasksUpdated'){lastTasks=m.tasks;renderTasks(m.tasks);renderStats(m.tasks);if(detailTaskId)refreshDetail();}
});

/* -- Delegated card clicks -- */
taskListEl.addEventListener('click',e=>{
  const b=e.target.closest('[data-a]');if(!b) return;
  const a=b.dataset.a, id=b.dataset.id;
  if(a==='cancel') vscode.postMessage({type:'cancelTask',taskId:id});
  if(a==='rerun') vscode.postMessage({type:'rerunTask',taskId:id});
  if(a==='savetpl'){const pr=b.dataset.pr;if(pr){vscode.postMessage({type:'requestTemplateName',prompt:pr,provider:b.dataset.prov||'',model:b.dataset.model||''});}}
  if(a==='menu'){const c=b.closest('.card'),acts=c.querySelector('.card-actions');if(acts)acts.style.display=acts.style.display==='none'?'flex':'none';}
  if(a==='output'){openDetail(id);}
});

/* -- Render tasks -- */
function renderTasks(tasks){
  if(!tasks.length){taskListEl.innerHTML='<div class="empty"><div class="empty-dots"><span style="background:var(--claude)"></span><span style="background:var(--codex)"></span><span style="background:var(--antigravity)"></span><span style="background:var(--opencode)"></span></div><div class="empty-txt">No tasks yet</div></div>';return;}

  const running=tasks.filter(t=>t.status==='running');
  const queued=tasks.filter(t=>t.status==='queued');
  const done=tasks.filter(t=>t.status==='completed'||t.status==='failed'||t.status==='cancelled');

  let h='';
  if(running.length){h+='<div class="sec"><span class="sec-label">Running</span><span class="sec-count">'+running.length+'</span></div>';h+=running.map(t=>cardRunning(t)).join('');}
  if(queued.length){h+='<div class="sec"><span class="sec-label">Queued</span><span class="sec-count">'+queued.length+'</span></div>';h+=queued.map((t,i)=>cardQueued(t,i+1)).join('');}
  if(done.length){h+='<div class="sec"><span class="sec-label">Completed</span><span class="sec-count">'+done.length+'</span><span class="sec-spacer"></span><span class="sec-clear" id="clearDone">Clear</span></div>';h+=done.map(t=>cardDone(t)).join('');}

  taskListEl.innerHTML=h;
  const cl=document.getElementById('clearDone');if(cl)cl.onclick=()=>vscode.postMessage({type:'clearCompleted'});
  taskListEl.querySelectorAll('.card.run .card-output').forEach(el=>{el.scrollTop=el.scrollHeight;});
}

function cardRunning(t){
  const pc=PCLS[t.provider]||'';
  const color=PCOLOR[t.provider]||'#888';
  const prov=provLabel(t.provider);
  const elapsed=t.startedAt?fmtMs(Date.now()-t.startedAt)+'&#8230;':'';
  const cost=estCost(t.model);
  const out=t.output?'<div class="card-output '+pc+'">'+H(t.output)+'</div>':'';
  const err=t.error?'<div class="card-error">'+H(t.error)+'</div>':'';

  return '<div class="card run '+pc+'">'
    +'<div class="card-top"><span class="card-dot pulse" style="background:'+color+'"></span>'
    +'<span class="card-title">'+H(t.prompt)+'</span>'
    +'<div class="card-btns"><button class="cbtn" data-a="cancel" data-id="'+t.id+'" title="Cancel">&#10005;</button></div></div>'
    +'<div class="card-meta"><span class="cm-prov '+pc+'">'+prov+'</span><span class="cm-sep">&#183;</span><span>'+H(t.model||'')+'</span>'
    +(elapsed?'<span class="cm-sep">&#183;</span><span>'+elapsed+'</span>':'')
    +'<span class="cm-sep">&#183;</span><span style="color:#ccc">'+cost+'</span></div>'
    +'<div class="pbar"><div class="pfill" style="background:'+color+'"></div></div>'
    +out+err+'</div>';
}

function cardQueued(t,pos){
  const prov=provLabel(t.provider);
  const pc=PCLS[t.provider]||'';
  return '<div class="card que">'
    +'<div class="card-top"><span class="card-title" style="color:#aaa">'+H(t.prompt)+'</span>'
    +'<span class="que-pos">#'+pos+'</span>'
    +'<div class="card-btns"><button class="cbtn" data-a="cancel" data-id="'+t.id+'" title="Remove">&#10005;</button></div></div>'
    +'<div class="card-meta"><span class="cm-prov '+pc+'">'+prov+'</span><span class="cm-sep">&#183;</span><span>'+H(t.model||'')+'</span></div>'
    +'</div>';
}

function cardDone(t){
  const pc=PCLS[t.provider]||'';
  const prov=provLabel(t.provider);
  const elapsed=t.elapsedMs?fmtMs(t.elapsedMs):'';
  const cost=estCost(t.actualModel||t.model);
  const ago=t.completedAt?fmtAgo(t.completedAt):'';
  const fc=t.output?countFiles(t.output):0;
  const isBetaNotice=t.error&&t.error.indexOf('BETA_NONTTY:')===0;
  const isCancelled=t.status==='cancelled';
  const isFail=t.status==='failed'&&!isBetaNotice;
  const badgeCls=isBetaNotice?'beta':((isFail||isCancelled)?'fail':'done');
  const badgeTxt=isCancelled?'CANCELLED':isBetaNotice?'BETA':isFail?'FAILED':'COMPLETED';
  const cls=isBetaNotice?'beta':((isFail||isCancelled)?'fail':'done');

  const out=t.output?'<div class="card-output '+pc+'">'+H(t.output)+'</div>':'';
  const errText=isBetaNotice?t.error.replace('BETA_NONTTY:','').trim():t.error;
  const err=t.error?'<div class="card-'+(isBetaNotice?'beta-note':'error')+'">'+H(errText)+'</div>':'';

  return '<div class="card '+cls+'">'
    +'<div class="card-top"><span class="card-badge '+badgeCls+'">'+badgeTxt+'</span>'
    +'<span class="card-title" style="margin-left:6px">'+H(t.prompt)+'</span>'
    +'<button class="card-menu" data-a="menu" data-id="'+t.id+'">&#8943;</button></div>'
    +'<div class="card-meta"><span class="cm-prov '+pc+'">'+prov+'</span>'
    +'<span class="cm-sep">&#183;</span><span'+(t.fallbackFrom?' title="Requested '+H(t.fallbackFrom)+', fell back after failure"':'')+'>'+H(t.actualModel||t.model||'')+(t.fallbackFrom?' <span class="cm-fallback">&#8617; fallback</span>':'')+'</span>'
    +'<span class="cm-sep">&#183;</span><span style="color:#ccc">'+cost+'</span>'
    +(fc>0?'<span class="cm-sep">&#183;</span><span>'+fc+' file'+(fc>1?'s':'')+'</span>':'')
    +(ago?'<span class="cm-sep">&#183;</span><span>'+ago+'</span>':'')
    +'</div>'
    +out+err
    +'<div class="card-actions" style="display:none">'
    +'<button class="cact" data-a="rerun" data-id="'+t.id+'">&#128260; Re-run</button>'
    +'<button class="cact" data-a="savetpl" data-id="'+t.id+'" data-pr="'+H(t.prompt).replace(/"/g,"&quot;")+'" data-prov="'+t.provider+'" data-model="'+H(t.model||'')+'">&#128190; Template</button>'
    +(t.output?'<button class="cact" data-a="output" data-id="'+t.id+'">&#128196; Open</button>':'')
    +'</div></div>';
}

/* -- Detail view -- */
const detailView=$('detailView'), detailBack=$('detailBack');
detailBack.onclick=closeDetail;
function openDetail(id){detailTaskId=id;detailView.style.display='flex';refreshDetail();}
function closeDetail(){detailTaskId=null;detailView.style.display='none';}
function refreshDetail(){
  const t=lastTasks.find(x=>x.id===detailTaskId);
  if(!t){closeDetail();return;}
  const pc=PCLS[t.provider]||'';
  const prov=provLabel(t.provider);
  const shownModel=t.actualModel||t.model;
  const cost=estCost(shownModel);
  const dur=t.elapsedMs?fmtMs(t.elapsedMs):t.startedAt?fmtMs(Date.now()-t.startedAt)+'&#8230;':'';
  const ago=t.completedAt?fmtAgo(t.completedAt):'';
  $('detailPrompt').textContent=t.prompt;
  let meta='<span class="cm-prov '+pc+'" style="font-weight:600">'+prov+'</span>'
    +'<span class="cm-sep">&#183;</span><span>'+H(shownModel||'')+(t.fallbackFrom?' <span class="cm-fallback">&#8617; fallback</span>':'')+'</span>'
    +'<span class="cm-sep">&#183;</span><span style="color:#ccc">'+cost+'</span>';
  if(dur)meta+='<span class="cm-sep">&#183;</span><span>'+dur+'</span>';
  if(ago)meta+='<span class="cm-sep">&#183;</span><span>'+ago+'</span>';
  if(t.fallbackFrom){
    meta+='<div class="detail-fallback-note">'+H(t.fallbackFrom)+' wasn\'t available, so this task was completed with '+H(shownModel)+' instead.</div>';
  }
  $('detailMeta').innerHTML=meta;
  $('detailOutput').textContent=t.output||t.error||'(no output yet)';
  const acts=$('detailActions');
  acts.innerHTML='<button class="detail-act primary" data-da="rerun">&#128260; Re-run</button>'
    +'<button class="detail-act" data-da="template">&#128190; Template</button>'
    +'<button class="detail-act" data-da="copy">&#128203; Copy</button>';
  acts.querySelector('[data-da="rerun"]').onclick=()=>{vscode.postMessage({type:'rerunTask',taskId:t.id});};
  acts.querySelector('[data-da="template"]').onclick=()=>{vscode.postMessage({type:'requestTemplateName',prompt:t.prompt,provider:t.provider,model:t.model});};
  acts.querySelector('[data-da="copy"]').onclick=()=>{copyText(t.output||t.error||'');};
}

/* -- Output/task classification for dynamic button labels -- */
function copyText(txt,explicitBtn){
  const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');}catch(e){}
  document.body.removeChild(ta);
  const btn=explicitBtn||$('detailActions').querySelector('[data-da="copy"]');
  if(btn){const o=btn.textContent;btn.textContent='&#10003; Copied';setTimeout(()=>{btn.textContent=o;},1200);}
}

/* -- Stats -- */
function renderStats(tasks){
  if(!tasks.length){statsEl.style.display='none';return;}
  statsEl.style.display='flex';
  const completed=tasks.filter(t=>t.status==='completed');
  const failed=tasks.filter(t=>t.status==='failed');
  const running=tasks.filter(t=>t.status==='running').length;
  let spend=0; completed.forEach(t=>{spend+=COST_MAP[t.actualModel||t.model]||0;});
  let failedSpend=0; failed.forEach(t=>{failedSpend+=COST_MAP[t.actualModel||t.model]||0;});
  const totalSpend=spend+failedSpend;
  const savedMin=completed.length*5;
  const savedTxt=savedMin>=60?(savedMin/60).toFixed(1)+'h':savedMin+'m';

  // Spend with failed portion in red
  if(failedSpend>0){
    $('sSpend').innerHTML='$'+totalSpend.toFixed(2)+'<span style="color:var(--error);font-size:10px"> ($'+failedSpend.toFixed(2)+' failed)</span>';
  } else {
    $('sSpend').textContent='$'+totalSpend.toFixed(2);
  }
  $('sTasks').textContent=String(tasks.length);

  // Middle slot(s): show Running when something is active,
  // otherwise show Completed and Failed counts (more useful at rest).
  if(running>0){
    $('sMidWrap').style.display='';
    $('sMid2Wrap').style.display='none';
    $('sMid').className='st-val run-color';
    $('sMid').innerHTML='<span class="st-dot"></span>'+running;
    $('sMidLabel').textContent='Running';
  } else {
    // Completed slot
    $('sMidWrap').style.display='';
    $('sMid').className='st-val g';
    $('sMid').textContent=String(completed.length);
    $('sMidLabel').textContent='Completed';
    // Failed slot (only if there are failures)
    if(failed.length>0){
      $('sMid2Wrap').style.display='';
      $('sMid2').textContent=String(failed.length);
    } else {
      $('sMid2Wrap').style.display='none';
    }
  }
  $('sSaved').textContent=savedTxt;
}
const COST_MAP={'claude-opus-4-6':.48,'claude-sonnet-4-6':.12,'claude-haiku-4-5':.03,'gpt-5.5':.30,'o4-mini':.08,'o3':.20,'gemini-3.5-flash':0,'gemini-3.5-pro':.10};

/* -- Helpers -- */
function provLabel(id){return{'claude-code':'Claude','codex':'Codex','antigravity':'Antigravity','opencode':'OpenCode'}[id]||id;}
function estCost(m){const c={'claude-opus-4-6':'~$0.48','claude-sonnet-4-6':'~$0.12','claude-haiku-4-5':'~$0.03','gpt-5.5':'~$0.30','o4-mini':'~$0.08','o3':'~$0.20','gemini-3.5-flash':'$0.00','gemini-3.5-pro':'~$0.10'};if((m||'').startsWith('opencode/'))return'$0.00';return c[m]||'&#8212;';}
function fmtMs(ms){if(ms<1000)return ms+'ms';const s=Math.floor(ms/1000);if(s<60)return s+'s';return Math.floor(s/60)+'m '+s%60+'s';}
function fmtAgo(ts){const d=Math.floor((Date.now()-ts)/1000);if(d<60)return'just now';if(d<3600)return Math.floor(d/60)+'m ago';if(d<86400)return Math.floor(d/3600)+'h ago';return new Date(ts).toLocaleDateString();}
function countFiles(o){const m=o.match(/(?:created|modified|wrote|updated|changed).*?[\w\-\/]+\.\w+/gi);if(m)return m.length;const p=o.match(/[\w\-\.\/]+\.[a-z]{1,5}/gi);if(p){return Math.min(new Set(p).size,20);}return 0;}
function H(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
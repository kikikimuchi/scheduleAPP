// ============= UI RENDER =============
// (cache, MODES, MODE_KEYS, MODE_TASKS は index.html の <script type="module"> で window にぶら下げ済み)

// 起床時刻シフト計算
function getShiftMin(date, mode){
  const wake = cache.wakeTimes[date];
  if(!wake) return 0;
  const baseWake = (MODE_TASKS[mode] || []).find(t=>t.key==='wake'||t.key==='wake_natural');
  if(!baseWake) return 0;
  const b = parseTime(baseWake.time);
  const a = parseTime(wake);
  if(b===null || a===null) return 0;
  return a - b;
}

// ============= TODAY PAGE =============
window.renderToday = function(){
  const today = getTodayDateString();
  const modeKey = cache.dayModes[today] || 'normal';
  const mode = MODES[modeKey];
  
  // モードカード
  $('mode-card').className = 'mode-card ' + mode.cls;
  $('mode-ico').textContent = mode.icon;
  $('mode-name').textContent = mode.label;
  $('mode-desc').textContent = mode.desc;
  
  // 体重
  const latest = cache.weights.length>0 ? cache.weights[cache.weights.length-1] : null;
  const w = latest ? latest.weight : cache.settings.startWeight;
  $('w-kg').textContent = w.toFixed(1);
  $('w-bf').textContent = (latest && latest.bodyFat) ? `体脂肪 ${latest.bodyFat.toFixed(1)}%` : '体脂肪未記録';
  $('w-rem').textContent = `目標まで ${(w - cache.settings.targetWeight).toFixed(1)}kg ▶ 記録`;
  
  // 起床時刻
  $('wake-input').value = cache.wakeTimes[today] || '';
  
  // タスクリスト
  const shiftMin = getShiftMin(today, modeKey);
  const modeTasks = (MODE_TASKS[modeKey] || []).map(t => ({...t, time: adjustTime(t.time, shiftMin)}));
  const customTasks = (cache.customTasks[today] || []).map(t => ({key:`custom_${t.id}`, time:t.time, label:t.label, icon:'⭐', custom:true, id:t.id}));
  const allTasks = [...modeTasks, ...customTasks];
  
  const taskHtml = allTasks.length === 0
    ? '<div class="empty-state"><div class="em-ico">○</div><div style="font-size:11px;">タスクが設定されていません</div></div>'
    : allTasks.map(t => {
        const checked = cache.todayChecks[`${today}_${t.key}`];
        const delBtn = t.custom ? `<button class="btn-sec" style="padding:4px 8px;font-size:10px;border:none;color:var(--ink-mute);" onclick="event.stopPropagation();removeCustomTaskById(${t.id})">×</button>` : '';
        return `<div class="task-row" onclick="onTodayCheckClick('${t.key}')">
          <div class="task-time">${t.time||'—'}</div>
          <div class="task-icon">${t.icon}</div>
          <div class="task-label ${checked?'done':''}">${t.label}</div>
          ${delBtn}
          <div class="task-check ${checked?'on':''}">${checked?'✓':''}</div>
        </div>`;
      }).join('');
  $('task-list').innerHTML = taskHtml;
  
  // Mission
  const doneCount = allTasks.filter(t => cache.todayChecks[`${today}_${t.key}`]).length;
  $('mission-done').textContent = doneCount;
  $('mission-total').textContent = allTasks.length;
  $('mission-bar').style.width = (allTasks.length ? (doneCount/allTasks.length*100) : 0) + '%';
  
  // 寝る前ルーティン
  const isLightNight = ['recovery','rest','trip_work','trip_private'].includes(modeKey);
  const nightRaw = isLightNight ? [
    { key:'teeth', label:'歯磨き', time:'〜寝る前', icon:'🪥' },
    { key:'sleep', label:'眠れた', time:'〜寝る前', icon:'😴' },
  ] : [
    { key:'pc_off', label:'PC作業を終える', time:'23:00', icon:'🖥️' },
    { key:'bath', label:'入浴 (40度ぬるめ)', time:'23:00-23:30', icon:'🛁' },
    { key:'bodycare', label:'ボディケア', time:'23:30-23:45', icon:'🧴' },
    { key:'teeth', label:'歯磨き', time:'23:45-24:00', icon:'🪥' },
    { key:'reading', label:'読書 (紙の本)', time:'24:00-25:00', icon:'📖' },
    { key:'sleep', label:'眠気が来たらベッドへ', time:'〜25:00', icon:'😴' },
  ];
  const nightTasks = nightRaw.map(t=>({...t, time: adjustTime(t.time, shiftMin)}));
  const nightHtml = nightTasks.map(t=>{
    const checked = cache.nightChecks[`${today}_${t.key}`];
    return `<div class="night-task ${checked?'on':''}" onclick="onNightCheckClick('${t.key}')">
      <div class="task-icon">${t.icon}</div>
      <div style="flex:1;">
        <div style="font-size:10px;color:var(--ink-mute);">${t.time}</div>
        <div class="task-label ${checked?'done':''}" style="font-size:12px;">${t.label}</div>
      </div>
      <div class="task-check ${checked?'on':''}">${checked?'✓':''}</div>
    </div>`;
  }).join('');
  $('night-list').innerHTML = nightHtml;
  const nightDone = nightTasks.filter(t=>cache.nightChecks[`${today}_${t.key}`]).length;
  $('night-count').textContent = `${nightDone}/${nightTasks.length}`;
  
  // 年末ゴール
  renderEndOfYearProgress();
  
  // マイルストーン
  renderMilestones();
};

function renderEndOfYearProgress(){
  const prod = cache.productionTasks;
  const prodDone = prod.filter(t=>t.done).length;
  const prodPct = prod.length ? Math.round(prodDone/prod.length*100) : 0;
  const long = cache.youtubeLong.length;
  const longPct = Math.round(long / cache.settings.youtubeLongTarget * 100);
  const short = cache.youtubeShort.length;
  const shortPct = Math.round(short / cache.settings.youtubeShortTarget * 100);
  const vanSum = cache.savings.reduce((s,e)=>s+(e.amount||0),0);
  const vanPct = Math.round(vanSum / cache.settings.vanBudget * 100);
  const hairTotal = (cache.hairRemoval.beard||0) + (cache.hairRemoval.fullBody||0);
  
  const bars = [
    { lbl:'自主制作 (12月末必達)', pct:prodPct, ico:'🎬' },
    { lbl:'YouTube長尺', pct:longPct, ico:'🎥' },
    { lbl:'YouTubeショート', pct:shortPct, ico:'📱' },
    { lbl:'軽バン貯金 (9月末)', pct:vanPct, ico:'🚗' },
  ];
  $('end-of-year-progress').innerHTML = bars.map(b=>`
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <div style="font-size:12px;color:var(--ink-soft);"><span>${b.ico}</span> ${b.lbl}</div>
        <div style="font-size:12px;font-weight:700;">${Math.min(b.pct,100)}%</div>
      </div>
      <div style="height:6px;background:rgba(0,0,0,.05);border-radius:3px;overflow:hidden;">
        <div style="height:100%;background:linear-gradient(90deg,var(--pink),var(--lav));width:${Math.min(b.pct,100)}%;transition:width .3s;"></div>
      </div>
    </div>
  `).join('') + `
    <div style="margin-top:12px;padding:10px;background:rgba(0,0,0,.03);border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:12px;color:var(--ink-soft);">✨ 脱毛通院</div>
      <div style="font-weight:700;">${hairTotal}回</div>
    </div>
  `;
}

function renderMilestones(){
  const today = new Date();
  const currentMonth = `${today.getMonth()+1}月`;
  const latest = cache.weights.length>0 ? cache.weights[cache.weights.length-1].weight : cache.settings.startWeight;
  
  $('milestone-list').innerHTML = cache.milestones.map(ms=>{
    const isCurrent = ms.m === currentMonth;
    const diff = ms.targetWeight ? (latest - ms.targetWeight).toFixed(1) : null;
    const diffStr = diff !== null && !isNaN(parseFloat(diff))
      ? `(${diff > 0 ? '+' : ''}${diff})` : '';
    return `<div class="ms-card ${isCurrent?'current':''}" onclick="openMilestoneEdit('${ms.m}')">
      <div class="ms-row">
        <div>
          <span class="ms-month">${ms.m}</span>
          <span class="ms-theme">${ms.t||''}</span>
        </div>
        ${ms.targetWeight ? `<div><span class="ms-weight">${ms.targetWeight}kg</span><span class="ms-diff">${diffStr}</span></div>` : ''}
      </div>
      ${ms.items ? `<div class="ms-items">${ms.items}</div>` : ''}
    </div>`;
  }).join('');
}

// ============= TODAY HANDLERS =============
window.onTodayCheckClick = async function(key){
  const today = getTodayDateString();
  await toggleTodayCheck(`${today}_${key}`);
  renderToday();
};
window.onNightCheckClick = async function(key){
  const today = getTodayDateString();
  await toggleNightCheck(`${today}_${key}`);
  renderToday();
};
window.onWakeTimeChange = async function(){
  const today = getTodayDateString();
  const val = $('wake-input').value;
  await saveWakeTime(today, val);
  renderToday();
};
window.openWeightInput = function(){
  $('w-input-kg').value = '';
  $('w-input-bf').value = '';
  openModal('ov-weight');
};
window.saveWeight = async function(){
  const w = $('w-input-kg').value;
  const bf = $('w-input-bf').value;
  if(!w) return alert('体重を入力してください');
  await saveWeightEntry(w, bf);
  closeModal('ov-weight');
  renderAll();
};
window.addCustomTask = async function(){
  const today = getTodayDateString();
  const time = $('custom-task-time').value;
  const label = $('custom-task-label').value.trim();
  if(!label) return;
  const tasks = [...(cache.customTasks[today]||[])];
  tasks.push({ id:Date.now(), time, label });
  await saveCustomTasksFB(today, tasks);
  $('custom-task-time').value = '';
  $('custom-task-label').value = '';
  renderToday();
};
window.removeCustomTaskById = async function(id){
  const today = getTodayDateString();
  const tasks = (cache.customTasks[today]||[]).filter(t=>t.id!==id);
  await saveCustomTasksFB(today, tasks);
  renderToday();
};

// ============= MODE SELECTOR =============
window.openModeSelector = function(){
  const today = getTodayDateString();
  const current = cache.dayModes[today];
  $('mode-grid-container').innerHTML = MODE_KEYS.map(k=>{
    const m = MODES[k];
    return `<button class="mode-btn ${current===k?'on '+m.cls:''}" onclick="selectMode('${k}')">
      <div class="mode-btn-icon">${m.icon}</div>
      <div class="mode-btn-lbl">${m.label}</div>
    </button>`;
  }).join('');
  openModal('ov-mode');
};
window.selectMode = async function(key){
  const today = getTodayDateString();
  await saveDayMode(today, key);
  closeModal('ov-mode');
  renderAll();
};

// ============= MILESTONE EDIT =============
let _editingMonth = null;
window.openMilestoneEdit = function(month){
  const ms = cache.milestones.find(m=>m.m===month);
  if(!ms) return;
  _editingMonth = month;
  $('ms-edit-month').textContent = month;
  $('ms-edit-theme').value = ms.t || '';
  $('ms-edit-items').value = ms.items || '';
  $('ms-edit-weight').value = ms.targetWeight || 0;
  openModal('ov-milestone');
};
window.saveMilestone = async function(){
  if(!_editingMonth) return;
  const ms = cache.milestones.find(m=>m.m===_editingMonth);
  ms.t = $('ms-edit-theme').value.trim();
  ms.items = $('ms-edit-items').value.trim();
  ms.targetWeight = parseFloat($('ms-edit-weight').value) || 0;
  await saveMilestoneFB(ms);
  closeModal('ov-milestone');
  renderMilestones();
};

// ============= PROJECTS PAGE =============
let _projFilter = 'active';
window.setProjFilter = function(f){
  _projFilter = f;
  document.querySelectorAll('[data-pf]').forEach(b=>b.classList.toggle('on', b.dataset.pf===f));
  renderProjects();
};
window.renderProjects = function(){
  const todayStr = getTodayDateString();
  const active = cache.projects.filter(p=>p.status==='active');
  const filtered = cache.projects.filter(p=>_projFilter==='all' || p.status===_projFilter);
  const allOpenTasks = active.flatMap(p => (p.tasks||[]).filter(t=>!t.done).map(t=>({...t, projName:p.name, projId:p.id})));
  
  $('proj-active-count').textContent = active.length;
  $('proj-task-count').textContent = allOpenTasks.length;
  
  if(allOpenTasks.length > 0){
    $('all-tasks-card').style.display = '';
    $('all-tasks-count').textContent = allOpenTasks.length + '件';
    $('all-tasks-list').innerHTML = allOpenTasks.map(t=>`
      <div class="ptask-row">
        <div class="ptask-check" onclick="toggleProjTask('${t.projId}','${t.id}')"></div>
        <div style="flex:1;">
          <div style="font-size:13px;">${t.label}</div>
          <div style="font-size:10px;color:var(--ink-mute);">— ${t.projName}</div>
        </div>
      </div>
    `).join('');
  } else {
    $('all-tasks-card').style.display = 'none';
  }
  
  const formatDeadline = (d)=>{
    if(!d) return '';
    const diff = Math.ceil((new Date(d) - new Date(todayStr))/(86400000));
    if(diff < 0) return `${Math.abs(diff)}日超過`;
    if(diff === 0) return '今日';
    if(diff === 1) return '明日';
    return `あと${diff}日`;
  };
  
  if(filtered.length === 0){
    $('project-list').innerHTML = `<div class="empty-state"><div class="em-ico">○</div><div>案件がありません</div><div style="font-size:10px;color:var(--ink-mute);margin-top:6px;">＋ 追加 から登録</div></div>`;
    return;
  }
  
  $('project-list').innerHTML = filtered.map(p=>{
    const tasks = p.tasks || [];
    const done = tasks.filter(t=>t.done).length;
    const pct = tasks.length ? Math.round(done/tasks.length*100) : 0;
    const expanded = _expandedProjId === p.id;
    const isOverdue = p.deadline && new Date(p.deadline) < new Date(todayStr) && p.status==='active';
    
    return `<div class="proj-card">
      <div class="proj-head" onclick="toggleProjExpand('${p.id}')">
        <div style="flex:1;min-width:0;">
          <div class="proj-name">${p.name}</div>
          ${p.client ? `<div class="proj-client">${p.client}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="proj-progress">${pct}<span class="proj-progress-pct">%</span></div>
          <div style="font-size:10px;color:var(--ink-mute);margin-top:2px;">${done}/${tasks.length}</div>
        </div>
      </div>
      <div class="proj-bar"><div class="proj-bar-fill" style="width:${pct}%"></div></div>
      <div class="proj-meta">
        ${p.deadline ? `<span style="color:${isOverdue?'#E88FA1':'var(--ink-soft)'};">締切 · ${p.deadline} (${formatDeadline(p.deadline)})</span>` : ''}
        <span style="float:right;">${expanded ? '▲' : '▼'}</span>
      </div>
      ${expanded ? `<div class="proj-body">
        ${tasks.length === 0 ? `<div style="text-align:center;font-size:11px;color:var(--ink-mute);padding:10px;">タスクがありません</div>` :
          tasks.map(t=>`<div class="ptask-row">
            <div class="ptask-check ${t.done?'on':''}" onclick="toggleProjTask('${p.id}','${t.id}')">${t.done?'✓':''}</div>
            <div class="ptask-label ${t.done?'done':''}">${t.label}</div>
            <button class="btn-sec" style="padding:4px 8px;border:none;font-size:11px;color:var(--ink-mute);" onclick="deleteProjTask('${p.id}','${t.id}')">×</button>
          </div>`).join('')
        }
        <div style="display:flex;gap:6px;margin-top:10px;">
          <input class="fi" type="text" id="ptask-input-${p.id}" placeholder="タスクを追加">
          <button class="btn-sec" onclick="addProjTask('${p.id}')">＋</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button class="btn-sec" style="flex:1;" onclick="toggleProjStatus('${p.id}')">${p.status==='active'?'完了にする':'進行中に戻す'}</button>
          <button class="btn-sec" style="color:var(--ink-mute);" onclick="confirmDeleteProj('${p.id}')">削除</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
};

let _expandedProjId = null;
window.toggleProjExpand = function(id){
  _expandedProjId = _expandedProjId === id ? null : id;
  renderProjects();
};
window.openProjectAdd = function(){
  $('pa-name').value=''; $('pa-client').value=''; $('pa-deadline').value=''; $('pa-note').value='';
  openModal('ov-project-add');
};
window.saveNewProject = async function(){
  const name = $('pa-name').value.trim();
  if(!name) return alert('案件名を入力');
  const p = { id:Date.now(), name, client:$('pa-client').value.trim(), deadline:$('pa-deadline').value, note:$('pa-note').value.trim(), status:'active', tasks:[] };
  cache.projects.push(p);
  await saveProjectFB(p);
  closeModal('ov-project-add');
  renderProjects();
};
window.toggleProjTask = async function(pid, tid){
  const p = cache.projects.find(x=>String(x.id)===String(pid));
  if(!p) return;
  const t = (p.tasks||[]).find(x=>String(x.id)===String(tid));
  if(!t) return;
  t.done = !t.done;
  await saveProjectFB(p);
  renderProjects();
};
window.deleteProjTask = async function(pid, tid){
  const p = cache.projects.find(x=>String(x.id)===String(pid));
  if(!p) return;
  p.tasks = (p.tasks||[]).filter(x=>String(x.id)!==String(tid));
  await saveProjectFB(p);
  renderProjects();
};
window.addProjTask = async function(pid){
  const p = cache.projects.find(x=>String(x.id)===String(pid));
  if(!p) return;
  const input = $(`ptask-input-${pid}`);
  const label = input.value.trim();
  if(!label) return;
  p.tasks = [...(p.tasks||[]), { id:Date.now(), label, done:false }];
  await saveProjectFB(p);
  input.value = '';
  renderProjects();
};
window.toggleProjStatus = async function(pid){
  const p = cache.projects.find(x=>String(x.id)===String(pid));
  if(!p) return;
  p.status = p.status==='active' ? 'done' : 'active';
  await saveProjectFB(p);
  renderProjects();
};
window.confirmDeleteProj = async function(pid){
  if(!confirm('案件を削除しますか?')) return;
  cache.projects = cache.projects.filter(x=>String(x.id)!==String(pid));
  await deleteProjectFB(pid);
  renderProjects();
};

// ============= PROGRESS PAGE =============
let _progressTab = 'production';
window.setProgressTab = function(t){
  _progressTab = t;
  document.querySelectorAll('[data-pgt]').forEach(b=>b.classList.toggle('on', b.dataset.pgt===t));
  renderProgress();
};
window.renderProgress = function(){
  const map = {
    production: renderProductionTab,
    long: ()=>renderYTTab(true),
    short: ()=>renderYTTab(false),
    van: renderVanTab,
    hair: renderHairTab,
  };
  $('progress-content').innerHTML = '';
  map[_progressTab] && map[_progressTab]();
};
function renderProductionTab(){
  const tasks = cache.productionTasks;
  const done = tasks.filter(t=>t.done).length;
  const pct = tasks.length ? Math.round(done/tasks.length*100) : 0;
  $('progress-content').innerHTML = `
    <div class="hero-card hero-pink">
      <div class="hero-head">
        <span class="hero-icon">🎬</span>
        <div style="flex:1;">
          <div class="hero-ttl">自主制作</div>
          <div class="hero-sub">12月末完成・投稿が必達</div>
        </div>
        <div class="hero-pct">${pct}%</div>
      </div>
      <div class="hero-bar"><div class="hero-bar-fill" style="width:${pct}%"></div></div>
      <div class="hero-stat">${done} / ${tasks.length} タスク完了</div>
    </div>
    <div class="card">
      <div class="sec-h">タスク追加</div>
      <div style="display:flex;gap:8px;">
        <input class="fi" id="prod-input" placeholder="例: シーン1のラフカット完成" style="flex:1;">
        <button class="btn-pri" style="width:auto;padding:0 16px;" onclick="addProductionTask()">＋</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-h">タスクリスト</div>
      ${tasks.length === 0 ? `<div class="empty-state"><div class="em-ico">📝</div><div>タスクを追加してね</div></div>` :
        tasks.map(t=>`<div class="ptask-row">
          <div class="ptask-check ${t.done?'on':''}" onclick="toggleProductionTask('${t.id}')">${t.done?'✓':''}</div>
          <div class="ptask-label ${t.done?'done':''}">${t.label}</div>
          <button class="btn-sec" style="padding:4px 8px;border:none;color:var(--ink-mute);" onclick="deleteProductionTask('${t.id}')">×</button>
        </div>`).join('')
      }
    </div>
  `;
}
window.addProductionTask = async function(){
  const v = $('prod-input').value.trim();
  if(!v) return;
  const t = { id:Date.now(), label:v, done:false };
  cache.productionTasks.push(t);
  await window.setDocImport('productionTasks', t);
  renderProgress();
  renderToday();
};
window.toggleProductionTask = async function(id){
  const t = cache.productionTasks.find(x=>String(x.id)===String(id));
  if(!t) return;
  t.done = !t.done;
  await window.setDocImport('productionTasks', t);
  renderProgress();
  renderToday();
};
window.deleteProductionTask = async function(id){
  cache.productionTasks = cache.productionTasks.filter(x=>String(x.id)!==String(id));
  await window.deleteDocImport('productionTasks', id);
  renderProgress();
  renderToday();
};

function renderYTTab(isLong){
  const list = isLong ? cache.youtubeLong : cache.youtubeShort;
  const target = isLong ? cache.settings.youtubeLongTarget : cache.settings.youtubeShortTarget;
  const pct = Math.round(list.length / target * 100);
  const cls = isLong ? 'hero-amber' : 'hero-amber';
  const ico = isLong ? '🎥' : '📱';
  const ttl = isLong ? 'YouTube 長尺' : 'YouTube ショート';
  $('progress-content').innerHTML = `
    <div class="hero-card ${cls}">
      <div class="hero-head">
        <span class="hero-icon">${ico}</span>
        <div style="flex:1;">
          <div class="hero-ttl">${ttl}</div>
          <div class="hero-sub">目標 ${target}本</div>
        </div>
        <div class="hero-pct">${Math.min(pct,100)}%</div>
      </div>
      <div class="hero-bar"><div class="hero-bar-fill" style="width:${Math.min(pct,100)}%"></div></div>
      <div class="hero-stat">${list.length} / ${target} 本</div>
    </div>
    <div class="card">
      <div class="sec-h">投稿追加</div>
      <input class="fi" id="yt-input" placeholder="タイトル">
      <button class="btn-pri" style="margin-top:10px;" onclick="addYT(${isLong})">追加</button>
    </div>
    <div class="card">
      <div class="sec-h">投稿リスト</div>
      ${list.length === 0 ? `<div class="empty-state"><div class="em-ico">○</div><div>まだ投稿がありません</div></div>` :
        list.slice().reverse().map(e=>`<div class="ptask-row">
          <div style="flex:1;">${e.title||'(無題)'}</div>
          <button class="btn-sec" style="padding:4px 8px;border:none;color:var(--ink-mute);" onclick="deleteYT(${isLong},'${e.id}')">×</button>
        </div>`).join('')
      }
    </div>
  `;
}
window.addYT = async function(isLong){
  const v = $('yt-input').value.trim();
  if(!v) return;
  const list = isLong ? cache.youtubeLong : cache.youtubeShort;
  const colName = isLong ? 'youtubeLong' : 'youtubeShort';
  const t = { id:Date.now(), title:v, date:getTodayDateString() };
  list.push(t);
  await window.setDocImport(colName, t);
  renderProgress();
  renderToday();
};
window.deleteYT = async function(isLong, id){
  const colName = isLong ? 'youtubeLong' : 'youtubeShort';
  if(isLong) cache.youtubeLong = cache.youtubeLong.filter(x=>String(x.id)!==String(id));
  else cache.youtubeShort = cache.youtubeShort.filter(x=>String(x.id)!==String(id));
  await window.deleteDocImport(colName, id);
  renderProgress();
  renderToday();
};

function renderVanTab(){
  const total = cache.savings.reduce((s,e)=>s+(+e.amount||0),0);
  const pct = Math.round(total / cache.settings.vanBudget * 100);
  $('progress-content').innerHTML = `
    <div class="hero-card hero-blue">
      <div class="hero-head">
        <span class="hero-icon">🚗</span>
        <div style="flex:1;">
          <div class="hero-ttl">軽バン貯金</div>
          <div class="hero-sub">9月末必達 / 目標 ${cache.settings.vanBudget.toLocaleString()}円</div>
        </div>
        <div class="hero-pct">${Math.min(pct,100)}%</div>
      </div>
      <div class="hero-bar"><div class="hero-bar-fill" style="width:${Math.min(pct,100)}%"></div></div>
      <div class="hero-stat">${total.toLocaleString()}円 / ${cache.settings.vanBudget.toLocaleString()}円</div>
    </div>
    <div class="card">
      <div class="sec-h">貯金追加</div>
      <div style="display:flex;gap:8px;">
        <input class="fi no-spinner" type="number" id="van-input" placeholder="金額" inputmode="numeric" style="flex:1;">
        <button class="btn-pri" style="width:auto;padding:0 16px;" onclick="addSavings()">＋</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-h">記録</div>
      ${cache.savings.length === 0 ? `<div class="empty-state"><div class="em-ico">○</div><div>まだ記録がありません</div></div>` :
        cache.savings.slice().reverse().map(e=>`<div class="ptask-row">
          <div style="flex:1;">${e.date} <span style="font-weight:700;margin-left:8px;">${(+e.amount).toLocaleString()}円</span></div>
          <button class="btn-sec" style="padding:4px 8px;border:none;color:var(--ink-mute);" onclick="deleteSavings('${e.id}')">×</button>
        </div>`).join('')
      }
    </div>
  `;
}
window.addSavings = async function(){
  const v = parseFloat($('van-input').value);
  if(!v || isNaN(v)) return;
  const t = { id:Date.now(), amount:v, date:getTodayDateString() };
  cache.savings.push(t);
  await window.setDocImport('savings', t);
  renderProgress();
  renderToday();
};
window.deleteSavings = async function(id){
  cache.savings = cache.savings.filter(x=>String(x.id)!==String(id));
  await window.deleteDocImport('savings', id);
  renderProgress();
  renderToday();
};

function renderHairTab(){
  const hr = cache.hairRemoval;
  $('progress-content').innerHTML = `
    <div class="hero-card hero-purple">
      <div class="hero-head">
        <span class="hero-icon">✨</span>
        <div style="flex:1;">
          <div class="hero-ttl">脱毛通院</div>
          <div class="hero-sub">髭 + 全身</div>
        </div>
        <div class="hero-pct">${(hr.beard||0)+(hr.fullBody||0)}<span style="font-size:12px;">回</span></div>
      </div>
    </div>
    <div class="card">
      <div class="sec-h">髭脱毛 (5〜9月)</div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:24px;font-weight:700;">${hr.beard||0}回</span>
        <div style="display:flex;gap:6px;">
          <button class="btn-sec" onclick="updateHair('beard',-1)">−</button>
          <button class="btn-sec" onclick="updateHair('beard',1)">＋</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-h">全身脱毛 (10月〜)</div>
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:24px;font-weight:700;">${hr.fullBody||0}回</span>
        <div style="display:flex;gap:6px;">
          <button class="btn-sec" onclick="updateHair('fullBody',-1)">−</button>
          <button class="btn-sec" onclick="updateHair('fullBody',1)">＋</button>
        </div>
      </div>
    </div>
  `;
}
window.updateHair = async function(kind, delta){
  cache.hairRemoval[kind] = Math.max(0, (cache.hairRemoval[kind]||0) + delta);
  await window.setDocImport('meta', { id:'hairRemoval', ...cache.hairRemoval });
  renderProgress();
  renderToday();
};

// ============= CALENDAR PAGE =============
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calTab = 'plan';
window.setCalTab = function(t){
  _calTab = t;
  document.querySelectorAll('[data-ct]').forEach(b=>b.classList.toggle('on', b.dataset.ct===t));
  $('cal-plan-tab').style.display = t==='plan' ? '' : 'none';
  $('cal-google-tab').style.display = t==='google' ? '' : 'none';
  if(t==='google') renderGCal();
};
window.calMonth = function(delta){
  _calMonth += delta;
  if(_calMonth < 0){ _calMonth = 11; _calYear--; }
  if(_calMonth > 11){ _calMonth = 0; _calYear++; }
  renderCalendar();
};
window.renderCalendar = function(){
  if(_calTab === 'google'){ renderGCal(); return; }
  $('cal-year').textContent = `— ${_calYear} —`;
  $('cal-mtxt').textContent = `${_calMonth+1}月`;
  
  // 週ヘッダ
  const wd = ['日','月','火','水','木','金','土'];
  $('cal-week').innerHTML = wd.map((d,i)=>`<div class="cal-wd ${i===0?'sun':''} ${i===6?'sat':''}">${d}</div>`).join('');
  
  // グリッド
  const first = new Date(_calYear, _calMonth, 1);
  const last = new Date(_calYear, _calMonth+1, 0);
  const daysInMonth = last.getDate();
  const firstDay = first.getDay();
  const today = getTodayDateString();
  const todayDate = new Date(today + 'T00:00');
  
  let cells = '';
  for(let i=0; i<firstDay; i++) cells += `<div class="cal-cell empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const modeKey = cache.dayModes[dateStr];
    const mode = modeKey ? MODES[modeKey] : null;
    const isToday = dateStr === today;
    const cellDate = new Date(dateStr + 'T00:00');
    const isPast = cellDate < todayDate && !isToday;
    const cls = ['cal-cell'];
    if(isToday) cls.push('today');
    if(isPast && !mode) cls.push('past');
    if(mode) cls.push(mode.cls);
    cells += `<div class="${cls.join(' ')}" onclick="openDayDetail('${dateStr}')">
      <div>${d}</div>
      ${mode ? `<div class="cal-cell-icon">${mode.icon}</div>` : ''}
    </div>`;
  }
  $('cal-grid').innerHTML = cells;
  
  // 配分集計
  const ye = new Date(_calYear, 11, 31);
  const daysLeft = Math.ceil((ye - new Date())/(86400000));
  $('alloc-days-left').textContent = daysLeft;
  
  let work=0, prod=0, rest=0;
  for(let d=1; d<=daysInMonth; d++){
    const ds = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const mk = cache.dayModes[ds];
    if(!mk) continue;
    const cat = MODES[mk].category;
    if(cat==='work') work++;
    else if(cat==='production') prod++;
    else if(cat==='rest') rest++;
  }
  $('alloc-work').textContent = work;
  $('alloc-prod').textContent = prod;
  $('alloc-rest').textContent = rest;
  $('alloc-unset').textContent = daysInMonth - work - prod - rest;
};
window.fillWeekendsRest = async function(){
  const daysInMonth = new Date(_calYear, _calMonth+1, 0).getDate();
  for(let d=1; d<=daysInMonth; d++){
    const date = new Date(_calYear, _calMonth, d);
    if(date.getDay()===0 || date.getDay()===6){
      const ds = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      if(!cache.dayModes[ds]) await saveDayMode(ds, 'rest');
    }
  }
  renderCalendar();
};
window.saveGcalUrl = async function(){
  const url = $('gcal-url').value.trim();
  cache.settings.calendarEmbedUrl = url;
  await saveAllSettings();
  renderGCal();
};
function renderGCal(){
  $('gcal-url').value = cache.settings.calendarEmbedUrl || '';
  const url = cache.settings.calendarEmbedUrl;
  $('gcal-frame-wrap').innerHTML = url
    ? `<iframe src="${url}" style="width:100%;height:600px;border:0;border-radius:14px;margin-top:14px;"></iframe>`
    : `<div class="empty-state"><div class="em-ico">📅</div><div>カレンダーURLを設定すると表示されます</div></div>`;
}

// ============= DAY DETAIL MODAL =============
let _ddDate = null;
let _ddTab = 'mode';
window.openDayDetail = function(date){
  _ddDate = date;
  _ddTab = 'mode';
  const d = new Date(date+'T00:00');
  const wd = ['日','月','火','水','木','金','土'][d.getDay()];
  $('dd-date').textContent = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  $('dd-day').textContent = wd;
  const modeKey = cache.dayModes[date] || 'normal';
  const m = MODES[modeKey];
  $('dd-mode-ico').textContent = m.icon;
  $('dd-mode-name').textContent = m.label;
  $('dd-mode-desc').textContent = m.desc;
  $('dd-wake').textContent = cache.wakeTimes[date] || '—';
  setDayDetailTab('mode');
  openModal('ov-daydetail');
};
window.setDayDetailTab = function(t){
  _ddTab = t;
  $('dd-tab-mode').classList.toggle('on', t==='mode');
  $('dd-tab-sch').classList.toggle('on', t==='schedule');
  renderDayDetailBody();
};
function renderDayDetailBody(){
  if(_ddTab === 'mode'){
    const current = cache.dayModes[_ddDate];
    $('dd-body').innerHTML = `<div class="mode-grid">${MODE_KEYS.map(k=>{
      const m = MODES[k];
      const on = current===k;
      return `<button class="mode-btn ${on?'on '+m.cls:''}" onclick="ddSelectMode('${k}')">
        <div class="mode-btn-icon">${m.icon}</div>
        <div class="mode-btn-lbl">${m.label}</div>
      </button>`;
    }).join('')}</div>
    ${current ? `<button class="btn-sec" style="margin-top:14px;width:100%;" onclick="ddSelectMode(null)">解除</button>` : ''}`;
  } else {
    const modeKey = cache.dayModes[_ddDate] || 'normal';
    const shiftMin = getShiftMin(_ddDate, modeKey);
    const modeTasks = (MODE_TASKS[modeKey] || []).map(t=>({...t, time:adjustTime(t.time, shiftMin)}));
    const customs = (cache.customTasks[_ddDate] || []).map(t=>({key:`custom_${t.id}`, time:t.time, label:t.label, icon:'⭐'}));
    const all = [...modeTasks, ...customs];
    const done = all.filter(t=>cache.todayChecks[`${_ddDate}_${t.key}`]).length;
    
    $('dd-body').innerHTML = `<div style="font-size:10px;letter-spacing:.2em;color:var(--ink-mute);margin-bottom:8px;">— タイムライン — ${done}/${all.length}</div>
    ${all.length === 0 ? '<div class="empty-state"><div class="em-ico">○</div><div>タスクなし</div></div>' :
      all.map(t=>{
        const checked = cache.todayChecks[`${_ddDate}_${t.key}`];
        return `<div class="task-row">
          <div class="task-time">${t.time||'—'}</div>
          <div class="task-icon">${t.icon}</div>
          <div class="task-label ${checked?'done':''}">${t.label}</div>
          <div class="task-check ${checked?'on':''}">${checked?'✓':''}</div>
        </div>`;
      }).join('')
    }`;
  }
}
window.ddSelectMode = async function(key){
  await saveDayMode(_ddDate, key);
  closeModal('ov-daydetail');
  renderAll();
};

// ============= IDEAL PAGE =============
let _idealTab = 'weight';
window.setIdealTab = function(t){
  _idealTab = t;
  document.querySelectorAll('[data-it]').forEach(b=>b.classList.toggle('on', b.dataset.it===t));
  renderIdeal();
};
window.renderIdeal = function(){
  if(_idealTab === 'weight') renderWeightTab();
  else if(_idealTab === 'food') renderFoodTab();
  else if(_idealTab === 'wardrobe') renderWardrobeTab();
  renderInspiration();
};
function renderWeightTab(){
  const latest = cache.weights.length>0 ? cache.weights[cache.weights.length-1] : null;
  const w = latest ? latest.weight : cache.settings.startWeight;
  const bf = latest && latest.bodyFat ? latest.bodyFat : null;
  const change = (w - cache.settings.startWeight).toFixed(1);
  const remaining = (w - cache.settings.targetWeight).toFixed(1);
  
  $('ideal-content').innerHTML = `
    <div class="hero-card hero-blue">
      <div style="font-size:16px;font-weight:700;margin-bottom:14px;">体重 / 体脂肪 トラッカー</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:rgba(255,255,255,.25);border-radius:12px;padding:12px;text-align:center;">
          <div style="font-size:11px;opacity:.9;">体重</div>
          <div style="font-size:24px;font-weight:700;line-height:1;">${w.toFixed(1)}</div>
          <div style="font-size:10px;opacity:.85;margin-top:4px;">スタート ${cache.settings.startWeight}kg → 目標 ${cache.settings.targetWeight}kg</div>
        </div>
        <div style="background:rgba(255,255,255,.25);border-radius:12px;padding:12px;text-align:center;">
          <div style="font-size:11px;opacity:.9;">体脂肪</div>
          <div style="font-size:24px;font-weight:700;line-height:1;">${bf!==null ? bf.toFixed(1) : '—'}</div>
          <div style="font-size:10px;opacity:.85;margin-top:4px;">スタート ${cache.settings.startBodyFat}% → 目標 ${cache.settings.targetBodyFat}%</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;">
        <span>変化: ${change > 0 ? '+' : ''}${change}kg</span>
        <span>残り: ${remaining}kg</span>
      </div>
    </div>
    <div class="card">
      <div class="sec-h">記録する</div>
      <div style="display:flex;gap:8px;">
        <input class="fi no-spinner" type="number" step="0.1" id="iw-kg" placeholder="体重 (kg)" inputmode="decimal" style="flex:1;">
        <input class="fi no-spinner" type="number" step="0.1" id="iw-bf" placeholder="体脂肪 %" inputmode="decimal" style="flex:1;">
        <button class="btn-pri" style="width:auto;padding:0 16px;" onclick="saveWeightFromIdeal()">記録</button>
      </div>
    </div>
    <div class="card">
      <div class="sec-h">推移</div>
      ${cache.weights.length === 0 ? '<div class="empty-state"><div class="em-ico">📈</div><div>記録がありません</div></div>' :
        cache.weights.slice().reverse().slice(0,30).map(e=>`<div class="ptask-row">
          <div style="flex:1;font-size:12px;">${e.date}</div>
          <div style="font-weight:700;">${e.weight.toFixed(1)}kg</div>
          ${e.bodyFat ? `<div style="font-size:11px;color:var(--ink-mute);margin-left:8px;">${e.bodyFat.toFixed(1)}%</div>` : ''}
        </div>`).join('')
      }
    </div>
  `;
}
window.saveWeightFromIdeal = async function(){
  const w = $('iw-kg').value;
  const bf = $('iw-bf').value;
  if(!w) return alert('体重を入力');
  await saveWeightEntry(w, bf);
  renderAll();
};
function renderFoodTab(){
  $('ideal-content').innerHTML = `<div class="card"><div class="sec-h">食事メニュー</div><div class="empty-state"><div class="em-ico">🍱</div><div>食事の好み・定番を記録</div><div style="font-size:10px;margin-top:8px;">この機能は後日実装します</div></div></div>`;
}
function renderWardrobeTab(){
  $('ideal-content').innerHTML = `<div class="card"><div class="sec-h">服飾</div><div class="empty-state"><div class="em-ico">👕</div><div>理想の服スタイル記録</div><div style="font-size:10px;margin-top:8px;">この機能は後日実装します</div></div></div>`;
}
function renderInspiration(){
  $('insp-count').textContent = `${cache.motivations.length}枚`;
  if(cache.motivations.length === 0){
    $('inspiration-content').innerHTML = '<div class="empty-state"><div class="em-ico">📷</div><div>理想の画像を追加</div><div style="font-size:10px;margin-top:8px;">アルバムから選んで保存</div></div>';
    return;
  }
  $('inspiration-content').innerHTML = `<div class="insp-grid">${cache.motivations.map(m=>`
    <div class="insp-item">
      <img src="${m.imageData||m.url||''}" alt="${m.credit||''}" onclick="viewInspiration('${m.id}')">
      <button class="insp-del" onclick="event.stopPropagation();deleteInspiration('${m.id}')">×</button>
    </div>
  `).join('')}</div>`;
}
let _newInspData = null;
window.openInspirationAdd = function(){
  _newInspData = null;
  $('insp-credit').value = '';
  $('insp-save-btn').disabled = true;
  $('insp-upload-zone').innerHTML = `<label class="upload-box"><input type="file" accept="image/*" onchange="onInspFile(event)"><div style="font-size:24px;margin-bottom:8px;">📷</div><div style="font-size:11px;">アルバムから選ぶ</div></label>`;
  openModal('ov-insp-add');
};
window.onInspFile = async function(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  $('insp-upload-zone').innerHTML = `<div class="empty-state" style="padding:60px 20px;"><div class="em-ico">○</div><div>変換中…</div></div>`;
  try{
    _newInspData = await compressImage(f, 1200, 0.8);
    $('insp-upload-zone').innerHTML = `<div class="upload-preview"><img src="${_newInspData}"><button class="del" onclick="resetInspUpload()">×</button></div>`;
    $('insp-save-btn').disabled = false;
  } catch(err){ alert('画像処理失敗: '+err.message); }
};
window.resetInspUpload = function(){
  _newInspData = null;
  $('insp-save-btn').disabled = true;
  $('insp-upload-zone').innerHTML = `<label class="upload-box"><input type="file" accept="image/*" onchange="onInspFile(event)"><div style="font-size:24px;margin-bottom:8px;">📷</div><div style="font-size:11px;">アルバムから選ぶ</div></label>`;
};
window.saveInspiration = async function(){
  if(!_newInspData) return;
  const m = { id:Date.now(), imageData:_newInspData, credit:$('insp-credit').value.trim(), type:'image' };
  cache.motivations.push(m);
  await saveMotivationFB(m);
  closeModal('ov-insp-add');
  renderInspiration();
};
window.deleteInspiration = async function(id){
  if(!confirm('画像を削除しますか?')) return;
  cache.motivations = cache.motivations.filter(m=>String(m.id)!==String(id));
  await deleteMotivationFB(id);
  renderInspiration();
};
window.viewInspiration = function(id){
  const m = cache.motivations.find(x=>String(x.id)===String(id));
  if(!m) return;
  $('img-view-src').src = m.imageData || m.url || '';
  openModal('ov-image-view');
};

// ============= SETTINGS PAGE =============
window.renderSettings = function(){
  const s = cache.settings;
  $('s-start-weight').value = s.startWeight;
  $('s-target-weight').value = s.targetWeight;
  $('s-start-bf').value = s.startBodyFat;
  $('s-target-bf').value = s.targetBodyFat;
  $('s-yt-long').value = s.youtubeLongTarget;
  $('s-yt-short').value = s.youtubeShortTarget;
  $('s-van-budget').value = s.vanBudget;
  $('s-wake-time').value = s.wakeTime;
  $('s-sleep-hours').value = s.targetSleepHours;
  
  const gymDays = ['日','月','火','水','木','金','土'];
  $('gym-days').innerHTML = gymDays.map(d=>`<button class="gym-day ${(s.gymDays||[]).includes(d)?'on':''}" onclick="toggleGymDay('${d}')">${d}</button>`).join('');
};
window.toggleGymDay = async function(d){
  const arr = cache.settings.gymDays || [];
  cache.settings.gymDays = arr.includes(d) ? arr.filter(x=>x!==d) : [...arr, d];
  renderSettings();
};
window.saveSettings = async function(){
  cache.settings.startWeight = parseFloat($('s-start-weight').value);
  cache.settings.targetWeight = parseFloat($('s-target-weight').value);
  cache.settings.startBodyFat = parseFloat($('s-start-bf').value);
  cache.settings.targetBodyFat = parseFloat($('s-target-bf').value);
  cache.settings.youtubeLongTarget = parseInt($('s-yt-long').value);
  cache.settings.youtubeShortTarget = parseInt($('s-yt-short').value);
  cache.settings.vanBudget = parseInt($('s-van-budget').value);
  cache.settings.wakeTime = $('s-wake-time').value;
  cache.settings.targetSleepHours = parseFloat($('s-sleep-hours').value);
  
  // マイルストーンの目標体重を線形補間で再計算
  const sw = cache.settings.startWeight;
  const tw = cache.settings.targetWeight;
  const total = cache.milestones.length;
  if(total > 1){
    const step = (sw - tw) / (total - 1);
    for(let i=0; i<cache.milestones.length; i++){
      const ms = cache.milestones[i];
      ms.targetWeight = i === total-1 ? tw : parseFloat((sw - step*i).toFixed(1));
      await saveMilestoneFB(ms);
    }
  }
  
  await saveAllSettings();
  
  // 視覚フィードバック
  const btn = $('settings-save-btn');
  btn.textContent = '✓ 保存しました';
  btn.disabled = true;
  setTimeout(()=>{ btn.textContent = '保存'; btn.disabled = false; }, 1800);
  
  renderAll();
};

// ============= UI RENDER =============

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
  
  $('mode-card').className = 'mode-card ' + mode.cls;
  $('mode-ico').textContent = mode.icon;
  $('mode-name').textContent = mode.label;
  $('mode-desc').textContent = mode.desc;
  
  // 体重 + ペース計算
  const latest = cache.weights.length>0 ? cache.weights[cache.weights.length-1] : null;
  const w = latest ? latest.weight : cache.settings.startWeight;
  $('w-kg').textContent = w.toFixed(1);
  $('w-bf').textContent = (latest && latest.bodyFat) ? `体脂肪 ${latest.bodyFat.toFixed(1)}%` : '体脂肪未記録';
  
  const remaining = w - cache.settings.targetWeight;
  const yearEnd = new Date(new Date().getFullYear(), 11, 31);
  const daysLeft = Math.ceil((yearEnd - new Date())/(86400000));
  const weeksLeft = Math.max(daysLeft / 7, 0.1);
  const weeklyPace = remaining / weeksLeft;
  
  if(remaining <= 0){
    $('w-rem').textContent = `目標達成 🎉 ▶ 記録`;
  } else {
    $('w-rem').innerHTML = `目標まで ${remaining.toFixed(1)}kg<br>週 ${weeklyPace.toFixed(2)}kg ペース ▶ 記録`;
  }
  
  $('wake-input').value = cache.wakeTimes[today] || '';
  
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
  
  const isLightNight = ['recovery','rest','trip_work','trip_private'].includes(modeKey);
  const nightRaw = isLightNight ? [
    { key:'teeth', label:'歯磨き', time:'〜寝る前', icon:'🪥' },
    { key:'sleep', label:'眠れた', time:'〜寝る前', icon:'😴' },
  ] : [
    { key:'dinner', label:'夕食', time:'19:30', icon:'🍽️' },
    { key:'shower', label:'シャワー (週2回は入浴)', time:'20:30', icon:'🛁' },
    { key:'bodycare', label:'ボディケア', time:'21:00', icon:'🧴' },
    { key:'teeth', label:'歯磨き', time:'21:20', icon:'🪥' },
    { key:'free', label:'自由時間', time:'21:30', icon:'🎮' },
    { key:'reading', label:'読書 (紙の本/ソファで)', time:'23:30', icon:'📖' },
    { key:'sleep', label:'眠気が来たらベッドへ', time:'〜24:30', icon:'😴' },
  ];
  const nightTasks = nightRaw.map(t=>({...t, time: adjustTime(t.time, shiftMin)}));
  const nightHtml = nightTasks.map(t=>{
    const checked = cache.nightChecks[`${today}_${t.key}`];
    return `<div class="task-row night-row ${checked?'on':''}" onclick="onNightCheckClick('${t.key}')">
      <div class="task-time">${t.time}</div>
      <div class="task-icon">${t.icon}</div>
      <div class="task-label ${checked?'done':''}">${t.label}</div>
      <div class="task-check ${checked?'on':''}">${checked?'✓':''}</div>
    </div>`;
  }).join('');
  $('night-list').innerHTML = nightHtml;
  const nightDone = nightTasks.filter(t=>cache.nightChecks[`${today}_${t.key}`]).length;
  $('night-count').textContent = `${nightDone}/${nightTasks.length}`;
};

function renderEndOfYearProgress(){
  const prod = cache.productionTasks;
  const prodDone = prod.filter(t=>t.done).length;
  const prodPct = prod.length ? Math.round(prodDone/prod.length*100) : 0;
  const long = cache.youtubeLong.length;
  const longPct = Math.round(long / cache.settings.youtubeLongTarget * 100);
  const short = cache.youtubeShort.length;
  const shortPct = Math.round(short / cache.settings.youtubeShortTarget * 100);
  const vanSum = cache.savings.reduce((s,e)=>s+(+e.amount||0),0);
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
window.setWakeToNow = async function(){
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const time = `${hh}:${mm}`;
  $('wake-input').value = time;
  const today = getTodayDateString();
  await saveWakeTime(today, time);
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
  renderProgress();
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
  const priorityTasks = allOpenTasks.filter(t=>t.priority);
  const otherTasks = allOpenTasks.filter(t=>!t.priority);
  
  $('proj-active-count').textContent = active.length;
  $('proj-task-count').textContent = allOpenTasks.length;
  
  if(allOpenTasks.length > 0){
    $('all-tasks-card').style.display = '';
    $('all-tasks-count').textContent = otherTasks.length + '件';
    
    // 優先タスクリスト (左)
    $('priority-tasks-list').innerHTML = priorityTasks.length === 0
      ? `<div style="font-size:10px;color:var(--ink-faint);text-align:center;padding:14px 4px;background:rgba(244,166,181,.08);border-radius:8px;border:1px dashed rgba(244,166,181,.4);">右からタップで⭐</div>`
      : priorityTasks.map(t=>`
        <div class="ptask-row" style="padding:6px 0;" onclick="toggleTaskPriority('${t.projId}','${t.id}')">
          <div class="ptask-check ${t.done?'on':''}" onclick="event.stopPropagation();toggleProjTask('${t.projId}','${t.id}')">${t.done?'✓':''}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;">${t.label}</div>
            <div style="font-size:9px;color:var(--ink-mute);">— ${t.projName}</div>
          </div>
          <span style="font-size:14px;">⭐</span>
        </div>
      `).join('');
    
    // 全タスクリスト (右) - 優先以外
    $('all-tasks-list').innerHTML = otherTasks.length === 0
      ? `<div style="font-size:10px;color:var(--ink-faint);text-align:center;padding:14px 4px;">タスクなし</div>`
      : otherTasks.map(t=>`
        <div class="ptask-row" style="padding:6px 0;" onclick="toggleTaskPriority('${t.projId}','${t.id}')">
          <div class="ptask-check" onclick="event.stopPropagation();toggleProjTask('${t.projId}','${t.id}')"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;">${t.label}</div>
            <div style="font-size:9px;color:var(--ink-mute);">— ${t.projName}</div>
          </div>
          <span style="font-size:11px;color:var(--ink-faint);">☆</span>
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
    const expanded = _expandedProjId === String(p.id);
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
        ${p.note ? `<div style="background:rgba(0,0,0,.03);border-radius:8px;padding:10px;font-size:11px;line-height:1.6;color:var(--ink-soft);margin-bottom:10px;white-space:pre-wrap;">📝 ${p.note}</div>` : ''}
        ${tasks.length === 0 ? `<div style="text-align:center;font-size:11px;color:var(--ink-mute);padding:10px;">タスクがありません</div>` :
          `<div id="ptask-sortable-${p.id}" style="touch-action:none;">${tasks.map((t,idx)=>`
            <div class="ptask-row" draggable="true" data-pid="${p.id}" data-tid="${t.id}" data-idx="${idx}" 
              ondragstart="onPTaskDragStart(event)" ondragover="onPTaskDragOver(event)" ondrop="onPTaskDrop(event)" ondragend="onPTaskDragEnd(event)"
              ontouchstart="onPTaskTouchStart(event,'${p.id}','${t.id}')" ontouchmove="onPTaskTouchMove(event)" ontouchend="onPTaskTouchEnd(event)">
              <span style="color:var(--ink-faint);font-size:14px;cursor:grab;padding:0 4px;">⋮⋮</span>
              <div class="ptask-check ${t.done?'on':''}" onclick="toggleProjTask('${p.id}','${t.id}')">${t.done?'✓':''}</div>
              <div class="ptask-label ${t.done?'done':''}" style="flex:1;">${t.label}</div>
              <button class="btn-sec" style="padding:4px 8px;border:none;font-size:11px;color:var(--ink-mute);" onclick="deleteProjTask('${p.id}','${t.id}')">×</button>
            </div>`).join('')}</div>`
        }
        <div style="display:flex;gap:6px;margin-top:10px;">
          <input class="fi" type="text" id="ptask-input-${p.id}" placeholder="タスクを追加 (Enterで追加)"
            oncompositionstart="this.dataset.composing='1'"
            oncompositionend="this.dataset.composing=''"
            onkeydown="if(event.key==='Enter'&&!this.dataset.composing){event.preventDefault();addProjTask('${p.id}')}">
          <button class="btn-sec" onclick="addProjTask('${p.id}')">＋</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button class="btn-sec" style="flex:1;" onclick="openProjectEdit('${p.id}')">編集</button>
          <button class="btn-sec" style="flex:1;" onclick="toggleProjStatus('${p.id}')">${p.status==='active'?'完了にする':'進行中に戻す'}</button>
          <button class="btn-sec" style="color:var(--ink-mute);" onclick="confirmDeleteProj('${p.id}')">削除</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
};

// 優先タスク切替
window.toggleTaskPriority = async function(pid, tid){
  const p = cache.projects.find(x=>String(x.id)===String(pid));
  if(!p) return;
  const t = (p.tasks||[]).find(x=>String(x.id)===String(tid));
  if(!t) return;
  t.priority = !t.priority;
  await saveProjectFB(p);
  renderProjects();
};

// ============= DRAG & DROP (デスクトップ) =============
let _dragPTask = null;
window.onPTaskDragStart = function(e){
  _dragPTask = { pid:e.currentTarget.dataset.pid, tid:e.currentTarget.dataset.tid };
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
};
window.onPTaskDragOver = function(e){
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};
window.onPTaskDrop = async function(e){
  e.preventDefault();
  if(!_dragPTask) return;
  const target = e.currentTarget;
  const targetPid = target.dataset.pid;
  const targetTid = target.dataset.tid;
  if(_dragPTask.pid !== targetPid) return; // 別の案件同士の並べ替えは不可
  const p = cache.projects.find(x=>String(x.id)===String(targetPid));
  if(!p || !p.tasks) return;
  const fromIdx = p.tasks.findIndex(x=>String(x.id)===String(_dragPTask.tid));
  const toIdx = p.tasks.findIndex(x=>String(x.id)===String(targetTid));
  if(fromIdx < 0 || toIdx < 0) return;
  const [moved] = p.tasks.splice(fromIdx, 1);
  p.tasks.splice(toIdx, 0, moved);
  await saveProjectFB(p);
  renderProjects();
};
window.onPTaskDragEnd = function(e){
  e.currentTarget.style.opacity = '';
  _dragPTask = null;
};

// ============= TOUCH DRAG (モバイル) =============
let _touchDrag = null;
window.onPTaskTouchStart = function(e, pid, tid){
  const target = e.currentTarget;
  // ⋮⋮ をタッチした時だけドラッグ開始
  const x = e.touches[0].clientX;
  const rect = target.getBoundingClientRect();
  if(x - rect.left > 30) return; // ハンドル以外なら無視
  _touchDrag = { pid, tid, el:target, startY:e.touches[0].clientY };
  target.style.opacity = '0.5';
};
window.onPTaskTouchMove = function(e){
  if(!_touchDrag) return;
  e.preventDefault();
  const y = e.touches[0].clientY;
  const elements = document.elementsFromPoint(e.touches[0].clientX, y);
  const target = elements.find(el => el.classList && el.classList.contains('ptask-row') && el !== _touchDrag.el && el.dataset.pid === _touchDrag.pid);
  if(target){
    _touchDrag.target = target;
    // ビジュアルフィードバック
    document.querySelectorAll('.ptask-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }
};
window.onPTaskTouchEnd = async function(e){
  if(!_touchDrag) return;
  _touchDrag.el.style.opacity = '';
  document.querySelectorAll('.ptask-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
  if(_touchDrag.target){
    const targetTid = _touchDrag.target.dataset.tid;
    const p = cache.projects.find(x=>String(x.id)===String(_touchDrag.pid));
    if(p && p.tasks){
      const fromIdx = p.tasks.findIndex(x=>String(x.id)===String(_touchDrag.tid));
      const toIdx = p.tasks.findIndex(x=>String(x.id)===String(targetTid));
      if(fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx){
        const [moved] = p.tasks.splice(fromIdx, 1);
        p.tasks.splice(toIdx, 0, moved);
        await saveProjectFB(p);
        renderProjects();
      }
    }
  }
  _touchDrag = null;
};

let _expandedProjId = null;
window.toggleProjExpand = function(id){
  _expandedProjId = _expandedProjId === String(id) ? null : String(id);
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

// 案件編集
let _editingProjId = null;
window.openProjectEdit = function(pid){
  const p = cache.projects.find(x=>String(x.id)===String(pid));
  if(!p) return;
  _editingProjId = pid;
  $('pe-name').value = p.name || '';
  $('pe-client').value = p.client || '';
  $('pe-deadline').value = p.deadline || '';
  $('pe-note').value = p.note || '';
  openModal('ov-project-edit');
};
window.saveEditedProject = async function(){
  if(!_editingProjId) return;
  const p = cache.projects.find(x=>String(x.id)===String(_editingProjId));
  if(!p) return;
  const name = $('pe-name').value.trim();
  if(!name) return alert('案件名を入力');
  p.name = name;
  p.client = $('pe-client').value.trim();
  p.deadline = $('pe-deadline').value;
  p.note = $('pe-note').value.trim();
  await saveProjectFB(p);
  closeModal('ov-project-edit');
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
  const input = document.getElementById(`ptask-input-${pid}`);
  if(!input) return;
  const label = input.value.trim();
  if(!label) return;
  if(!Array.isArray(p.tasks)) p.tasks = [];
  p.tasks.push({ id:Date.now(), label, done:false });
  await saveProjectFB(p);
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
let _progressTab = 'milestone';
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
    milestone: renderMilestoneTab,
  };
  $('progress-content').innerHTML = '';
  map[_progressTab] && map[_progressTab]();
};

function renderMilestoneTab(){
  $('progress-content').innerHTML = `
    <div class="card" style="padding:14px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;margin-bottom:10px;">
        <span style="font-size:16px;">🎯</span>年末ゴールへの進捗
      </div>
      <div id="end-of-year-progress"></div>
    </div>
    <div class="card" style="padding:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:10px;">
        <span><span style="font-size:14px;">📅</span> 月別マイルストーン</span>
        <span style="font-size:9px;color:var(--ink-mute);font-weight:400;">タップで編集</span>
      </div>
      <div id="milestone-list"></div>
    </div>`;
  renderEndOfYearProgress();
  renderMilestones();
}

function renderMilestones(){
  if(!$('milestone-list')) return;
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
        <input class="fi" id="prod-input" placeholder="例: シーン1のラフカット完成 (Enterで追加)" style="flex:1;"
          oncompositionstart="this.dataset.composing='1'"
          oncompositionend="this.dataset.composing=''"
          onkeydown="if(event.key==='Enter'&&!this.dataset.composing){event.preventDefault();addProductionTask()}">
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
  const cls = 'hero-amber';
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
};
window.calMonth = function(delta){
  _calMonth += delta;
  if(_calMonth < 0){ _calMonth = 11; _calYear--; }
  if(_calMonth > 11){ _calMonth = 0; _calYear++; }
  renderCalendar();
};
window.renderCalendar = function(){
  if(_calTab === 'google') return;
  $('cal-year').textContent = `— ${_calYear} —`;
  $('cal-mtxt').textContent = `${_calMonth+1}月`;
  
  const wd = ['日','月','火','水','木','金','土'];
  $('cal-week').innerHTML = wd.map((d,i)=>`<div class="cal-wd ${i===0?'sun':''} ${i===6?'sat':''}">${d}</div>`).join('');
  
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
  const remaining = (w - cache.settings.targetWeight);
  const yearEnd = new Date(new Date().getFullYear(), 11, 31);
  const daysLeft = Math.ceil((yearEnd - new Date())/(86400000));
  const weeksLeft = Math.max(daysLeft / 7, 0.1);
  const weeklyPace = remaining / weeksLeft;
  
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
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:8px;">
        <span>変化: ${change > 0 ? '+' : ''}${change}kg</span>
        <span>残り: ${remaining.toFixed(1)}kg</span>
      </div>
      ${remaining > 0 ? `<div style="background:rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;font-size:12px;text-align:center;">📅 12月末まで <span style="font-weight:700;">週 ${weeklyPace.toFixed(2)}kg</span> ペースで減量</div>` : ''}
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

// ============= FOOD MENU =============
const FOOD_CATS = [
  { key:'main', label:'主食', icon:'🍱' },
  { key:'snack', label:'間食', icon:'🍪' },
  { key:'drink', label:'飲物', icon:'🥤' },
];
let _foodCat = 'main';
function renderFoodTab(){
  const items = cache.foodMenus.filter(i=>i.category===_foodCat);
  $('ideal-content').innerHTML = `
    <div class="subtab-wrap" style="grid-template-columns:repeat(3,1fr);">
      ${FOOD_CATS.map(c=>`<button class="subtab ${_foodCat===c.key?'on':''}" onclick="setFoodCat('${c.key}')">${c.icon} ${c.label}</button>`).join('')}
    </div>
    <div class="card">
      <div class="sec-h" style="display:flex;justify-content:space-between;">
        <div><span class="sec-h-icon">${FOOD_CATS.find(c=>c.key===_foodCat).icon}</span>${FOOD_CATS.find(c=>c.key===_foodCat).label}</div>
        <button class="btn-sec" style="padding:6px 12px;" onclick="openFoodAdd()">＋ 追加</button>
      </div>
      ${items.length===0 ? `<div class="empty-state"><div class="em-ico">📷</div><div>まだ登録がありません</div></div>` :
        `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">${items.map(it=>`
          <div style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden;background:#fff;">
            <div style="aspect-ratio:1;background:#f0f0f0;position:relative;cursor:pointer;" onclick="viewImg('${it.imageData||''}')">
              ${it.imageData ? `<img src="${it.imageData}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ink-mute);font-size:32px;">🍱</div>`}
              <button onclick="event.stopPropagation();deleteFood('${it.id}')" style="position:absolute;top:4px;right:4px;width:22px;height:22px;background:rgba(255,255,255,.85);border:none;border-radius:50%;color:var(--ink-soft);font-size:11px;cursor:pointer;">×</button>
            </div>
            <div style="padding:8px;font-size:12px;font-weight:600;">${it.name}</div>
          </div>
        `).join('')}</div>`
      }
    </div>
  `;
}
window.setFoodCat = function(c){ _foodCat=c; renderFoodTab(); };

let _newFoodData = null;
window.openFoodAdd = function(){
  _newFoodData = null;
  $('food-name').value = '';
  $('food-save-btn').disabled = false;
  $('food-upload-zone').innerHTML = `<label class="upload-box"><input type="file" accept="image/*" onchange="onFoodFile(event)"><div style="font-size:24px;margin-bottom:8px;">📷</div><div style="font-size:11px;">写真を選ぶ (任意)</div></label>`;
  openModal('ov-food-add');
};
window.onFoodFile = async function(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  $('food-upload-zone').innerHTML = `<div class="empty-state" style="padding:60px 20px;"><div class="em-ico">○</div><div>変換中…</div></div>`;
  try{
    _newFoodData = await compressImage(f, 1200, 0.8);
    $('food-upload-zone').innerHTML = `<div class="upload-preview"><img src="${_newFoodData}"><button class="del" onclick="resetFoodUpload()">×</button></div>`;
  } catch(err){ alert('画像処理失敗: '+err.message); }
};
window.resetFoodUpload = function(){
  _newFoodData = null;
  $('food-upload-zone').innerHTML = `<label class="upload-box"><input type="file" accept="image/*" onchange="onFoodFile(event)"><div style="font-size:24px;margin-bottom:8px;">📷</div><div style="font-size:11px;">写真を選ぶ (任意)</div></label>`;
};
window.saveFoodItem = async function(){
  const name = $('food-name').value.trim();
  if(!name) return alert('名前を入力');
  const item = { id:Date.now(), category:_foodCat, name, imageData:_newFoodData || '' };
  cache.foodMenus.push(item);
  await window.setDocImport('foodMenus', item);
  closeModal('ov-food-add');
  renderFoodTab();
};
window.deleteFood = async function(id){
  if(!confirm('削除しますか?')) return;
  cache.foodMenus = cache.foodMenus.filter(x=>String(x.id)!==String(id));
  await window.deleteDocImport('foodMenus', id);
  renderFoodTab();
};

// ============= WARDROBE =============
const WD_CATS = [
  { key:'outer', label:'アウター', icon:'🧥' },
  { key:'top', label:'上着', icon:'👕' },
  { key:'bottom', label:'ズボン', icon:'👖' },
  { key:'socks', label:'靴下', icon:'🧦' },
  { key:'accessory', label:'服飾', icon:'👜' },
];
let _wdCat = 'outer';
function renderWardrobeTab(){
  const items = cache.wardrobe.filter(i=>i.category===_wdCat);
  $('ideal-content').innerHTML = `
    <div class="subtab-wrap" style="grid-template-columns:repeat(5,1fr);">
      ${WD_CATS.map(c=>`<button class="subtab ${_wdCat===c.key?'on':''}" onclick="setWdCat('${c.key}')" style="font-size:10px;padding:8px 2px;line-height:1.3;">${c.icon}<br>${c.label}</button>`).join('')}
    </div>
    <div class="card">
      <div class="sec-h" style="display:flex;justify-content:space-between;">
        <div><span class="sec-h-icon">${WD_CATS.find(c=>c.key===_wdCat).icon}</span>${WD_CATS.find(c=>c.key===_wdCat).label}</div>
        <button class="btn-sec" style="padding:6px 12px;" onclick="openWdAdd()">＋ 追加</button>
      </div>
      ${items.length===0 ? `<div class="empty-state"><div class="em-ico">📷</div><div>まだ登録がありません</div></div>` :
        `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">${items.map(it=>`
          <div style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden;background:#fff;">
            <div style="aspect-ratio:1;background:#f0f0f0;position:relative;cursor:pointer;" onclick="viewImg('${it.imageData||''}')">
              ${it.imageData ? `<img src="${it.imageData}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ink-mute);font-size:32px;">👕</div>`}
              <button onclick="event.stopPropagation();deleteWd('${it.id}')" style="position:absolute;top:4px;right:4px;width:22px;height:22px;background:rgba(255,255,255,.85);border:none;border-radius:50%;color:var(--ink-soft);font-size:11px;cursor:pointer;">×</button>
            </div>
            <div style="padding:8px;">
              <div style="font-size:12px;font-weight:600;">${it.name}</div>
              ${it.brand ? `<div style="font-size:10px;color:var(--ink-mute);margin-top:2px;">${it.brand}</div>` : ''}
            </div>
          </div>
        `).join('')}</div>`
      }
    </div>
  `;
}
window.setWdCat = function(c){ _wdCat=c; renderWardrobeTab(); };

let _newWdData = null;
window.openWdAdd = function(){
  _newWdData = null;
  $('wd-name').value = '';
  $('wd-brand').value = '';
  $('wd-save-btn').disabled = false;
  $('wd-upload-zone').innerHTML = `<label class="upload-box"><input type="file" accept="image/*" onchange="onWdFile(event)"><div style="font-size:24px;margin-bottom:8px;">📷</div><div style="font-size:11px;">写真を選ぶ (任意)</div></label>`;
  openModal('ov-wardrobe-add');
};
window.onWdFile = async function(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  $('wd-upload-zone').innerHTML = `<div class="empty-state" style="padding:60px 20px;"><div class="em-ico">○</div><div>変換中…</div></div>`;
  try{
    _newWdData = await compressImage(f, 1200, 0.8);
    $('wd-upload-zone').innerHTML = `<div class="upload-preview"><img src="${_newWdData}"><button class="del" onclick="resetWdUpload()">×</button></div>`;
  } catch(err){ alert('画像処理失敗: '+err.message); }
};
window.resetWdUpload = function(){
  _newWdData = null;
  $('wd-upload-zone').innerHTML = `<label class="upload-box"><input type="file" accept="image/*" onchange="onWdFile(event)"><div style="font-size:24px;margin-bottom:8px;">📷</div><div style="font-size:11px;">写真を選ぶ (任意)</div></label>`;
};
window.saveWardrobeItem = async function(){
  const name = $('wd-name').value.trim();
  if(!name) return alert('名前を入力');
  const item = { id:Date.now(), category:_wdCat, name, brand:$('wd-brand').value.trim(), imageData:_newWdData || '' };
  cache.wardrobe.push(item);
  await window.setDocImport('wardrobe', item);
  closeModal('ov-wardrobe-add');
  renderWardrobeTab();
};
window.deleteWd = async function(id){
  if(!confirm('削除しますか?')) return;
  cache.wardrobe = cache.wardrobe.filter(x=>String(x.id)!==String(id));
  await window.deleteDocImport('wardrobe', id);
  renderWardrobeTab();
};
window.viewImg = function(src){
  if(!src) return;
  $('img-view-src').src = src;
  openModal('ov-image-view');
};

// ============= INSPIRATION =============
function renderInspiration(){
  if(cache.motivations.length === 0){
    $('inspiration-content').innerHTML = '<div class="empty-state" style="padding:18px 20px;"><div class="em-ico">📷</div><div style="font-size:11px;">＋から理想の画像を追加</div></div>';
    return;
  }
  $('inspiration-content').innerHTML = `<div class="insp-grid">${cache.motivations.map(m=>`
    <div class="insp-item" 
      onclick="onInspClick('${m.id}')"
      oncontextmenu="event.preventDefault();onInspLongPress('${m.id}')"
      ontouchstart="startInspLongPress(event,'${m.id}')"
      ontouchend="cancelInspLongPress()"
      ontouchmove="cancelInspLongPress()">
      <img src="${m.imageData||m.url||''}" alt="${m.credit||''}" draggable="false">
    </div>
  `).join('')}</div>`;
}
let _inspLongPressTimer = null;
let _longPressInspId = null;
let _activeInspId = null;
window.startInspLongPress = function(e, id){
  _longPressInspId = id;
  if(_inspLongPressTimer) clearTimeout(_inspLongPressTimer);
  _inspLongPressTimer = setTimeout(()=>{
    onInspLongPress(id);
    _longPressInspId = null;
  }, 500);
};
window.cancelInspLongPress = function(){
  if(_inspLongPressTimer){ clearTimeout(_inspLongPressTimer); _inspLongPressTimer = null; }
};
window.onInspClick = function(id){
  // 長押し中なら通常クリックを無視
  if(!_longPressInspId) return;
  // 通常タップは拡大表示
  viewInspiration(id);
};
window.onInspLongPress = function(id){
  cancelInspLongPress();
  _activeInspId = id;
  _longPressInspId = null;
  openModal('ov-insp-menu');
};
window.changeInspirationImage = function(){
  closeModal('ov-insp-menu');
  // ファイル選択 → 画像差し替え
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      const data = await compressImage(f, 1200, 0.8);
      const m = cache.motivations.find(x=>String(x.id)===String(_activeInspId));
      if(!m) return;
      m.imageData = data;
      await saveMotivationFB(m);
      renderInspiration();
    } catch(err){ alert('画像処理失敗: '+err.message); }
  };
  input.click();
};
window.deleteInspirationFromMenu = async function(){
  closeModal('ov-insp-menu');
  if(!_activeInspId) return;
  if(!confirm('画像を削除しますか?')) return;
  cache.motivations = cache.motivations.filter(m=>String(m.id)!==String(_activeInspId));
  await deleteMotivationFB(_activeInspId);
  _activeInspId = null;
  renderInspiration();
};
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
  
  const btn = $('settings-save-btn');
  btn.textContent = '✓ 保存しました';
  btn.disabled = true;
  setTimeout(()=>{ btn.textContent = '保存'; btn.disabled = false; }, 1800);
  
  renderAll();
};

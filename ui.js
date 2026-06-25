// ============= 強制アップデート（確実に最新を取り直す） =============
window.forceUpdate = async function(){
  const btn = document.getElementById('app-version');
  if(btn) btn.textContent = '更新中…';
  // Service Worker を全解除（あれば）
  try {
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
  } catch(e){}
  // Cache Storage を全削除（あれば）
  try {
    if(window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  } catch(e){}
  // 一意なクエリでHTTPキャッシュを確実に回避して読み込み直す
  const base = location.href.split('#')[0].split('?')[0];
  location.replace(base + '?u=' + Date.now());
};

// 入力欄のEnterで追加する共通ハンドラ。IME変換確定のEnterは無視する（端末差を吸収）
window.markCompose = function(el, on){
  if(on){ el.dataset.composing = '1'; }
  else { el.dataset.composing = ''; el.dataset.composeEnd = String(Date.now()); }
};
window.handleEnterAdd = function(event, el, cb){
  if(event.key !== 'Enter') return;
  // 変換中・IME処理中・確定直後(250ms)はEnterを無視
  if(event.isComposing || event.keyCode === 229 || el.dataset.composing === '1') return;
  if(el.dataset.composeEnd && (Date.now() - Number(el.dataset.composeEnd)) < 250) return;
  event.preventDefault();
  cb();
};

// ============= UI RENDER =============

// 現在の到達目標（中間目標が未来かつ有効なら中間、無ければ最終=12月末）
function activeGoal(){
  const s = cache.settings || {};
  const today = new Date(getTodayDateString()+'T00:00');
  if(s.interimDate && s.interimWeight!=null){
    const id = new Date(s.interimDate+'T00:00');
    if(!isNaN(id.getTime()) && id > today){
      return { weight: s.interimWeight, dateObj: id, label: `${id.getMonth()+1}/${id.getDate()}`, isInterim:true };
    }
  }
  const ye = new Date((new Date()).getFullYear(), 11, 31);
  return { weight: s.targetWeight, dateObj: ye, label: '12月末', isInterim:false };
}
window.activeGoal = activeGoal;

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

// ============= スケジュール計算・描画（昼/夜・日付共通） =============
function nightRawFor(modeKey){
  const light = ['recovery','rest','trip_work','trip_private'].includes(modeKey);
  return light ? [
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
}
// 内容（ラベル）から合いそうな絵文字を推定。該当が無ければ fallback を返す
const ICON_RULES = [
  [['起床','目覚','wake'],'☀️'],
  [['カーテン'],'🪟'],
  [['水分','給水','ハイドレ'],'💧'],
  [['スキンケア','洗顔','化粧水','保湿'],'🧴'],
  [['朝食','朝ごはん','モーニング'],'🥣'],
  [['昼食','ランチ','昼ごはん'],'🍱'],
  [['夕食','夜ごはん','晩ごはん','ディナー'],'🍽️'],
  [['食事','ごはん','食べ','ランチ'],'🍽️'],
  [['散歩','ウォーキング'],'🚶'],
  [['ランニング','ジョギング','走'],'🏃'],
  [['ジム','筋トレ','トレーニング','運動','ワークアウト'],'💪'],
  [['撮影','ロケ','収録'],'🎥'],
  [['編集','カット編集','テロップ'],'✂️'],
  [['動画','youtube','ユーチューブ','投稿','アップ','ショート'],'🎬'],
  [['自主制作','制作'],'🎬'],
  [['会議','打ち合わせ','打合せ','ミーティング','商談'],'🤝'],
  [['電話','コール'],'📞'],
  [['メール','返信','連絡'],'📧'],
  [['ikea','買い物','買物','ショッピング','スーパー','購入','受け取り','受取'],'🛒'],
  [['組み立て','組立','diy','工作'],'🔧'],
  [['掃除','片付','清掃'],'🧹'],
  [['洗濯'],'🧺'],
  [['ゴミ','ごみ','粗大'],'🗑️'],
  [['税理士','経理','確定申告','請求','振込','支払','入金','銀行','納税'],'🧾'],
  [['美容院','床屋','散髪'],'💇'],
  [['脱毛','エステ'],'✨'],
  [['病院','通院','診察','歯医者','クリニック'],'🏥'],
  [['薬','服薬','サプリ'],'💊'],
  [['シャワー','入浴','風呂','バス'],'🛁'],
  [['歯磨き','歯みがき','ハミガキ'],'🪥'],
  [['ボディケア','ストレッチ','マッサージ','ケア'],'🧴'],
  [['読書','読む'],'📖'],
  [['勉強','学習','研究'],'📚'],
  [['ゲーム'],'🎮'],
  [['休憩','リラックス','のんびり','自由時間'],'☕'],
  [['カフェ','珈琲','コーヒー'],'☕'],
  [['睡眠','就寝','寝る','眠','ベッドへ'],'😴'],
  [['ベッド'],'🛏️'],
  [['デスク','机'],'🪑'],
  [['棚','収納'],'🗄️'],
  [['移動','出発','向か','電車'],'🚃'],
  [['準備','支度'],'🎒'],
  [['振り返り','記録','日記','ログ','メモ'],'📝'],
];
function guessIcon(label, fallback){
  if(!label) return fallback;
  const s = String(label).toLowerCase();
  for(const [keys, emoji] of ICON_RULES){
    if(keys.some(k => s.includes(k.toLowerCase()))) return emoji;
  }
  return fallback;
}
// その日のスケジュール終了時刻(分・その日0時起点)。深夜(24:00=1440以上)タスクがあれば
// 最後のタスク+15分、無ければ1440(=翌0時)。getTodayDateStringの日付切替判定に使う。
window.scheduleLateEndMinutes = function(date){
  try {
    const all = [...computeDayTasks(date), ...computeNightTasks(date)];
    let maxT = -1;
    for(const t of all){ const v = parseTime(t.time); if(v!==null && v>maxT) maxT = v; }
    return (maxT >= 1440) ? (maxT + 15) : 1440;
  } catch(e){ return 1440; }
};
// 時刻(HH:MM)で昇順ソート。時刻として解釈できないものは末尾へ（安定ソート）
function sortByTime(arr){
  return arr.sort((a,b)=>{
    const av = parseTime(a.time), bv = parseTime(b.time);
    return (av===null?Infinity:av) - (bv===null?Infinity:bv);
  });
}
// 起床シフトを適用（特殊表記・深夜24:00以上はそのまま）
function shiftTaskTime(time, shiftMin){
  const v = parseTime(time);
  if(v === null || v >= 1440) return time; // 自然起床等/深夜タスクは固定
  return adjustTime(time, shiftMin);
}
function computeDayTasks(date){
  const modeKey = cache.dayModes[date] || 'normal';
  const shiftMin = getShiftMin(date, modeKey);
  const overrides = cache.taskOverrides[date] || {};
  const hidden = cache.taskHidden[date] || [];
  const modeTasks = (MODE_TASKS[modeKey] || [])
    .filter(t => !hidden.includes(t.key))
    .map(t => {
      const ov = overrides[t.key];
      // 上書きの時刻も基準(未シフト)値として保存しているので、表示時に起床シフトを適用
      // （名称変更だけしても時間連動が維持される）。アイコンは保存値優先→内容推定→元
      if(ov) return {...t, time: shiftTaskTime(ov.time, shiftMin), label: ov.label, icon: ov.icon || guessIcon(ov.label, t.icon), edited:true};
      return {...t, time: adjustTime(t.time, shiftMin)};
    });
  // 追加(カスタム)タスクも起床シフトに連動させる
  const customs = (cache.customTasks[date] || []).map(t => ({key:`custom_${t.id}`, time: shiftTaskTime(t.time, shiftMin), label:t.label, icon: t.icon || guessIcon(t.label,'⭐'), custom:true, id:t.id}));
  return sortByTime([...modeTasks, ...customs]);
}
function computeNightTasks(date){
  const modeKey = cache.dayModes[date] || 'normal';
  const shiftMin = getShiftMin(date, modeKey);
  const overrides = cache.nightOverrides[date] || {};
  const hidden = cache.nightHidden[date] || [];
  const nightTasks = nightRawFor(modeKey)
    .filter(t => !hidden.includes(t.key))
    .map(t => {
      const ov = overrides[t.key];
      if(ov) return {...t, time: shiftTaskTime(ov.time, shiftMin), label: ov.label, icon: ov.icon || guessIcon(ov.label, t.icon), edited:true};
      return {...t, time: adjustTime(t.time, shiftMin)};
    });
  // 追加(カスタム)の寝る前タスクも起床シフトに連動
  const customs = ((cache.nightCustom||{})[date] || []).map(t => ({key:`custom_${t.id}`, time: shiftTaskTime(t.time, shiftMin), label:t.label, icon: t.icon || guessIcon(t.label,'🌙'), custom:true, id:t.id}));
  return sortByTime([...nightTasks, ...customs]);
}
// 1行のHTML（section: 'day' | 'night'）。date を各操作に引き渡す
function taskRowHtml(date, t, section){
  const checkMap = section==='night' ? cache.nightChecks : cache.todayChecks;
  const checked = checkMap[`${date}_${t.key}`];
  const editFn  = section==='night' ? 'openEditNightTask' : 'openEditTask';
  const delFn   = section==='night' ? 'deleteNightTask'   : 'deleteTask';
  const checkFn = section==='night' ? 'onNightCheckClick'  : 'onTodayCheckClick';
  const rowCls  = 'task-row' + (section==='night' ? ' night-row'+(checked?' on':'') : '');
  return `<div class="${rowCls}">
    <div class="task-main" onclick="${editFn}('${date}','${t.key}')">
      <div class="task-time">${t.time||'—'}</div>
      <div class="task-icon">${t.icon}</div>
      <div class="task-label ${checked?'done':''}">${t.label}</div>
    </div>
    <button class="task-del" onclick="event.stopPropagation();${delFn}('${date}','${t.key}')">×</button>
    <div class="task-check ${checked?'on':''}" onclick="event.stopPropagation();${checkFn}('${date}','${t.key}')">${checked?'✓':''}</div>
  </div>`;
}
// カスタム追加フォーム（任意の日付向け・入力idを分離）
function customAddFormHtml(date, timeId, labelId){
  return `<div style="margin-top:8px;display:flex;gap:6px;">
    <input type="time" class="fi" id="${timeId}" style="flex:0 0 100px;">
    <input type="text" class="fi" id="${labelId}" placeholder="タスク追加" style="flex:1;">
    <button class="btn-sec" onclick="addCustomTaskInput('${date}','${timeId}','${labelId}')">＋</button>
  </div>`;
}
// 変更後の再描画（ホーム＋開いていれば日別モーダル）
function afterScheduleChange(){
  if(window.renderToday) renderToday();
  const dd = $('ov-daydetail');
  if(dd && dd.classList && dd.classList.contains('on') && typeof renderDayDetailBody==='function') renderDayDetailBody();
}

// ===== 通知用: 今後7日分の予定をFirestoreの1ドキュメントに公開（GASが読む） =====
let _notifySyncTimer = null;
function scheduleNotifySync(){
  if(_notifySyncTimer) clearTimeout(_notifySyncTimer);
  _notifySyncTimer = setTimeout(()=>{ if(window.syncNotifySchedule) syncNotifySchedule(); }, 1500);
}
window.syncNotifySchedule = async function(){
  if(typeof saveNotifyDoc !== 'function') return;
  try {
    const s = cache.settings || {};
    const leadMin = (s.notifyLeadMin!=null ? Number(s.notifyLeadMin) : 5);
    const base = getTodayDateString();
    const baseD = new Date(base+'T00:00');
    const days = {};
    const sends = []; // GASが送るだけで済むよう「送信時刻(絶対)」まで計算して渡す
    for(let i=0;i<7;i++){
      const d = new Date(baseD); d.setDate(d.getDate()+i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const list = [...computeDayTasks(ds), ...computeNightTasks(ds)]
        .filter(t => parseTime(t.time) !== null);   // 時刻として読めるものだけ
      days[ds] = list.map(t => ({ t: t.time, l: t.label })); // 旧GAS互換のため残す
      const midMs = new Date(ds+'T00:00:00').getTime(); // その日0時(端末ローカル=JST)の絶対時刻
      for(const t of list){
        const tmin = parseTime(t.time);                 // 24:00以上(深夜)もそのまま分換算
        const fireMs = midMs + (tmin - leadMin)*60000;  // 送信(=タスク−リード)の絶対時刻
        sends.push({ m: Math.floor(fireMs/60000), title: t.label, time: t.time });
      }
    }
    const payload = {
      enabled: !!s.notifyEnabled,
      email: s.notifyEmail || '',
      leadMin,
      tz: 'Asia/Tokyo',
      sends,   // ★これだけ見れば送れる（GASは時刻判定不要・恒久的に変更不要）
      days,    // 後方互換（旧GAS用）
      updatedAt: Date.now(),
    };
    await saveNotifyDoc(payload);
  } catch(e){ console.warn('notify sync失敗', e); }
};

// ============= TODAY PAGE =============
window.renderToday = function(){
  const today = getTodayDateString();
  const modeKey = cache.dayModes[today] || 'normal';
  const mode = MODES[modeKey];
  
  $('mode-card').className = 'mode-card ' + mode.cls;
  $('mode-ico').textContent = mode.icon;
  $('mode-name').textContent = mode.label;
  $('mode-desc').textContent = mode.desc;
  
  // 起床欄を編集中(フォーカス中)は値を書き戻さない（ピッカー操作の妨害＝中間値確定を防ぐ）
  const wi = $('wake-input');
  if(wi && document.activeElement !== wi) wi.value = cache.wakeTimes[today] || '';

  const dayTasks = computeDayTasks(today);
  $('task-list').innerHTML = dayTasks.length === 0
    ? '<div class="empty-state"><div class="em-ico">○</div><div style="font-size:11px;">タスクが設定されていません</div></div>'
    : dayTasks.map(t => taskRowHtml(today, t, 'day')).join('');

  const nightTasks = computeNightTasks(today);
  $('night-list').innerHTML = nightTasks.map(t => taskRowHtml(today, t, 'night')).join('');
  const nightDone = nightTasks.filter(t=>cache.nightChecks[`${today}_${t.key}`]).length;
  $('night-count').textContent = `${nightDone}/${nightTasks.length}`;

  scheduleNotifySync(); // スケジュール変更を通知用ドキュメントへ反映（デバウンス）
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
window.onTodayCheckClick = async function(date, key){
  await toggleTodayCheck(`${date}_${key}`);
  afterScheduleChange();
};
window.onNightCheckClick = async function(date, key){
  await toggleNightCheck(`${date}_${key}`);
  afterScheduleChange();
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
// カスタムタスク追加（任意の日付・入力id指定）
window.addCustomTaskInput = async function(date, timeId, labelId){
  const entered = $(timeId).value;
  const label = $(labelId).value.trim();
  if(!label) return;
  // 入力した時刻がそのまま表示になるよう、現在の起床シフト分だけ戻して基準で保存する
  // （今起きた後に追加しても入力時刻のまま表示。起床を後で変えれば一緒に動く）
  const modeKey = cache.dayModes[date] || 'normal';
  const shiftMin = getShiftMin(date, modeKey);
  const time = shiftTaskTime(entered, -shiftMin);
  const tasks = [...(cache.customTasks[date]||[])];
  tasks.push({ id:Date.now(), time, label });
  await saveCustomTasksFB(date, tasks);
  $(timeId).value = '';
  $(labelId).value = '';
  afterScheduleChange();
};
// ホーム（今日）の追加ボタン用
window.addCustomTask = function(){ return addCustomTaskInput(getTodayDateString(), 'custom-task-time', 'custom-task-label'); };
// 寝る前ルーティンへのタスク追加
window.addNightCustomTaskInput = async function(date, timeId, labelId){
  const entered = $(timeId).value;
  const label = $(labelId).value.trim();
  if(!label) return;
  const modeKey = cache.dayModes[date] || 'normal';
  const shiftMin = getShiftMin(date, modeKey);
  const time = shiftTaskTime(entered, -shiftMin);
  const tasks = [...(cache.nightCustom[date]||[])];
  tasks.push({ id:Date.now(), time, label });
  await saveNightCustomFB(date, tasks);
  $(timeId).value = '';
  $(labelId).value = '';
  afterScheduleChange();
};
window.addNightTask = function(){ return addNightCustomTaskInput(getTodayDateString(), 'night-task-time', 'night-task-label'); };
// 明日のスケジュールを組む（日別モーダルをスケジュールタブで開く）
window.openTomorrow = function(){
  const base = getTodayDateString();
  const d = new Date(base+'T00:00'); d.setDate(d.getDate()+1);
  const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  openDayDetail(ds);
  setDayDetailTab('schedule');
};
// ============= 確認ダイアログ =============
window.confirmDialog = function(msg, onOk){
  $('cf-msg').textContent = msg;
  const btn = $('cf-ok');
  btn.onclick = async ()=>{ closeModal('ov-confirm'); await onOk(); };
  openModal('ov-confirm');
};

// 編集対象の日付（モーダルが開いている間保持）
let _editDate = null;
let _iconManual = false; // アイコン欄をユーザーが手動変更したか
let _origTime = '';      // 編集前の時刻（特殊表記の保持用）

// "10:00"等→time入力用(HH:MM)。読めなければ空（自然起床/随時/〜24:30 など）
function toTimeInput(s){
  const m = (s||'').match(/^(\d{1,2}):(\d{2})/);
  return m ? (String(m[1]).padStart(2,'0') + ':' + m[2]) : '';
}
// 時刻文字列を time入力＋深夜チェックに展開（24:00以上は 0〜5時表示＋チェックON）
function setTimeFields(s){
  const v = parseTime(s);
  const ln = $('te-latenight');
  if(v !== null && v >= 1440){
    const h = Math.floor(v/60) - 24;   // 25 → 1
    const mn = v % 60;
    $('te-time').value = String(h).padStart(2,'0') + ':' + String(mn).padStart(2,'0');
    if(ln) ln.checked = true;
  } else {
    $('te-time').value = toTimeInput(s);
    if(ln) ln.checked = false;
  }
}
// time入力＋深夜チェック＋元の値 から保存する時刻を決定
function resolveEditTime(){
  let picked = ($('te-time').value || '').trim();
  if(picked){
    const ln = $('te-latenight');
    if(ln && ln.checked){
      const m = picked.match(/^(\d{1,2}):(\d{2})/);
      if(m) picked = (Number(m[1]) + 24) + ':' + m[2];   // 1:30 → 25:30
    }
    return picked;
  }
  if(_origTime && parseTime(_origTime) === null) return _origTime; // 元が特殊表記→保持
  return '';                                                  // 時刻なし
}

// 内容入力中: 手動変更がなければアイコンを内容から自動更新
window.onEditLabelInput = function(){
  if(_iconManual) return;
  const label = $('te-label').value;
  $('te-icon').value = guessIcon(label, $('te-icon').value || '');
};
window.onEditIconInput = function(){ _iconManual = true; };

// ============= 昼スケジュールの編集 =============
window.openEditTask = function(date, key){
  const t = computeDayTasks(date).find(x=>x.key===key);
  if(!t) return;
  _editDate = date;
  _iconManual = false;
  _origTime = t.time || '';
  $('te-key').value = key;
  setTimeFields(t.time);
  $('te-label').value = t.label || '';
  $('te-icon').value = t.icon || '';
  // モードタスクで上書き済みのものだけ「デフォルトに戻す」を表示
  $('te-reset-btn').style.display = (!t.custom && t.edited) ? 'block' : 'none';
  openModal('ov-task-edit');
};
window.saveTaskEdit = async function(){
  const raw = $('te-key').value;
  const label = $('te-label').value.trim();
  if(!label) return alert('内容を入力してください');
  const icon = ($('te-icon').value || '').trim() || guessIcon(label, '⭐');
  const date = _editDate || getTodayDateString();
  // モーダルは「表示中(シフト後)の時刻」で編集する。保存は基準(未シフト)値に戻す
  // → これで名称変更だけしても起床シフト連動が維持される（二重シフトも防ぐ）
  const modeKey = cache.dayModes[date] || 'normal';
  const shiftMin = getShiftMin(date, modeKey);
  const time = shiftTaskTime(resolveEditTime(), -shiftMin);
  if(raw.startsWith('night:')){
    const key = raw.slice('night:'.length);
    if(key.startsWith('custom_')){
      const id = Number(key.slice('custom_'.length));
      const tasks = (cache.nightCustom[date]||[]).map(x => x.id===id ? {...x, time, label, icon} : x);
      await saveNightCustomFB(date, tasks);
    } else {
      cache.nightOverrides[date] = {...(cache.nightOverrides[date]||{}), [key]:{time,label,icon}};
      await saveOverridesFB(date);
    }
  } else if(raw.startsWith('custom_')){
    const id = Number(raw.slice('custom_'.length));
    const tasks = (cache.customTasks[date]||[]).map(x => x.id===id ? {...x, time, label, icon} : x);
    await saveCustomTasksFB(date, tasks);
  } else {
    cache.taskOverrides[date] = {...(cache.taskOverrides[date]||{}), [raw]:{time,label,icon}};
    await saveOverridesFB(date);
  }
  closeModal('ov-task-edit');
  afterScheduleChange();
};
window.resetTaskEdit = async function(){
  const raw = $('te-key').value;
  const date = _editDate || getTodayDateString();
  if(raw.startsWith('night:')){
    const key = raw.slice('night:'.length);
    if(cache.nightOverrides[date]){ delete cache.nightOverrides[date][key]; }
  } else {
    if(cache.taskOverrides[date]){ delete cache.taskOverrides[date][raw]; }
  }
  await saveOverridesFB(date);
  closeModal('ov-task-edit');
  afterScheduleChange();
};
window.deleteTask = function(date, key){
  const t = computeDayTasks(date).find(x=>x.key===key);
  confirmDialog(`「${t ? t.label : 'このタスク'}」を削除しますか？`, ()=> doDeleteTask(date, key));
};
async function doDeleteTask(date, key){
  if(key.startsWith('custom_')){
    const id = Number(key.slice('custom_'.length));
    const tasks = (cache.customTasks[date]||[]).filter(t=>t.id!==id);
    await saveCustomTasksFB(date, tasks);
  } else {
    // モード（フォーマット）タスクは当日分を非表示にする
    const list = [...(cache.taskHidden[date]||[])];
    if(!list.includes(key)) list.push(key);
    cache.taskHidden[date] = list;
    if(cache.taskOverrides[date]) delete cache.taskOverrides[date][key];
    await saveOverridesFB(date);
  }
  afterScheduleChange();
}

// ============= 夜ルーティンの編集 =============
window.openEditNightTask = function(date, key){
  const t = computeNightTasks(date).find(x=>x.key===key);
  if(!t) return;
  _editDate = date;
  _iconManual = false;
  _origTime = t.time || '';
  $('te-key').value = 'night:' + key;
  setTimeFields(t.time);
  $('te-label').value = t.label || '';
  $('te-icon').value = t.icon || '';
  $('te-reset-btn').style.display = (!t.custom && t.edited) ? 'block' : 'none';
  openModal('ov-task-edit');
};
window.deleteNightTask = function(date, key){
  const t = computeNightTasks(date).find(x=>x.key===key);
  confirmDialog(`「${t ? t.label : 'このタスク'}」を削除しますか？`, ()=> doDeleteNightTask(date, key));
};
async function doDeleteNightTask(date, key){
  if(key.startsWith('custom_')){
    const id = Number(key.slice('custom_'.length));
    const tasks = (cache.nightCustom[date]||[]).filter(t=>t.id!==id);
    await saveNightCustomFB(date, tasks);
  } else {
    const list = [...(cache.nightHidden[date]||[])];
    if(!list.includes(key)) list.push(key);
    cache.nightHidden[date] = list;
    if(cache.nightOverrides[date]) delete cache.nightOverrides[date][key];
    await saveOverridesFB(date);
  }
  afterScheduleChange();
}

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
  // 優先タスクは保存済みの並び順(priorityOrder)で表示。新規は末尾、消えた分は除去
  const prioKey = t => `${t.projId}_${t.id}`;
  {
    const curKeys = priorityTasks.map(prioKey);
    let order = (cache.settings.priorityOrder || []).filter(k => curKeys.includes(k));
    for(const k of curKeys){ if(!order.includes(k)) order.push(k); }
    cache.settings.priorityOrder = order;
    priorityTasks.sort((a,b)=> order.indexOf(prioKey(a)) - order.indexOf(prioKey(b)));
  }
  
  $('proj-active-count').textContent = active.length;
  $('proj-task-count').textContent = allOpenTasks.length;
  
  if(allOpenTasks.length > 0){
    $('all-tasks-card').style.display = '';
    $('all-tasks-count').textContent = otherTasks.length + '件';
    
    // 優先タスクリスト (左)
    $('priority-tasks-list').innerHTML = priorityTasks.length === 0
      ? `<div style="font-size:10px;color:var(--ink-faint);text-align:center;padding:14px 4px;background:rgba(244,166,181,.08);border-radius:8px;border:1px dashed rgba(244,166,181,.4);">右からタップで⭐</div>`
      : priorityTasks.map(t=>`
        <div class="ptask-row prio-row" style="padding:6px 0;" data-key="${t.projId}_${t.id}" draggable="true"
          ondragstart="onPrioDragStart(event)" ondragover="onPrioDragOver(event)" ondrop="onPrioDrop(event)" ondragend="onPrioDragEnd(event)"
          ontouchstart="onPrioTouchStart(event)" ontouchmove="onPrioTouchMove(event)" ontouchend="onPrioTouchEnd(event)">
          <span style="color:var(--ink-faint);font-size:14px;cursor:grab;padding:0 4px;flex-shrink:0;">⋮⋮</span>
          <div class="ptask-check ${t.done?'on':''}" onclick="event.stopPropagation();toggleProjTask('${t.projId}','${t.id}')">${t.done?'✓':''}</div>
          <div style="flex:1;min-width:0;" onclick="toggleTaskPriority('${t.projId}','${t.id}')">
            <div style="font-size:12px;font-weight:600;">${t.label}</div>
            <div style="font-size:9px;color:var(--ink-mute);">— ${t.projName}</div>
          </div>
          <span style="font-size:14px;" onclick="toggleTaskPriority('${t.projId}','${t.id}')">⭐</span>
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
            oncompositionstart="markCompose(this,true)"
            oncompositionend="markCompose(this,false)"
            onkeydown="handleEnterAdd(event,this,()=>addProjTask('${p.id}'))">
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

// ============= 優先タスクの並び替え（案件横断・priorityOrderに保存） =============
async function movePriority(fromKey, toKey){
  if(!fromKey || !toKey || fromKey === toKey) return;
  const order = [...(cache.settings.priorityOrder || [])];
  const fi = order.indexOf(fromKey);
  if(fi < 0) return;
  const [moved] = order.splice(fi, 1);
  const ti = order.indexOf(toKey);
  if(ti < 0){ order.push(moved); } else { order.splice(ti, 0, moved); }
  cache.settings.priorityOrder = order;
  await saveAllSettings();
  renderProjects();
}
// デスクトップ
let _dragPrio = null;
window.onPrioDragStart = function(e){ _dragPrio = e.currentTarget.dataset.key; e.currentTarget.style.opacity='0.4'; e.dataTransfer.effectAllowed='move'; };
window.onPrioDragOver = function(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; };
window.onPrioDrop = async function(e){ e.preventDefault(); if(!_dragPrio) return; await movePriority(_dragPrio, e.currentTarget.dataset.key); };
window.onPrioDragEnd = function(e){ e.currentTarget.style.opacity=''; _dragPrio=null; };
// モバイル（⋮⋮ ハンドルから）
let _touchPrio = null;
window.onPrioTouchStart = function(e){
  const target = e.currentTarget;
  const x = e.touches[0].clientX;
  const rect = target.getBoundingClientRect();
  if(x - rect.left > 30) return; // ハンドル以外は無視（タップは⭐解除に使う）
  _touchPrio = { key:target.dataset.key, el:target };
  target.style.opacity='0.5';
};
window.onPrioTouchMove = function(e){
  if(!_touchPrio) return;
  e.preventDefault();
  const els = document.elementsFromPoint(e.touches[0].clientX, e.touches[0].clientY);
  const target = els.find(el => el.classList && el.classList.contains('prio-row') && el !== _touchPrio.el && el.dataset.key);
  if(target){
    _touchPrio.target = target;
    document.querySelectorAll('.prio-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }
};
window.onPrioTouchEnd = async function(e){
  if(!_touchPrio) return;
  _touchPrio.el.style.opacity='';
  document.querySelectorAll('.prio-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
  const fromKey = _touchPrio.key, t = _touchPrio.target;
  _touchPrio = null;
  if(t) await movePriority(fromKey, t.dataset.key);
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
          oncompositionstart="markCompose(this,true)"
          oncompositionend="markCompose(this,false)"
          onkeydown="handleEnterAdd(event,this,()=>addProductionTask())">
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
  
  const wd = ['月','火','水','木','金','土','日']; // 月曜始まり
  $('cal-week').innerHTML = wd.map((d,i)=>`<div class="cal-wd ${i===6?'sun':''} ${i===5?'sat':''}">${d}</div>`).join('');
  
  const first = new Date(_calYear, _calMonth, 1);
  const last = new Date(_calYear, _calMonth+1, 0);
  const daysInMonth = last.getDate();
  const firstDay = first.getDay();
  const today = getTodayDateString();
  const todayDate = new Date(today + 'T00:00');
  
  // 日付→体重 のマップ（カレンダーに小さく表示）
  const wmap = {};
  cache.weights.forEach(e=>{ wmap[e.date] = e.weight; });

  let cells = '';
  const lead = (firstDay + 6) % 7; // 月曜始まりの先頭空セル数（日曜=6個）
  for(let i=0; i<lead; i++) cells += `<div class="cal-cell empty"></div>`;
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
    const wt = wmap[dateStr];
    const ran = (cache.activities[dateStr]||[]).some(a=>a==='run30'||a==='run60');
    const lifted = !!cache.workouts[dateStr];
    const exEmoji = (ran?'🏃':'') + (lifted?'🏋️':'');
    cells += `<div class="${cls.join(' ')}" onclick="openDayDetail('${dateStr}')">
      <div class="cal-cell-day">${d}</div>
      ${mode ? `<div class="cal-cell-icon">${mode.icon}</div>` : ''}
      ${exEmoji ? `<div class="cal-cell-ex">${exEmoji}</div>` : ''}
      ${wt!==undefined ? `<div class="cal-cell-wt">${wt.toFixed(1)}</div>` : ''}
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
    const date = _ddDate;
    // 起床予定の入力(ピッカー)は作り直さない。タスク部分だけ別コンテナ(#dd-sch-tasks)に描画する
    $('dd-body').innerHTML = `
      <div class="wake-input-row" style="margin-bottom:6px;">
        <span style="font-size:14px;">☀️</span>
        <span style="font-size:11px;color:var(--ink-soft);font-weight:600;">起床予定</span>
        <input type="time" class="fi" id="dd-wake-input" value="${cache.wakeTimes[date]||''}" onchange="onDDWakeChange()">
        <button onclick="clearDDWake()" style="background:none;border:none;color:var(--ink-mute);font-size:11px;cursor:pointer;flex-shrink:0;padding:0 4px;">クリア</button>
      </div>
      <div style="font-size:9px;color:var(--ink-mute);margin:0 0 8px 2px;">起床予定を決めると全タスクの時間が連動してずれます</div>
      <button class="btn-sec" style="width:100%;font-size:11px;color:var(--ink-mute);margin-bottom:10px;" onclick="resetDayEdits('${date}')">↺ 時間の編集をリセット（起床に合わせ直す）</button>
      <div id="dd-sch-tasks"></div>`;
    renderDDScheduleTasks(date);
  }
}
// 日別モーダルのタスク部分だけ描画（起床ピッカーは触らない）
function renderDDScheduleTasks(date){
  const el = $('dd-sch-tasks');
  if(!el) return;
  const dayTasks = computeDayTasks(date);
  const nightTasks = computeNightTasks(date);
  const done = dayTasks.filter(t=>cache.todayChecks[`${date}_${t.key}`]).length;
  el.innerHTML = `
    <div style="font-size:10px;letter-spacing:.2em;color:var(--ink-mute);margin-bottom:8px;">— 昼のタイムライン — ${done}/${dayTasks.length}</div>
    ${dayTasks.length === 0
      ? '<div class="empty-state"><div class="em-ico">○</div><div style="font-size:11px;">タスクなし</div></div>'
      : dayTasks.map(t=>taskRowHtml(date, t, 'day')).join('')}
    ${customAddFormHtml(date, 'dd-custom-time', 'dd-custom-label')}
    <div style="font-size:10px;letter-spacing:.2em;color:var(--ink-mute);margin:18px 0 8px;">— 寝る前ルーティン —</div>
    ${nightTasks.length === 0
      ? '<div class="empty-state"><div class="em-ico">○</div><div style="font-size:11px;">タスクなし</div></div>'
      : nightTasks.map(t=>taskRowHtml(date, t, 'night')).join('')}
    <div style="margin-top:8px;display:flex;gap:6px;">
      <input type="time" class="fi" id="dd-night-time" style="flex:0 0 100px;">
      <input type="text" class="fi" id="dd-night-label" placeholder="タスク追加" style="flex:1;">
      <button class="btn-sec" onclick="addNightCustomTaskInput('${date}','dd-night-time','dd-night-label')">＋</button>
    </div>`;
}
// 日別モーダルの起床予定（変更で全タスクが連動。ピッカーは作り直さずタスクだけ更新）
window.onDDWakeChange = async function(){
  if(!_ddDate) return;
  const val = $('dd-wake-input').value;
  await saveWakeTime(_ddDate, val);
  const w = $('dd-wake'); if(w) w.textContent = val || '—';
  renderDDScheduleTasks(_ddDate);
  if(window.scheduleNotifySync) scheduleNotifySync();
};
window.clearDDWake = async function(){
  if(!_ddDate) return;
  await saveWakeTime(_ddDate, '');
  const inp = $('dd-wake-input'); if(inp) inp.value = '';
  const w = $('dd-wake'); if(w) w.textContent = '—';
  renderDDScheduleTasks(_ddDate);
  if(window.scheduleNotifySync) scheduleNotifySync();
};
// その日の上書きの「時刻」だけテンプレに戻し、起床予定に合わせ直す（名前/アイコンの変更は維持）
window.resetDayEdits = function(date){
  confirmDialog('フォーマットタスクの「時刻」を起床予定に合わせ直しますか？\n（名前やアイコンの変更・追加タスク・削除はそのまま残ります）', ()=> doResetDayEdits(date));
};
async function doResetDayEdits(date){
  const modeKey = cache.dayModes[date] || 'normal';
  const fix = (ovs, tmpl)=>{
    if(!ovs) return;
    for(const k of Object.keys(ovs)){
      const t = tmpl.find(x=>x.key===k);
      if(t) ovs[k] = {...ovs[k], time: t.time}; // 時刻だけテンプレ基準に戻す（名称/アイコン維持）
      else delete ovs[k];
    }
  };
  fix(cache.taskOverrides[date], MODE_TASKS[modeKey] || []);
  fix(cache.nightOverrides[date], nightRawFor(modeKey));
  await saveOverridesFB(date);
  afterScheduleChange();
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
  renderInspiration();
};

// 体重推移の折れ線グラフ（SVG）。記録2件以上で描画
// 週1kgペースの理想体重ライン（9/15を中間目標71.5kgとする）
const GOAL_PACE = [
  ['2026-07-02', 82.2],
  ['2026-07-09', 81.2],
  ['2026-07-16', 80.2],
  ['2026-07-23', 79.2],
  ['2026-07-30', 78.2],
  ['2026-08-06', 77.2],
  ['2026-08-13', 76.2],
  ['2026-08-20', 75.2],
  ['2026-08-27', 74.2],
  ['2026-09-03', 73.2],
  ['2026-09-10', 72.2],
  ['2026-09-15', 71.5],
];
function weightChartSvg(){
  const data = cache.weights.slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-60);
  if(data.length < 2) return '';
  const W=320, H=150, padL=34, padR=14, padTop=16, padBot=24;
  const dnum = s => new Date(s+'T00:00').getTime()/86400000; // 日単位の数値
  const mmdd = s => { const p=s.split('-'); return `${+p[1]}/${+p[2]}`; }; // 2026-06-25→6/25
  const actPts = data.map(d=>({x:dnum(d.date), w:d.weight, date:d.date}));
  const goalPts = GOAL_PACE.map(([d,w])=>({x:dnum(d), w, date:d}));
  const target = cache.settings.targetWeight;
  // Y軸レンジ（実測・理想ペース・最終目標を内包し、上下に少し余白）
  const allW = [...actPts.map(p=>p.w), ...goalPts.map(p=>p.w), target];
  const dataMin = Math.min(...allW), dataMax = Math.max(...allW);
  const padV = Math.max((dataMax - dataMin) * 0.10, 0.3);
  const min = dataMin - padV, max = dataMax + padV, rng = max - min;
  // X軸レンジ（実測と理想ペースの全期間を日付で内包）
  const allX = [...actPts.map(p=>p.x), ...goalPts.map(p=>p.x)];
  const xmin = Math.min(...allX), xmax = Math.max(...allX);
  const xrng = (xmax - xmin) || 1;
  const X = x => padL + (W - padL - padR) * ((x - xmin)/xrng);
  const Y = v => padTop + (H - padTop - padBot) * (1 - (v - min)/rng);
  // Y軸グリッド＋kg数値（上・中）
  const midV = (dataMax + dataMin) / 2;
  const grid = [dataMax, midV].map(v=>`
    <line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${W-padR}" y2="${Y(v).toFixed(1)}" stroke="#eceef1" stroke-width="1"/>
    <text x="${(padL-4).toFixed(1)}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end" font-size="9" fill="#aab0b8">${v.toFixed(1)}</text>`).join('');
  // 実測の塗り＋線
  const actLine = actPts.map(p=>`${X(p.x).toFixed(1)},${Y(p.w).toFixed(1)}`).join(' ');
  const x0 = X(actPts[0].x).toFixed(1), xN = X(actPts[actPts.length-1].x).toFixed(1);
  const area = `${x0},${(H-padBot).toFixed(1)} ${actLine} ${xN},${(H-padBot).toFixed(1)}`;
  const goalLine = goalPts.map(p=>`${X(p.x).toFixed(1)},${Y(p.w).toFixed(1)}`).join(' ');
  const tY = Y(target);
  const first = actPts[0], last = actPts[actPts.length-1];
  const g0 = goalPts[0], gN = goalPts[goalPts.length-1];
  // 実測ドット（最初と最新は体重を数値表示）
  const dots = actPts.map((p,i)=>{
    const isEnd = i===actPts.length-1, isStart = i===0;
    const lbl = (isEnd||isStart) ? `<text x="${X(p.x).toFixed(1)}" y="${(Y(p.w)-7).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#DE6E87">${p.w.toFixed(1)}</text>` : '';
    return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.w).toFixed(1)}" r="${isEnd?3.2:2.2}" fill="#DE6E87"/>${lbl}`;
  }).join('');
  // X軸 日付ラベル（最初の実測・最新の実測・9/15）
  const xlabels = [
    {x:first.x, t:mmdd(first.date), a:'start'},
    {x:last.x, t:mmdd(last.date), a:'middle'},
    {x:gN.x, t:mmdd(gN.date), a:'end'},
  ].map(L=>`<text x="${X(L.x).toFixed(1)}" y="${H-7}" text-anchor="${L.a}" font-size="9" fill="#9aa0a8">${L.t}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-bottom:10px;overflow:visible;">
    <defs><linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E88FA1" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#E88FA1" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <line x1="${padL}" y1="${tY.toFixed(1)}" x2="${W-padR}" y2="${tY.toFixed(1)}" stroke="#c7cad0" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${(padL-4).toFixed(1)}" y="${(tY+3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9aa0a8">${target}</text>
    <text x="${W-padR}" y="${(tY-3).toFixed(1)}" text-anchor="end" font-size="8" fill="#9aa0a8">最終目標</text>
    <polyline points="${goalLine}" fill="none" stroke="#6FA0DE" stroke-width="1.8" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(g0.x).toFixed(1)}" cy="${Y(g0.w).toFixed(1)}" r="2.4" fill="#6FA0DE"/>
    <circle cx="${X(gN.x).toFixed(1)}" cy="${Y(gN.w).toFixed(1)}" r="3.4" fill="#6FA0DE"/>
    <text x="${X(gN.x).toFixed(1)}" y="${(Y(gN.w)-7).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="#4F82C4">中間目標 ${gN.w}</text>
    <text x="${X(g0.x).toFixed(1)}" y="${(Y(g0.w)-5).toFixed(1)}" text-anchor="start" font-size="8" fill="#6FA0DE">理想ペース(週1kg)</text>
    <polygon points="${area}" fill="url(#wgrad)"/>
    <polyline points="${actLine}" fill="none" stroke="#DE6E87" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xlabels}
  </svg>`;
}
function renderWeightTab(){
  const latest = cache.weights.length>0 ? cache.weights[cache.weights.length-1] : null;
  const w = latest ? latest.weight : cache.settings.startWeight;
  const bf = latest && latest.bodyFat ? latest.bodyFat : null;
  const change = (w - cache.settings.startWeight).toFixed(1);
  const goal = activeGoal();
  const remaining = (w - goal.weight);
  const daysLeft = Math.max(Math.ceil((goal.dateObj - new Date())/(86400000)), 1);
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
        <span>残り(${goal.label}): ${remaining.toFixed(1)}kg</span>
      </div>
      ${remaining > 0 ? `<div style="background:rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;font-size:12px;text-align:center;">📅 ${goal.label}までに <span style="font-weight:700;">${goal.weight}kg</span>（週 ${weeklyPace.toFixed(2)}kg・あと${daysLeft}日）</div>` : `<div style="background:rgba(255,255,255,.2);border-radius:8px;padding:8px 12px;font-size:12px;text-align:center;">${goal.label}の目標達成 🎉 次は最終 ${cache.settings.targetWeight}kg へ</div>`}
    </div>
    <div class="card">
      <div class="sec-h">推移</div>
      ${weightChartSvg()}
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
  { key:'snack', label:'間食', icon:'🥚' },
  { key:'drink', label:'飲物', icon:'🥤' },
];
const MEALS = [
  { key:'breakfast', label:'朝食', icon:'🌅' },
  { key:'lunch', label:'昼食', icon:'🍴' },
  { key:'dinner', label:'夕食', icon:'🌙' },
  { key:'snack', label:'間食', icon:'🥚' },
];
// 運動による消費カロリー＋（タップで加算）
const ACTIVITIES = [
  { key:'run30', label:'30分ラン', kcal:250, icon:'🏃' },
  { key:'run60', label:'60分ラン', kcal:500, icon:'🏃‍♂️' },
  { key:'shoot', label:'撮影日', kcal:300, icon:'🎬' },
];
function activeActs(date){ return cache.activities[date] || []; }
function activityBonus(date){ const a=activeActs(date); return ACTIVITIES.reduce((s,x)=>s+(a.includes(x.key)?x.kcal:0),0); }
let _foodView = 'log';   // 'log'（今日の記録） | 'master'（食材リスト）
let _foodCat = 'main';
let _foodSearch = '';
let _pickMeal = 'breakfast';
let _pickSearch = '';
let _editFoodId = null;
let _foodSeq = 0;
let _goalEdit = false;
let _foodDate = null; // 表示中の日付（前日に戻って追記できる）
function fnum(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
function foodDate(){ if(!_foodDate) _foodDate = getTodayDateString(); return _foodDate; }
function shiftYmd(dateStr, n){ const d=new Date(dateStr+'T00:00'); d.setDate(d.getDate()+n); return ymd(d); }
function dateLabelJP(dateStr){ const d=new Date(dateStr+'T00:00'); const w=['日','月','火','水','木','金','土'][d.getDay()]; return `${d.getMonth()+1}/${d.getDate()}(${w})`; }
function todayMeals(){ return cache.meals[foodDate()] || []; }
window.shiftFoodDate = function(n){
  const next = shiftYmd(foodDate(), n);
  if(n>0 && next > getTodayDateString()) return; // 今日より先へは行かない
  _foodDate = next; renderFoodTab();
};
window.goFoodToday = function(){ _foodDate = getTodayDateString(); renderFoodTab(); };

function renderFoodTab(){
  $('ideal-content').innerHTML = `
    <div class="subtab-wrap" style="grid-template-columns:repeat(2,1fr);">
      <button class="subtab ${_foodView==='log'?'on':''}" onclick="setFoodView('log')">🍽️ 今日の記録</button>
      <button class="subtab ${_foodView==='master'?'on':''}" onclick="setFoodView('master')">📋 食材リスト</button>
    </div>
    ${_foodView==='log' ? foodLogHTML() : foodMasterHTML()}
  `;
}
window.setFoodView = function(v){ _foodView=v; renderFoodTab(); };
window.setFoodCat = function(c){ _foodCat=c; renderFoodTab(); };
// ホームから「食事を記録」→ 理想ページの食事タブ（今日の記録）へ
window.openMealLog = function(){
  _foodView = 'log';
  _foodDate = getTodayDateString(); // 常に今日から開く
  if(window.setTab) setTab('ideal');
  setIdealTab('food');
};
// ホームの朝食/昼食/夕食/間食ボタン → その食事のピッカーをワンタッチで開く（今日に記録）
window.quickMeal = function(mealKey){
  _foodView = 'log';
  _foodDate = getTodayDateString();
  openFoodPick(mealKey);
};

// ---- 今日の記録 ----
function foodLogHTML(){
  const entries = todayMeals();
  const sum = (k)=> entries.reduce((a,e)=>a+fnum(e[k]),0);
  const kcal = Math.round(sum('kcal'));
  const carbs = sum('carbs'), fat = sum('fat'), protein = sum('protein');
  const target = fnum(cache.settings.targetCalories);
  const basal = fnum(cache.settings.basalMetabolism);
  const tp = fnum(cache.settings.targetProtein);
  const proteinMet = tp>0 && protein>=tp;
  const remaining = target - kcal;
  const date = foodDate();
  const isToday = date === getTodayDateString();
  const actBonus = activityBonus(date);    // 運動による消費＋
  const burn = basal + actBonus;            // その日の総消費
  const deficit = burn - kcal;              // 赤字 = 総消費 − 摂取
  const targetBurn = fnum(cache.settings.targetBurn) || 2700;   // 目標消費
  const targetDeficit = Math.max(targetBurn - target, 0);       // 理想の赤字(=2700-1700=1000)
  const defPct = targetDeficit>0 ? Math.max(0, Math.min(deficit/targetDeficit*100, 100)) : 0;
  const pct = target>0 ? Math.min(kcal/target*100, 100) : 0;
  const over = target>0 && kcal>target;
  const acts = activeActs(date);
  const ml = fnum(cache.water[date]);
  const wMin = fnum(cache.settings.waterMinMl)||2500, wMax = fnum(cache.settings.waterMaxMl)||3000;
  const wpct = wMax>0 ? Math.min(ml/wMax*100, 100) : 0;
  const wMet = ml>=wMin;
  const ws = weekStats(date);
  const wpw = fnum(cache.settings.workoutPerWeek)||2;
  const rpw = fnum(cache.settings.runningPerWeek)||4;
  const restTarget = fnum(cache.settings.restPerWeek)||3;
  const doneToday = !!cache.workouts[date];
  let html = `
  <div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;">
    <button class="btn-sec" style="padding:8px 12px;" onclick="shiftFoodDate(-1)">← 前日</button>
    <div style="text-align:center;font-size:14px;font-weight:700;">${dateLabelJP(date)}${isToday?' <span style="font-size:11px;color:var(--pink);">今日</span>':`<button class="btn-sec" style="padding:3px 8px;font-size:10px;margin-left:6px;" onclick="goFoodToday()">今日へ</button>`}</div>
    <button class="btn-sec" style="padding:8px 12px;${isToday?'opacity:.35;':''}" onclick="shiftFoodDate(1)">翌日 →</button>
  </div>
  <div class="hero-card hero-blue">
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;">${isToday?'今日':dateLabelJP(date)}の摂取カロリー</div>
    <div style="display:flex;align-items:baseline;gap:6px;">
      <div style="font-size:34px;font-weight:700;line-height:1;">${kcal}</div>
      <div style="font-size:13px;opacity:.9;">/ ${target||'—'} kcal</div>
    </div>
    <div style="height:10px;background:rgba(255,255,255,.25);border-radius:6px;overflow:hidden;margin:10px 0 8px;">
      <div style="height:100%;width:${pct.toFixed(0)}%;background:${over?'#FFB4B4':'#fff'};border-radius:6px;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;">
      <span>${remaining>=0 ? `あと ${Math.round(remaining)} kcal` : `${Math.round(-remaining)} kcal オーバー`}</span>
      <span style="opacity:.9;">目標 ${target||'—'}</span>
    </div>
    ${basal>0 ? `<div style="background:#fff;border:2px solid #FF5A5A;border-radius:10px;padding:10px 12px;margin-top:10px;color:var(--ink);">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;font-weight:700;margin-bottom:6px;">
        <span style="color:#E53935;">🔻 今日の赤字</span>
        <span style="color:#9aa0a8;"><span style="font-weight:800;font-size:18px;color:#E53935;">${deficit>=0?'−':'+'}${Math.abs(Math.round(deficit))}</span> / 目標 −${targetDeficit} kcal</span>
      </div>
      <div style="height:9px;background:#f1d6d6;border-radius:5px;overflow:hidden;margin-bottom:6px;">
        <div style="height:100%;width:${defPct.toFixed(0)}%;background:${deficit>=targetDeficit?'#E53935':'#FF8A80'};border-radius:5px;transition:width .2s;"></div>
      </div>
      <div style="font-size:11px;color:var(--ink-soft);text-align:center;line-height:1.5;">消費 ${burn}（基礎${basal}${actBonus?`+運動${actBonus}`:''}）− 摂取 ${kcal}<br>${burn<targetBurn ? `目標消費 ${targetBurn} まで運動であと <b style="color:#E53935;">${targetBurn-burn}</b> kcal` : `目標消費 ${targetBurn} 達成 🎉`}${deficit>=targetDeficit?' ・ <b style="color:#E53935;">赤字目標クリア✓</b>':''}</div>
    </div>` : ''}
    <div style="display:flex;gap:6px;margin-top:10px;">
      <div style="flex:1;background:rgba(255,255,255,.18);border-radius:8px;padding:6px;text-align:center;">
        <div style="font-size:10px;opacity:.85;">糖質</div>
        <div style="font-size:14px;font-weight:700;">${carbs.toFixed(1)}<span style="font-size:9px;">g</span></div>
      </div>
      <div style="flex:1;background:rgba(255,255,255,.18);border-radius:8px;padding:6px;text-align:center;">
        <div style="font-size:10px;opacity:.85;">脂質</div>
        <div style="font-size:14px;font-weight:700;">${fat.toFixed(1)}<span style="font-size:9px;">g</span></div>
      </div>
      <div style="flex:1;background:${proteinMet?'rgba(130,235,170,.4)':'rgba(255,255,255,.18)'};border-radius:8px;padding:6px;text-align:center;">
        <div style="font-size:10px;opacity:.85;">タンパク質${proteinMet?' ✓':''}</div>
        <div style="font-size:14px;font-weight:700;">${protein.toFixed(0)}<span style="font-size:9px;">/${tp||'—'}g</span></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="sec-h" style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:13px;">📌 今日の目標</div>
      <button class="btn-sec" style="padding:6px 12px;font-size:12px;" onclick="toggleGoalEdit()">${_goalEdit?'閉じる':'⚙️ 編集'}</button>
    </div>
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:6px;">
        <span>💧 水分 ${wMet?'<span style="color:#3FA7D6;">✓</span>':''}</span>
        <span>${(ml/1000).toFixed(2)} / ${(wMin/1000).toFixed(1)}〜${(wMax/1000).toFixed(1)}L</span>
      </div>
      <div style="height:8px;background:#eef1f3;border-radius:5px;overflow:hidden;margin-bottom:8px;"><div style="height:100%;width:${wpct.toFixed(0)}%;background:#5BB7E8;border-radius:5px;transition:width .2s;"></div></div>
      <div style="display:flex;gap:6px;">
        <button class="btn-sec" style="flex:1;padding:9px;" onclick="addWater(200)">＋コップ 200</button>
        <button class="btn-sec" style="flex:1;padding:9px;" onclick="addWater(500)">＋ボトル 500</button>
        <button class="btn-sec" style="padding:9px 14px;" onclick="addWater(-200)">−</button>
      </div>
    </div>
    <div style="border-top:1px solid var(--bdr);padding-top:12px;margin-top:14px;${_goalEdit?'margin-bottom:14px;':''}">
      <div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:14px;">
        <div><div style="font-size:10px;color:var(--ink-soft);">🏃 ランニング</div><div style="font-size:16px;font-weight:700;${ws.run>=rpw?'color:#37a76a;':''}">${ws.run}<span style="font-size:10px;color:var(--ink-soft);font-weight:600;">/${rpw}回</span></div></div>
        <div><div style="font-size:10px;color:var(--ink-soft);">🏋️ 筋トレ</div><div style="font-size:16px;font-weight:700;${ws.wo>=wpw?'color:#37a76a;':''}">${ws.wo}<span style="font-size:10px;color:var(--ink-soft);font-weight:600;">/${wpw}回</span></div></div>
        <div><div style="font-size:10px;color:var(--ink-soft);">😴 休養</div><div style="font-size:16px;font-weight:700;">${ws.rest}<span style="font-size:10px;color:var(--ink-soft);font-weight:600;">/${restTarget}日</span></div></div>
      </div>
      <div style="font-size:12px;font-weight:600;margin-bottom:8px;">🔥 今日の消費＋（運動・撮影）${actBonus?` <span style="color:#FF7043;">＋${actBonus}kcal</span>`:''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${ACTIVITIES.map(a=>{ const on=acts.includes(a.key);
          return `<button class="btn-sec" style="flex:1;min-width:84px;padding:9px 4px;font-size:12px;${on?'background:#FF8A65;color:#fff;':''}" onclick="toggleActivity('${a.key}')">${on?'✓ ':''}${a.icon}${a.label}<br>+${a.kcal}</button>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;color:var(--ink-soft);">🏋️ 筋トレ（記録のみ・消費に加算なし）</div>
        <button class="btn-sec" style="padding:8px 14px;${doneToday?'background:var(--pink);color:#fff;':''}" onclick="toggleWorkout()">${doneToday?'✓ 今日やった':'今日やった？'}</button>
      </div>
    </div>
    ${_goalEdit ? `
    <div style="border-top:1px solid var(--bdr);padding-top:12px;">
      <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;">
        <div style="flex:1;"><label class="fl">目標摂取kcal</label><input class="fi no-spinner" type="number" inputmode="numeric" id="cal-target" placeholder="kcal" value="${cache.settings.targetCalories!=null?cache.settings.targetCalories:''}"></div>
        <div style="flex:1;"><label class="fl">目標消費kcal</label><input class="fi no-spinner" type="number" inputmode="numeric" id="cal-burn" placeholder="kcal" value="${cache.settings.targetBurn!=null?cache.settings.targetBurn:''}"></div>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end;">
        <div style="flex:1;"><label class="fl">基礎代謝kcal</label><input class="fi no-spinner" type="number" inputmode="numeric" id="cal-basal" placeholder="kcal" value="${cache.settings.basalMetabolism!=null?cache.settings.basalMetabolism:''}"></div>
        <div style="flex:1;"><label class="fl">P目標(g)</label><input class="fi no-spinner" type="number" inputmode="numeric" id="cal-protein" placeholder="g" value="${cache.settings.targetProtein!=null?cache.settings.targetProtein:''}"></div>
        <button class="btn-sec" style="padding:0 14px;height:42px;" onclick="saveCalTargets()">保存</button>
      </div>
    </div>` : ''}
  </div>`;
  html += MEALS.map(m=>{
    const es = entries.filter(e=>e.meal===m.key);
    const mk = Math.round(es.reduce((a,e)=>a+fnum(e.kcal),0));
    return `<div class="card">
      <div class="sec-h" style="display:flex;justify-content:space-between;align-items:center;">
        <div><span class="sec-h-icon">${m.icon}</span>${m.label}${es.length? ` <span style="font-size:12px;color:var(--ink-soft);font-weight:600;">${mk} kcal</span>`:''}</div>
        <button class="btn-sec" style="padding:6px 12px;" onclick="openFoodPick('${m.key}')">＋ 追加</button>
      </div>
      ${es.length===0 ? `<div style="font-size:12px;color:var(--ink-mute);padding:4px 0;">まだ記録がありません</div>` :
        es.map(e=>`<div class="ptask-row" style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;"><div style="font-size:13px;font-weight:600;">${e.name}</div>
          <div style="font-size:10.5px;color:var(--ink-soft);">糖${fnum(e.carbs)}g 脂${fnum(e.fat)}g P${fnum(e.protein)}g</div></div>
          <div style="font-size:12px;color:var(--ink-soft);white-space:nowrap;">${Math.round(fnum(e.kcal))}kcal</div>
          <button onclick="removeMealEntry('${e.id}')" style="width:24px;height:24px;border:none;background:#f3f3f3;border-radius:50%;color:var(--ink-soft);cursor:pointer;flex:none;">×</button>
        </div>`).join('')}
    </div>`;
  }).join('');
  return html;
}
window.saveCalTargets = async function(){
  cache.settings.targetCalories = fnum($('cal-target').value);
  if($('cal-burn')) cache.settings.targetBurn = fnum($('cal-burn').value);
  cache.settings.targetProtein = fnum($('cal-protein').value);
  await window.saveSetting('basalMetabolism', fnum($('cal-basal').value)); // 1回の書き込みでまとめて保存
  _goalEdit = false;
  renderFoodTab();
};
window.toggleGoalEdit = function(){ _goalEdit = !_goalEdit; renderFoodTab(); };
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// 今週(月〜日)の運動集計：ランニング日数・筋トレ日数・休養日数（休養は経過日のみ）
function weekStats(refDate){
  const t = new Date((refDate||getTodayDateString())+'T00:00');
  const dow = (t.getDay()+6)%7; // 月曜=0
  const mon = new Date(t); mon.setDate(t.getDate()-dow);
  const elapsed = dow+1; // 月曜〜今日(含む)
  let run=0, wo=0, active=0;
  for(let i=0;i<7;i++){
    const d=new Date(mon); d.setDate(mon.getDate()+i); const k=ymd(d);
    const hasRun = (cache.activities[k]||[]).some(a=>a==='run30'||a==='run60');
    const hasWo = !!cache.workouts[k];
    if(hasRun) run++;
    if(hasWo) wo++;
    if(i<elapsed && (hasRun||hasWo)) active++;
  }
  return { run, wo, rest: Math.max(0, elapsed - active) };
}
window.addWater = async function(ml){
  const date = foodDate();
  cache.water[date] = Math.max(0, (cache.water[date]||0) + ml);
  await window.saveWaterFB(date);
  renderFoodTab();
};
window.toggleWorkout = async function(){
  const date = foodDate();
  if(cache.workouts[date]) delete cache.workouts[date]; else cache.workouts[date] = true;
  await window.toggleWorkoutFB(date);
  renderFoodTab();
};
window.toggleActivity = async function(key){
  const date = foodDate();
  let a = cache.activities[date] || [];
  a = a.includes(key) ? a.filter(k=>k!==key) : [...a, key];
  cache.activities[date] = a;
  await window.saveActivitiesFB(date);
  renderFoodTab();
};

// ---- 食材リスト（マスタ） ----
function foodMasterListHTML(){
  const q = (_foodSearch||'').trim();
  let items = cache.foodMenus.filter(i=>i.category===_foodCat);
  if(q) items = items.filter(i=>(i.name||'').includes(q));
  if(items.length===0) return `<div class="empty-state"><div class="em-ico">🍽️</div><div>${q?'該当する食材がありません':'まだ登録がありません'}</div></div>`;
  return items.map(it=>`<div class="ptask-row" style="display:flex;align-items:center;gap:8px;">
    <div style="flex:1;cursor:pointer;" onclick="openFoodEdit('${it.id}')">
      <div style="font-size:14px;font-weight:600;">${it.name}</div>
      <div style="font-size:11px;color:var(--ink-soft);">${Math.round(fnum(it.kcal))}kcal ・ 糖${fnum(it.carbs)}g 脂${fnum(it.fat)}g P${fnum(it.protein)}g</div>
    </div>
    <button onclick="deleteFood('${it.id}')" style="width:24px;height:24px;border:none;background:#f3f3f3;border-radius:50%;color:var(--ink-soft);cursor:pointer;">×</button>
  </div>`).join('');
}
function renderFoodMasterList(){ const el=$('food-master-list'); if(el) el.innerHTML = foodMasterListHTML(); }
window.onFoodSearch = function(v){ _foodSearch=v; renderFoodMasterList(); };
function foodMasterHTML(){
  const cat = FOOD_CATS.find(c=>c.key===_foodCat);
  return `
    <div class="subtab-wrap" style="grid-template-columns:repeat(3,1fr);">
      ${FOOD_CATS.map(c=>`<button class="subtab ${_foodCat===c.key?'on':''}" onclick="setFoodCat('${c.key}')">${c.icon} ${c.label}</button>`).join('')}
    </div>
    <div class="card">
      <input class="fi" type="text" id="food-search" placeholder="🔍 名称で検索" value="${(_foodSearch||'').replace(/"/g,'&quot;')}" oninput="onFoodSearch(this.value)">
      <div class="sec-h" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
        <div><span class="sec-h-icon">${cat.icon}</span>${cat.label}</div>
        <button class="btn-sec" style="padding:6px 12px;" onclick="openFoodAdd()">＋ 追加</button>
      </div>
      <div id="food-master-list">${foodMasterListHTML()}</div>
    </div>`;
}

window.openFoodAdd = function(){
  _editFoodId = null;
  $('food-modal-title').textContent = '食材を追加';
  $('food-cat').value = (_foodView==='master') ? _foodCat : 'main';
  $('food-name').value=''; $('food-kcal').value=''; $('food-carbs').value=''; $('food-fat').value=''; $('food-protein').value='';
  openModal('ov-food-add');
};
window.openFoodEdit = function(id){
  const it = cache.foodMenus.find(x=>String(x.id)===String(id));
  if(!it) return;
  _editFoodId = it.id;
  $('food-modal-title').textContent = '食材を編集';
  $('food-cat').value = it.category || 'main';
  $('food-name').value = it.name || '';
  $('food-kcal').value = it.kcal!=null ? it.kcal : '';
  $('food-carbs').value = it.carbs!=null ? it.carbs : '';
  $('food-fat').value = it.fat!=null ? it.fat : '';
  $('food-protein').value = it.protein!=null ? it.protein : '';
  openModal('ov-food-add');
};
window.saveFoodItem = async function(){
  const name = $('food-name').value.trim();
  if(!name) return alert('名称を入力してください');
  const data = {
    category: $('food-cat').value,
    name,
    kcal: fnum($('food-kcal').value),
    carbs: fnum($('food-carbs').value),
    fat: fnum($('food-fat').value),
    protein: fnum($('food-protein').value),
  };
  if(_editFoodId!=null){
    data.id = _editFoodId;
    const idx = cache.foodMenus.findIndex(x=>String(x.id)===String(_editFoodId));
    if(idx>=0) cache.foodMenus[idx] = { ...cache.foodMenus[idx], ...data };
  } else {
    data.id = Date.now()*1000 + (_foodSeq++ % 1000); // 連続追加でもID衝突しないように
    cache.foodMenus.push(data);
  }
  await window.setDocImport('foodMenus', data);
  closeModal('ov-food-add');
  if($('ov-food-pick') && $('ov-food-pick').classList.contains('on')) renderFoodPickList();
  renderFoodTab();
};
window.deleteFood = async function(id){
  if(!confirm('この食材を削除しますか？')) return;
  cache.foodMenus = cache.foodMenus.filter(x=>String(x.id)!==String(id));
  await window.deleteDocImport('foodMenus', id);
  renderFoodTab();
};

// ---- 食べたものを記録（ピッカー） ----
window.openFoodPick = function(mealKey){
  _pickMeal = mealKey; _pickSearch = '';
  const m = MEALS.find(x=>x.key===mealKey);
  $('foodpick-title').textContent = `${m.icon} ${m.label}に追加`;
  $('foodpick-search').value = '';
  renderFoodPickList();
  openModal('ov-food-pick');
};
window.onFoodPickSearch = function(v){ _pickSearch=v; renderFoodPickList(); };
function renderFoodPickList(){
  const q = (_pickSearch||'').trim();
  const date = foodDate();
  // この食事に追加済みのもの
  const mine = (cache.meals[date]||[]).filter(e=>e.meal===_pickMeal);
  const mineKcal = Math.round(mine.reduce((a,e)=>a+fnum(e.kcal),0));
  const countOf = (id)=> mine.filter(e=>String(e.foodId)===String(id)).length;
  const m = MEALS.find(x=>x.key===_pickMeal) || {label:''};
  const addedHtml = mine.length ? `
    <div style="background:#FFF4F6;border:1px solid #F3C9D2;border-radius:10px;padding:9px 11px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:#C2566B;margin-bottom:5px;">✓ ${m.label}に追加済み ${mine.length}件　計 ${mineKcal}kcal</div>
      ${mine.map(e=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
        <div style="flex:1;font-size:12px;font-weight:600;">${e.name}</div>
        <div style="font-size:11px;color:var(--ink-soft);">${Math.round(fnum(e.kcal))}kcal</div>
        <button onclick="removeMealEntry('${e.id}')" style="width:20px;height:20px;border:none;background:#fff;border-radius:50%;color:var(--ink-soft);cursor:pointer;font-size:11px;line-height:1;">×</button>
      </div>`).join('')}
    </div>` : '';
  let items = cache.foodMenus.slice();
  if(q) items = items.filter(i=>(i.name||'').includes(q));
  const listHtml = FOOD_CATS.map(c=>{
    const list = items.filter(i=>i.category===c.key);
    if(list.length===0) return '';
    return `<div style="font-size:11px;font-weight:700;color:var(--ink-soft);margin:10px 0 4px;">${c.icon} ${c.label}</div>`+
      list.map(it=>{ const n=countOf(it.id);
        return `<div class="ptask-row" style="display:flex;align-items:center;gap:8px;cursor:pointer;${n>0?'background:rgba(244,166,181,.08);':''}" onclick="addMealEntry('${it.id}')">
        <div style="flex:1;"><div style="font-size:13px;font-weight:600;">${it.name}</div>
        <div style="font-size:11px;color:var(--ink-soft);">${Math.round(fnum(it.kcal))}kcal ・ 糖${fnum(it.carbs)}g 脂${fnum(it.fat)}g</div></div>
        ${n>0?`<div style="font-size:11px;font-weight:700;color:#fff;background:var(--pink);border-radius:10px;padding:2px 8px;">×${n}</div>`:''}
        <div style="font-size:20px;color:var(--pink);font-weight:700;line-height:1;">＋</div>
      </div>`;
      }).join('');
  }).join('');
  const el = $('foodpick-list');
  if(el) el.innerHTML = addedHtml + (listHtml || `<div class="empty-state"><div class="em-ico">🔍</div><div>該当する食材がありません</div><div style="font-size:11px;margin-top:4px;color:var(--ink-mute);">下のボタンから新規登録できます</div></div>`);
}
function refreshPickIfOpen(){ const m=$('ov-food-pick'); if(m && m.classList && m.classList.contains('on')) renderFoodPickList(); }
window.addMealEntry = async function(foodId){
  const it = cache.foodMenus.find(x=>String(x.id)===String(foodId));
  if(!it) return;
  const date = foodDate();
  if(!cache.meals[date]) cache.meals[date] = [];
  cache.meals[date].push({ id:'m'+Date.now()+'_'+(_foodSeq++), meal:_pickMeal, foodId:it.id, name:it.name, kcal:fnum(it.kcal), carbs:fnum(it.carbs), fat:fnum(it.fat), protein:fnum(it.protein) });
  await window.saveMealsFB(date);
  refreshPickIfOpen();  // ピッカー内の「追加済み」と回数バッジを即更新
  renderFoodTab();      // 背面の合計も更新（モーダルは開いたまま）
};
window.removeMealEntry = async function(id){
  const date = foodDate();
  cache.meals[date] = (cache.meals[date]||[]).filter(e=>String(e.id)!==String(id));
  await window.saveMealsFB(date);
  refreshPickIfOpen();
  renderFoodTab();
};
window.openFoodAddFromPick = function(){
  closeModal('ov-food-pick');
  openFoodAdd();
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
  if($('s-interim-weight')) $('s-interim-weight').value = (s.interimWeight!=null ? s.interimWeight : '');
  if($('s-interim-date')) $('s-interim-date').value = s.interimDate || '';
  $('s-start-bf').value = s.startBodyFat;
  $('s-target-bf').value = s.targetBodyFat;
  $('s-yt-long').value = s.youtubeLongTarget;
  $('s-yt-short').value = s.youtubeShortTarget;
  $('s-van-budget').value = s.vanBudget;
  $('s-wake-time').value = s.wakeTime;
  $('s-sleep-hours').value = s.targetSleepHours;
  if($('s-notify-enabled')) $('s-notify-enabled').checked = !!s.notifyEnabled;
  if($('s-notify-email')) $('s-notify-email').value = s.notifyEmail || '';
  if($('s-notify-lead')) $('s-notify-lead').value = (s.notifyLeadMin!=null ? s.notifyLeadMin : 5);

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
  if($('s-interim-weight')){ const iv = parseFloat($('s-interim-weight').value); cache.settings.interimWeight = isNaN(iv) ? null : iv; }
  if($('s-interim-date')) cache.settings.interimDate = $('s-interim-date').value || '';
  cache.settings.startBodyFat = parseFloat($('s-start-bf').value);
  cache.settings.targetBodyFat = parseFloat($('s-target-bf').value);
  cache.settings.youtubeLongTarget = parseInt($('s-yt-long').value);
  cache.settings.youtubeShortTarget = parseInt($('s-yt-short').value);
  cache.settings.vanBudget = parseInt($('s-van-budget').value);
  cache.settings.wakeTime = $('s-wake-time').value;
  cache.settings.targetSleepHours = parseFloat($('s-sleep-hours').value);
  if($('s-notify-enabled')) cache.settings.notifyEnabled = $('s-notify-enabled').checked;
  if($('s-notify-email')) cache.settings.notifyEmail = ($('s-notify-email').value||'').trim();
  if($('s-notify-lead')){ const lv = parseInt($('s-notify-lead').value); cache.settings.notifyLeadMin = isNaN(lv) ? 5 : Math.max(0, lv); }

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
  if(window.syncNotifySchedule) await syncNotifySchedule();
  const ns = $('notify-status');
  if(ns) ns.textContent = cache.settings.notifyEnabled
    ? `通知ON：${cache.settings.notifyEmail||'(メール未設定)'} に ${cache.settings.notifyLeadMin}分前に送信`
    : '通知OFF';

  const btn = $('settings-save-btn');
  btn.textContent = '✓ 保存しました';
  btn.disabled = true;
  setTimeout(()=>{ btn.textContent = '保存'; btn.disabled = false; }, 1800);
  
  renderAll();
};

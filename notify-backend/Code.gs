/**
 * scheduleAPP メール通知バックエンド（Google Apps Script・完全無料）
 *
 * 仕組み:
 *   アプリが Firestore の schedule_notify/upcoming に「今後7日分の予定」を
 *   JSON文字列で公開する。本スクリプトを1分ごとに動かし、各タスクの
 *   「指定分前」になったらメール(Gmail)で通知する。
 *
 * セットアップ手順は notify-backend/README.md を参照。
 */

// ===== 設定（このアプリのFirebaseプロジェクト。基本そのままでOK） =====
var PROJECT_ID = 'keiriauto-6f8f1';
var API_KEY    = 'AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew';
var TZ         = 'Asia/Tokyo';   // アプリの時刻基準（日本時間）

// ===== メイン: 1分ごとに実行される =====
function checkAndNotify() {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
            '/databases/(default)/documents/schedule_notify/upcoming?key=' + API_KEY;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    console.log('Firestore読み取り失敗: ' + res.getResponseCode() + ' ' + res.getContentText());
    return;
  }
  var fields = (JSON.parse(res.getContentText()) || {}).fields || {};
  if (!fields.data || !fields.data.stringValue) { console.log('データ未公開'); return; }

  var payload = JSON.parse(fields.data.stringValue);
  if (!payload.enabled) { return; }                 // 通知OFF
  if (!payload.email)   { console.log('メール未設定'); return; }
  var lead = (payload.leadMin != null) ? Number(payload.leadMin) : 5;

  var now    = new Date();
  var hh     = Number(Utilities.formatDate(now, TZ, 'HH'));
  var mm      = Number(Utilities.formatDate(now, TZ, 'mm'));
  var nowMin = hh * 60 + mm;

  // アプリの日付境界（朝5時前は前日扱い）に合わせる
  var dateStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  if (hh < 5) {
    var y = new Date(now.getTime() - 24 * 3600 * 1000);
    dateStr = Utilities.formatDate(y, TZ, 'yyyy-MM-dd');
  }

  var tasks = (payload.days && payload.days[dateStr]) || [];
  var props = PropertiesService.getScriptProperties();

  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    var tmin = parseHM(task.t);
    if (tmin === null) continue;
    var fireAt = tmin - lead;
    // トリガ遅延に備え、発火時刻〜+2分の窓で1回だけ送信
    if (nowMin < fireAt || nowMin > fireAt + 2) continue;

    var sentKey = 'sent_' + dateStr + '_' + task.t + '_' + task.l;
    if (props.getProperty(sentKey)) continue;
    props.setProperty(sentKey, '1');

    try {
      MailApp.sendEmail({
        to: payload.email,
        subject: 'まもなく ' + task.t + '  ' + task.l,
        body: task.t + ' に「' + task.l + '」が始まります（' + lead + '分前のお知らせ）。\n\n— scheduleAPP'
      });
      console.log('送信: ' + task.t + ' ' + task.l);
    } catch (e) {
      console.log('送信失敗: ' + e);
      props.deleteProperty(sentKey); // 失敗時は次回再試行できるよう解除
    }
  }

  cleanupOldSentKeys(props, dateStr);
}

// "HH:MM" → 分。読めなければ null
function parseHM(s) {
  var m = (s || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) : null;
}

// 当日以外の送信済みフラグを掃除（プロパティ肥大化防止）
function cleanupOldSentKeys(props, keepDate) {
  var all = props.getProperties();
  for (var k in all) {
    if (k.indexOf('sent_') === 0 && k.indexOf(keepDate) === -1) {
      props.deleteProperty(k);
    }
  }
}

// ===== 初期設定: 1回だけ実行（1分ごとトリガーを作成） =====
function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkAndNotify') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('checkAndNotify').timeBased().everyMinutes(1).create();
  console.log('1分ごとのトリガーを作成しました。');
}

// ===== 動作確認用: テストメールを今すぐ送る =====
function sendTestMail() {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
            '/databases/(default)/documents/schedule_notify/upcoming?key=' + API_KEY;
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var fields = (JSON.parse(res.getContentText()) || {}).fields || {};
  var payload = fields.data ? JSON.parse(fields.data.stringValue) : {};
  var to = payload.email;
  if (!to) { console.log('アプリの設定でメールアドレスを保存してください。'); return; }
  MailApp.sendEmail(to, '[テスト] scheduleAPP 通知', 'これはテストメールです。届いていれば設定OKです。');
  console.log('テストメールを ' + to + ' に送信しました。');
}

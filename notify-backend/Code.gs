/**
 * scheduleAPP メール通知バックエンド（Google Apps Script・完全無料）
 *
 * ★このコードは「指定の絶対時刻が来たら送るだけ」の最小構成です。
 *   日付の境界・24時超・何分前 などの計算はすべてアプリ側で済ませて
 *   送信時刻(payload.sends[].m = エポック分) を渡してくるので、
 *   今後アプリのロジックが変わっても、この GAS は変更不要です。
 *
 * セットアップ手順は notify-backend/README.md を参照。
 */

// ===== 設定（このアプリのFirebaseプロジェクト。基本そのままでOK） =====
var PROJECT_ID = 'keiriauto-6f8f1';
var API_KEY    = 'AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew';

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

  var sends = payload.sends || [];
  var nowM  = Math.floor(Date.now() / 60000);       // 現在のエポック分（タイムゾーン非依存）
  var props = PropertiesService.getScriptProperties();

  for (var i = 0; i < sends.length; i++) {
    var s = sends[i];
    if (typeof s.m !== 'number') continue;
    // 送信時刻〜+2分の窓で1回だけ（トリガ遅延に強い）
    if (nowM < s.m || nowM > s.m + 2) continue;

    var sentKey = 'sent_' + s.m + '_' + s.title;
    if (props.getProperty(sentKey)) continue;
    props.setProperty(sentKey, '1');

    try {
      MailApp.sendEmail({
        to: payload.email,
        subject: 'まもなく ' + s.time + '  ' + s.title,
        body: s.time + ' に「' + s.title + '」が始まります（お知らせ）。\n\n— scheduleAPP'
      });
      console.log('送信: ' + s.time + ' ' + s.title);
    } catch (e) {
      console.log('送信失敗: ' + e);
      props.deleteProperty(sentKey); // 失敗時は次回再試行できるよう解除
    }
  }

  cleanupOldSentKeys(props, nowM);
}

// 2日より前の送信済みフラグを掃除（プロパティ肥大化防止）
function cleanupOldSentKeys(props, nowM) {
  var all = props.getProperties();
  for (var k in all) {
    if (k.indexOf('sent_') !== 0) continue;
    var m = parseInt(k.split('_')[1], 10);
    if (!isNaN(m) && m < nowM - 2880) props.deleteProperty(k);
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

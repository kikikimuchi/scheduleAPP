// ==========================================================================
//  設定ファイル（ここだけ編集すればOK）
//  ※このファイルの値はブラウザに出るので「秘密鍵」ではありません。
//    YouTube APIキーは Google Cloud で「HTTPリファラー制限」をかけてください。
//    （手順は youtube-reader/SETUP.md を参照）
// ==========================================================================
window.YTR_CONFIG = {
  // --- Firebase（スケジュールアプリと同じプロジェクト。基本このままでOK） ---
  firebase: {
    apiKey: "AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew",
    authDomain: "keiriauto-6f8f1.firebaseapp.com",
    projectId: "keiriauto-6f8f1",
    storageBucket: "keiriauto-6f8f1.firebasestorage.app",
    messagingSenderId: "796610783894",
    appId: "1:796610783894:web:017da7e1949574090cf0b7"
  },

  // --- YouTube Data API キー ---
  //  設定すると「コメント表示」が有効になります（発見フィードは裏の取得係が使用）。
  //  未設定（空文字）の場合、それらの機能は「設定してね」の表示になります。
  youtubeApiKey: "AIzaSyCZcutDH3xvvO1MQNDVW2mQj_3UoRNtgJ0",

  // --- Google ログイン用 OAuth クライアントID ---
  //  設定すると「Googleでログインして登録チャンネルを取り込む」が有効になります。
  //  未設定の場合はログインボタンを隠し、CSV取り込みだけになります。
  oauthClientId: "104816687611-c0oj0sggpj2d8iv3pkh602lqqla5a40t.apps.googleusercontent.com",

  // 発見フィードの1カテゴリあたり最大表示数など（お好みで）
  discoverPerCategory: 12
};

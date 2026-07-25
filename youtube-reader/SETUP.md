# 正式版セットアップ手順

登録チャンネル・リーダー（`youtube-reader/web/`）を、あなたの iPhone で本番運用するための手順。
**まず「コア機能」だけで動かし、あとから「発見・コメント・ログイン」を足す**のがおすすめです。

---

## STEP 1. サイトに公開（必須）

1. このブランチを **`main` にマージ**する（GitHub Pages と Action は `main` で動く）。
2. 数分待つと、次のURLで開けるようになる（リポジトリ名の大文字小文字はそのまま）：
   ```
   https://kikikimuchi.github.io/scheduleAPP/youtube-reader/web/
   ```
3. iPhone の Safari で開き、**「ホーム画面に追加」**。アプリのように使えます。

> GitHub Pages が未設定なら、リポジトリの Settings → Pages で「Deploy from a branch / main」を選択。

---

## STEP 2. 登録チャンネルを取り込む（どちらか）

**A. CSV（設定不要・おすすめ）**
1. Google Takeout →「YouTube と YouTube Music」→「登録チャンネル」をエクスポート。
2. 出てきた `subscriptions.csv` を、アプリの **設定 ⚙ →「登録チャンネルの取り込み（CSV）」** で選ぶ。

**B. Googleログイン（STEP 5 の設定後に使える）**
- 設定 ⚙ →「Googleでログインして取り込む」。自分の登録チャンネルを自動取得。

---

## STEP 3. 最初のフィード取得（必須）

- GitHub → **Actions → 「YouTube feeds refresh」→ Run workflow** を1回押す。
- 以降は **6時間ごとに自動**で `videos.json` が更新される（キーが無くてもここまで動く）。

**ここまでで「登録CHフィード・タグ・履歴・アプリ内再生」が全部使えます。**（Google設定は不要）

---

## STEP 4. コア機能の確認

- フィード＝登録チャンネルの最新動画。タグで絞り込み・並び順（新着/再発見/1本ずつ）。
- 動画タップ＝アプリ内の公式プレーヤーで再生（履歴に記録）。
- チャンネルタブ＝タグ付け・ミュート。

---

## STEP 5. 「発見・コメント・ログイン」を有効化（任意）

これらは **YouTube Data API** が必要です。Google Cloud で1回だけ設定します。

### 5-1. プロジェクトとAPI
1. https://console.cloud.google.com/ でプロジェクトを作成（既存でも可）。
2. 「APIとサービス」→「ライブラリ」→ **YouTube Data API v3** を有効化。

### 5-2. APIキー（発見フィード・コメント表示に使用）
1. 「認証情報」→「認証情報を作成」→「APIキー」。
2. そのキーの「APIの制限」で **YouTube Data API v3 のみ**に制限（推奨）。
3. 使い道は2つ：
   - **アプリ（コメント表示）**: `youtube-reader/web/config.js` の `youtubeApiKey` に貼る。
     - ※ Pages が公開リポジトリだとキーは見えます。上の「APIの制限」を必ずかけ、
       気になる場合は「アプリケーションの制限＝HTTPリファラー」で
       `https://kikikimuchi.github.io/*` を許可した**ブラウザ用キー**を別に作る。
   - **取得係（発見の検索）**: GitHub → リポジトリ Settings → **Secrets and variables → Actions →
     New repository secret** に `YOUTUBE_API_KEY` という名前でキーを登録。
     （サーバー側で動くのでリファラー制限なしのキーが必要。ブラウザ用と分けるのが安全）

### 5-3. OAuth クライアントID（Googleログイン取り込みに使用）
1. 「OAuth 同意画面」→ External → 自分をテストユーザーに追加。スコープに
   `https://www.googleapis.com/auth/youtube.readonly` を追加。
2. 「認証情報」→「認証情報を作成」→「OAuth クライアントID」→ **ウェブアプリケーション**。
3. 「承認済みの JavaScript 生成元」に **`https://kikikimuchi.github.io`** を追加。
4. 発行された **クライアントID** を `youtube-reader/web/config.js` の `oauthClientId` に貼る。

> 「未確認アプリ」の警告が出ますが、個人利用（テストユーザー＝自分）なら問題ありません。

### 5-4. 反映
- `config.js` を編集して `main` に push（＝Pages が更新）。
- 発見フィードは、次の Action 実行後（または手動 Run）に表示されます。
- カテゴリ（タグ）を付けているほど、発見の精度が上がります。

---

## クォータの目安（発見フィード）

- YouTube の `search` は **1回100クォータ**（デフォルト上限 1日10,000＝実質100回）。
- 本ツールは **カテゴリ数ぶんだけ**検索（既定で最大8カテゴリ）。6時間ごとでも十分収まります。
- 足りない/余る場合は `.github/workflows/youtube-feeds.yml` の `cron` や、
  `gha-discover.js` の `DISCOVER_MAX_CATEGORIES` で調整。

---

## できること・できないこと（YouTube規約）

- ✅ 自分の登録チャンネルを読む／検索で発見／アプリ内で**公式プレーヤー再生**／コメント**表示**
- ❌ アプリ内での**コメント投稿・高評価・チャンネル登録**（書き込み）→ 公式アプリを開く
- ❌ YouTube本体の**視聴履歴**の取得（APIで非公開）→ このアプリ内の履歴のみ

# YouTube 登録チャンネル・リーダー

公式アプリの不満（おすすめが偏る／登録CHを忘れる／一覧への動線が悪い）を解消する、
**自分専用**の登録チャンネル閲覧ツール。登録チャンネルを自分でタグ分けして、
タグごとに独立したフィードを見る。

- スケジュールアプリと同じ **Safari（PWA）＋ Firestore** 構成。
- 動画の再生は自作しない。サムネ／タイトルをタップしたら YouTube を開くだけ。

---

## 全体の仕組み

ブラウザは CORS の制約で YouTube のフィードを直接取得できない。そこで
**「取りに行く係（GitHub Action）」** が裏で定期的に RSS を取得して `videos.json` を更新し、
Safari アプリはそれを読むだけにする（体重の自動記録＝ショートカット、メール通知＝Apps Script
と同じ「外の係が Firestore/リポジトリに置く → アプリが読む」の発想）。

```
[GitHub Action] --RSS取得--> videos.json(リポジトリ)
       ↑ チャンネル一覧を読む          ↓ 読む
   [Firestore: schedule_ytChannels] <--> [Safari アプリ]
        （タグ / ミュート / 視聴日時）      （タグ付け・視聴記録を書く）
```

| 置き場所 | 中身 |
|---|---|
| Firestore `schedule_ytChannels` | チャンネルごとの `title / tags / muted / lastViewedAt`（手で育てるマスター） |
| Firestore `schedule_ytMeta/app` | タグ一覧・タグ別のソートモード |
| リポジトリ `youtube-reader/web/data/videos.json` | 取得済み動画のキャッシュ（Actionが更新） |

---

## セットアップ（初回だけ）

### 1) このブランチを `main` に取り込む
GitHub Pages と GitHub Action はどちらも `main` で動くため、まず main にマージする。
（マージ後、`https://<ユーザー>.github.io/<リポジトリ>/youtube-reader/web/` で開ける。
Safari で開いて「ホーム画面に追加」でアプリのように使える。）

### 2) 登録チャンネルを取り込む（アプリ内でできる・ターミナル不要）
1. Google Takeout で「YouTube と YouTube Music」→「登録チャンネル」をエクスポート
2. 得られる `subscriptions.csv` を用意
3. アプリの **設定（⚙）→「登録チャンネルの取り込み」** で CSV を選んで「取り込む」
   → Firestore `schedule_ytChannels` にチャンネルが入る（既存のタグは保持）

### 3) フィードを取得する
- GitHub の **Actions タブ →「YouTube feeds refresh」→ Run workflow** で手動実行（初回）。
- 以降は **6時間ごとに自動実行**され、`videos.json` が更新される。
- 取得間隔を変えるなら `.github/workflows/youtube-feeds.yml` の `cron` を編集。

### 4) 使う
- **フィード**: 上部のタグを選ぶ → そのタグのチャンネルの動画が並ぶ。
  タグごとに並び順（新着順 / 再発見 / 1本ずつ）を切り替えられる。
- **チャンネル**: 各チャンネルにタグを付け外し。ミュート、タグ未設定だけの絞り込み。
- 動画をタップ → YouTube が開き、そのチャンネルの視聴日時を記録（再発見モードの要）。

---

## 並び順モード（仕様書 6.1）

| モード | 挙動 | 向いているカテゴリ |
|---|---|---|
| 新着順 `newest` | 公開が新しい順。配信予定（未来日）は下にまとめる | ニュース |
| 再発見 `rediscover` | 最後に見てから間が空いたチャンネルを優先して上に | 音楽 / youtuber |
| 1本ずつ `one-per-channel` | 1チャンネル最新1本だけ | vtuber（投稿が多く埋もれやすい） |

再発見スコアの重みは `web/index.html` 冒頭の `REDISCOVER` 定数で調整できる。

---

## 動作確認（デモモード）

Firestore もフィード取得も無しで、UI だけ触れる:

```
cd youtube-reader/web
python3 -m http.server 8099
# ブラウザで http://127.0.0.1:8099/index.html?demo=1
```

`?demo=1` は `data/channels.demo.json` と `data/videos.json`（同梱サンプル）を読む。
タグ操作などはこの端末の localStorage に保存され、Firestore には書き込まない。

---

## ローカルCLI（任意・上級者向け）

アプリ内取り込みの代わりに、手元の Node で JSON を作ることもできる（ネット制限のない環境で）。

```
npm run import      # Takeout CSV → data/channels.json（タグは再実行でも保持）
npm run fetch       # 各RSS → data/videos.json（同時数制限・個別try/catch・キャッシュ掃除）
npm test            # 依存ゼロのパーサ等のテスト
```

調整可能な定数は `config.js`（`CONCURRENCY` / `REQUEST_TIMEOUT_MS` / `PRUNE_DAYS` など）。

---

## 注意点（仕様書 7）

- **Shorts が混ざる**: RSS では通常動画と区別できない。まずは混在のまま。
- **ライブ配信**: 配信予定は `published` が未来日になる。新着順では下にまとめ、`配信予定` バッジを表示。
- **取れないチャンネル**: 稀に空/404。取得は個別 try/catch で、1件失敗しても全体は止まらない。
- **Firestore は OPEN ルール**前提（APIキーのみで読み書き）。既存アプリと同じ運用。

---

## この先（未実装 / 仕様書 6.3）

- タグの自動初期分類: チャンネル名を Anthropic API に投げて一括で「下書き」分類（手修正前提）。
  300チャンネルを手で分類するのは大変なので、次に入れる価値が高い。

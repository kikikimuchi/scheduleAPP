# YouTube 登録チャンネル・リーダー（データ層 / step1）

個人用の YouTube 登録チャンネル閲覧ツール。まずは仕様書の
**「8. 実装の進め方」ステップ1（データ層のみ）** を CLI で完結させたもの。

やること:

```
Takeout CSV  →  channels.json  →  各チャンネルのRSS取得  →  videos.json（キャッシュ）
```

タグ管理UI・自動分類・フィードUI・視聴記録（ステップ2〜4）は**まだ入っていない**。
この段階は「データが正しく取れて、手で編集できるJSONになる」ことの確認まで。

---

## 必要なもの

- Node.js 18 以上（`fetch` を標準で使う。外部パッケージ依存ゼロ）

---

## 使い方

### 1) 登録チャンネルを用意する（初回だけ）

1. Google Takeout で「YouTube と YouTube Music」→「登録チャンネル」をエクスポート
2. 得られた `subscriptions.csv`（`Channel Id` / `Channel Url` / `Channel Title` の3列）を
   このフォルダの **`data/subscriptions.csv`** に置く
   - まだ無い場合は、同梱の `data/subscriptions.sample.csv` がそのまま使われる（動作確認用）

### 2) channels.json を作る／更新する

```
npm run import
# または: node import-subscriptions.js path/to/subscriptions.csv
```

- `data/channels.json` を生成/更新する。
- **再実行しても、手でつけた `tags` / `lastViewedAt` / `muted` は保持**される
  （CSVからは `title` と `channelUrl` だけ最新化）。
- 出力に「タグ未設定（分類漏れ）」の件数が出る。

### 3) RSS を取得して videos.json にキャッシュする

```
npm run fetch
# 同時取得数を変える: CONCURRENCY=10 npm run fetch
```

- `data/channels.json` の各チャンネル（`muted:false`）のRSSを取得。
- **1件失敗しても止まらない**（チャンネルごとに try/catch）。失敗一覧は末尾に表示。
- `videoId` をキーに `data/videos.json` へ蓄積。重複は増やさず `fetchedAt` を更新。
- 最後に見かけてから `PRUNE_DAYS`（既定45日）を超えた動画は掃除する。

### テスト

```
npm test
```

ネットワークを使わず、CSV/Atom パーサ・同時実行制限・キャッシュのマージ挙動を検証する。

---

## 生成物

### `data/channels.json`（手で育てるマスター）

```json
{
  "UCxxxxxxxxxxxxxxxxxxxxxx": {
    "title": "チャンネル名",
    "tags": ["vtuber", "音楽"],
    "lastViewedAt": null,
    "muted": false,
    "channelUrl": "https://www.youtube.com/channel/UCxxxx..."
  }
}
```

`tags` は自由記述の配列（1チャンネルに複数可）。手で直接編集してよい。

### `data/videos.json`（自動キャッシュ）

```json
{
  "VIDEOID": {
    "videoId": "VIDEOID",
    "channelId": "UCxxxx...",
    "channelTitle": "チャンネル名",
    "title": "動画タイトル",
    "link": "https://www.youtube.com/watch?v=VIDEOID",
    "thumbnail": "https://i.ytimg.com/vi/VIDEOID/hqdefault.jpg",
    "published": "2026-07-20T12:00:00+00:00",
    "updated":   "2026-07-20T13:00:00+00:00",
    "firstSeenAt": "2026-07-25T00:00:00.000Z",
    "fetchedAt":   "2026-07-25T00:00:00.000Z"
  }
}
```

`channels.json` と `videos.json` は既定で **`.gitignore` 済み**（個人データのため）。
`channels.json` を分類ごとバックアップしたいときは `.gitignore` の該当行を外す。

---

## 調整できる定数（`config.js` / 環境変数）

| 変数 | 既定 | 意味 |
|---|---|---|
| `CONCURRENCY` | 6 | RSS 同時取得数（5〜10 推奨） |
| `REQUEST_TIMEOUT_MS` | 15000 | 1リクエストのタイムアウト |
| `MAX_RETRIES` | 1 | 取得失敗時のリトライ回数 |
| `PRUNE_DAYS` | 45 | キャッシュ掃除のしきい値（日） |
| `YT_USER_AGENT` | (内蔵) | 取得時の User-Agent |

---

## 注意点（仕様書 7 より）

- **CORS**: ブラウザから `youtube.com/feeds/...` を直接 fetch すると弾かれる。
  この CLI は**手元の Node で動かす前提**なので問題ない。フィードUI（ステップ3）を
  ブラウザで作るときに改めて薄いプロキシ等を検討する。
- **Shorts が混ざる**: RSS では Shorts と通常動画を区別できない。まずは混在のまま。
- **ライブ配信**: 配信予定は `published` が未来日になることがある。値はそのまま保持し、
  並び替えは後段のフィードUIで扱う。
- **取れないチャンネル**: 稀に空/404。個別 try/catch で全体は止めない。

---

## この先（未実装 / 仕様書 8 のステップ2〜4）

- ステップ2: チャンネル名を Anthropic API に投げてタグを一括「下書き」分類（手修正前提）
- ステップ3: タグ別フィードUI（`newest` / `rediscover` / `one-per-channel`）
- ステップ4: 視聴記録（開いたら `lastViewedAt` 更新）と YouTube への受け渡し

# YouTube 登録チャンネル・リーダー（個人用）

公式アプリの不満（おすすめが偏る／登録CHを忘れる／動線が悪い）を解消する、**自分専用**の
登録チャンネル閲覧ツール。スケジュールアプリと同じ **Safari(PWA) + Firestore** 構成。

**👉 動かす手順は [SETUP.md](./SETUP.md) を見てください。**

- ドット絵レトロ×ダークのUI。ロゴはまんぼーキャラ。
- タグ別フィード（登録CH / 発見）＋3つの並び順。
- 動画は**アプリ内の公式プレーヤー**で再生（自作プレーヤーではない＝規約OK）。

---

## 仕組み

ブラウザは CORS で YouTube を直接取得できないため、**裏で動く取得係（GitHub Action）**が
定期的にデータを作り、Safari アプリはそれを読む（体重＝ショートカット、通知＝Apps Script と同じ発想）。

```
[GitHub Action]  gha-fetch.js  --RSS-->     web/data/videos.json   (登録CHの最新)
                 gha-discover.js --検索-->    web/data/discover.json (発見/おすすめ)
      ↑ Firestoreからチャンネル一覧を読む          ↓ 読む
   [Firestore: schedule_ytChannels]  <------>  [Safari アプリ web/index.html]
        (タグ / ミュート / 視聴日時)               (タグ付け・視聴記録を書く)
```

| 置き場所 | 中身 |
|---|---|
| Firestore `schedule_ytChannels` | チャンネルごとの `title/tags/muted/lastViewedAt` |
| Firestore `schedule_ytMeta/app` | タグ一覧・カテゴリ別ソートモード |
| `web/data/videos.json` | 登録CHの動画キャッシュ（Actionが更新） |
| `web/data/discover.json` | 発見フィードのキャッシュ（Actionが更新, 要APIキー） |
| `web/config.js` | Firebase設定・YouTube APIキー・OAuthクライアントID |

## 機能と必要な設定

| 機能 | 必要なもの |
|---|---|
| 登録CHフィード・タグ・履歴・アプリ内再生・CSV取り込み | Firestore＋定期取得（**追加設定なし**） |
| 発見（おすすめ）フィード | YouTube APIキー（GitHub Secret） |
| コメント表示 | YouTube APIキー（config.js） |
| Googleログインで登録CH取り込み | OAuthクライアントID（config.js） |

## 並び順（登録CHフィード）

| モード | 挙動 |
|---|---|
| 新着順 | 公開が新しい順（配信予定は下にまとめる） |
| 再発見 | 最後に見てから間が空いたチャンネルを上に（重みは `index.html` の `REDISCOVER`） |
| 1本ずつ | 1チャンネル最新1本だけ |

---

## ローカルCLI（任意）

アプリ内取り込みの代わりに手元で JSON を作る用（ネット制限のない環境で）。

```
npm run import   # Takeout CSV → data/channels.json
npm run fetch    # 各RSS → data/videos.json
npm test         # 依存ゼロのパーサ等のテスト
```

## 注意点（YouTube規約 / 既知の課題）

- コメント投稿・高評価・チャンネル登録などの**書き込みはアプリ内に作らない**（公式アプリを開く）。
- YouTube本体の視聴履歴はAPIで取得不可（アプリ内履歴のみ）。
- 発見は「YouTubeのパーソナルおすすめAI」ではなく、**カテゴリ×検索の自前レコメンド**。
- Shorts は RSS/検索で通常動画と区別できないため混在。
- ライブ配信は `published` が未来日になることがある（新着順では下にまとめる）。

# ヘルスケア体重 → スケジュールAPP 自動同期

iPhoneの「ヘルスケア」に記録された体重を、スケジュールAPPの体重グラフ（理想ページ）へ
自動で取り込むための **ショートカット** の作り方。

- Webアプリからは直接ヘルスケアを読めないため、iOSの「ショートカット」アプリで
  体重を読み取り、Firestore（アプリのデータ置き場）へ直接書き込む。
- **Eufy Smart Scale P2 Pro** で測った体重・体脂肪はヘルスケアに入るので、
  この仕組みでEufy分もそのまま取り込める（個別連携は不要）。
- アプリ側のコード変更は不要。Firestoreに入った瞬間、次にアプリを開くとグラフに反映される。

---

## 書き込み先（Firestore REST API）

- メソッド: `PATCH`
- URL（`〈DATE〉` は `2026-06-25` のような日付に置換。これがドキュメントID＝記録日）:

```
https://firestore.googleapis.com/v1/projects/keiriauto-6f8f1/databases/(default)/documents/schedule_weights/〈DATE〉?key=AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew
```

- ヘッダ: `Content-Type: application/json`
- 本文（体重のみ）:

```json
{"fields":{"date":{"stringValue":"〈DATE〉"},"weight":{"doubleValue":〈KG〉}}}
```

- 本文（体重＋体脂肪）:

```json
{"fields":{"date":{"stringValue":"〈DATE〉"},"weight":{"doubleValue":〈KG〉},"bodyFat":{"doubleValue":〈BF〉}}}
```

PATCH なので、同じ日付に再送すると上書き（最新の値で更新）になる。アプリの記録ボタンと同じ挙動。

---

## ショートカットの作り方（体重のみ・最小構成）

「ショートカット」アプリ →「＋」で新規作成し、上から順にアクションを追加する。

1. **ヘルスケアサンプルを検索** (Find Health Samples)
   - サンプルタイプ: **体重**
   - 並べ替え: **終了日** / **最新が先頭**
   - 上限: **1**

2. **ヘルスケアサンプルの詳細を取得** (Get Details of Health Samples)
   - 入力: 手順1の結果
   - 詳細: **値**（= 体重の数値）→ これを変数「KG」とする

3. **日付をフォーマット** (Format Date)
   - 日付: **現在の日付**
   - フォーマット: カスタム → `yyyy-MM-dd` → これを変数「DATE」とする

4. **テキスト** (Text) … 送信する本文を組み立てる
   ```
   {"fields":{"date":{"stringValue":"〈DATE〉"},"weight":{"doubleValue":〈KG〉}}}
   ```
   `〈DATE〉` には手順3の変数、`〈KG〉` には手順2の値を挿入する。

5. **URLの内容を取得** (Get Contents of URL)
   - URL:
     ```
     https://firestore.googleapis.com/v1/projects/keiriauto-6f8f1/databases/(default)/documents/schedule_weights/〈DATE〉?key=AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew
     ```
     ※ `schedule_weights/` の直後に手順3の変数「DATE」を挿入する（記録日＝ドキュメントID）。
   - 「詳細を表示」を開き：
     - 方法: **PATCH**
     - ヘッダ: `Content-Type` = `application/json`
     - 本文を要求: **ファイル** → 手順4のテキストを選択

これで実行すると、ヘルスケアの最新体重がアプリのグラフに記録される。

---

## 体脂肪も一緒に取り込む場合（任意）

手順1〜2を体脂肪用にもう一組追加する。

- 追加の **ヘルスケアサンプルを検索**: サンプルタイプ=**体脂肪率**, 最新1件
- 追加の **詳細を取得**: 値（小数。例 0.24）→ 100倍したい場合は **計算** アクションで ×100 → 変数「BF」
  - ※ ヘルスケアの体脂肪率は 0〜1 の小数で返ることがある。アプリは「%」で扱うので、
    24%なら `24` を送る（必要なら ×100 する）。
- 手順4のテキストを体脂肪入りに差し替え：
  ```
  {"fields":{"date":{"stringValue":"〈DATE〉"},"weight":{"doubleValue":〈KG〉},"bodyFat":{"doubleValue":〈BF〉}}}
  ```

---

## 毎日自動で動かす（オートメーション）

「ショートカット」アプリ →「オートメーション」タブ →「＋」→「個人用オートメーションを作成」。

- おすすめ: **時刻** トリガー（例: 毎朝 9:00）→ 上で作ったショートカットを実行。
  「実行の前に尋ねる」をオフにすると完全自動。
- 体重を測ったあとに手動で実行してもOK（ホーム画面にショートカットを置ける）。

※ 測定日の値を正確に記録したい場合は、手順3を「現在の日付」ではなく
   手順1のサンプルの **終了日** をフォーマットして使う（Get Details で「終了日」を取得）。

---

## うまく書き込めないときの確認

- URLの `〈DATE〉` 部分（ドキュメントID）と本文の `date` が同じ日付になっているか。
- 本文が **ファイル（生テキスト）** として送られているか（JSON辞書UIだと入れ子が崩れやすい）。
- `Content-Type: application/json` ヘッダが付いているか。
- 体重が整数（例 82）でも `doubleValue` でOK。
- 実行後、Firestoreに反映されたかは下記で確認できる（DATEを置換）:
  ```
  curl "https://firestore.googleapis.com/v1/projects/keiriauto-6f8f1/databases/(default)/documents/schedule_weights/2026-06-25?key=AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew"
  ```

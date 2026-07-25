// 依存ゼロの簡易テスト。`npm test` で実行。
// ネットワークを使わず、CSV/Atom パーサとキャッシュのマージ挙動を検証する。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsvObjects, pick, parseCsv } from '../lib/csv.js';
import { parseFeed, decodeXml } from '../lib/atom.js';
import { mapPool } from '../lib/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)})`);
}

// ---- CSV ----
{
  const csv = readFileSync(join(__dirname, '..', 'data', 'subscriptions.sample.csv'), 'utf8');
  const rows = parseCsvObjects(csv);
  eq(rows.length, 5, 'CSV: 行数');
  eq(pick(rows[0], ['Channel Id']), 'UC_x5XG1OV2P6uZZ5FSM9Ttw', 'CSV: channelId 取得');
  eq(pick(rows[3], ['Channel Title']), 'Fireship, Inc.', 'CSV: クオート内カンマ');
  eq(pick(rows[4], ['Channel Title']), 'Linus "Tech" Tips', 'CSV: エスケープされた二重引用符');
  // 大文字小文字ゆらぎ
  eq(pick(rows[0], ['channel title']), 'Google for Developers', 'CSV: 列名の大小無視');

  // 末尾改行なし・CRLF混在
  const raw = parseCsv('a,b\r\n1,"x,y"\r\n2,z');
  eq(raw.length, 3, 'CSV: CRLF/末尾改行なしの行数');
  eq(raw[1][1], 'x,y', 'CSV: CRLF+クオート内カンマ');
  eq(raw[2][0], '2', 'CSV: 末尾行(改行なし)');
}

// ---- decodeXml ----
{
  eq(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;'), 'a & b <c> "d" \'e\' A', 'decodeXml: 実体参照');
}

// ---- Atom ----
{
  const xml = readFileSync(join(__dirname, 'atom.sample.xml'), 'utf8');
  const feed = parseFeed(xml);
  eq(feed.channelId, 'UC_x5XG1OV2P6uZZ5FSM9Ttw', 'Atom: feed channelId');
  eq(feed.channelTitle, 'Google for Developers', 'Atom: feed title');
  eq(feed.videos.length, 3, 'Atom: entry 数');

  const a = feed.videos[0];
  eq(a.videoId, 'AAAAAAAAAAA', 'Atom: videoId');
  eq(a.title, 'Tips & Tricks <Live> #1', 'Atom: title の実体参照デコード');
  eq(a.channelId, 'UC_x5XG1OV2P6uZZ5FSM9Ttw', 'Atom: entry channelId');
  eq(a.channelTitle, 'Google for Developers', 'Atom: author name');
  eq(a.link, 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'Atom: alternate link');
  eq(a.thumbnail, 'https://i4.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg', 'Atom: thumbnail');
  eq(a.published, '2024-05-01T17:00:07+00:00', 'Atom: published');
  eq(a.updated, '2024-05-02T00:00:00+00:00', 'Atom: updated');

  // 未来日(ライブ配信予定)も欠落なく保持される
  eq(feed.videos[1].published, '2099-12-31T09:00:00+00:00', 'Atom: 未来日の published を保持');

  // alternate link が無い場合は videoId から補完
  eq(feed.videos[2].link, 'https://www.youtube.com/watch?v=CCCCCCCCCCC', 'Atom: link 欠落時のフォールバック');
}

// ---- mapPool: 同時実行数を超えないこと ----
{
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  await mapPool(items, 5, async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 2;
  });
  assert(maxActive <= 5, `mapPool: 同時実行が上限内 (max=${maxActive})`);
}

// ---- videos.json マージ: 重複は増やさず fetchedAt を更新 ----
{
  const cache = {};
  const runA = '2026-01-01T00:00:00.000Z';
  const runB = '2026-01-02T00:00:00.000Z';
  const feedVideos = [{ videoId: 'X', title: '旧', channelId: 'UC1' }];

  // 1回目
  for (const v of feedVideos) {
    if (cache[v.videoId]) {
      cache[v.videoId].fetchedAt = runA;
    } else {
      cache[v.videoId] = { ...v, firstSeenAt: runA, fetchedAt: runA };
    }
  }
  // 2回目（同じ動画・タイトル変更）
  const feedVideos2 = [{ videoId: 'X', title: '新', channelId: 'UC1' }];
  for (const v of feedVideos2) {
    if (cache[v.videoId]) {
      cache[v.videoId].fetchedAt = runB;
      cache[v.videoId].title = v.title;
    } else {
      cache[v.videoId] = { ...v, firstSeenAt: runB, fetchedAt: runB };
    }
  }
  eq(Object.keys(cache).length, 1, 'cache: videoId 重複でキーが増えない');
  eq(cache.X.firstSeenAt, runA, 'cache: firstSeenAt は初回のまま');
  eq(cache.X.fetchedAt, runB, 'cache: fetchedAt は更新される');
  eq(cache.X.title, '新', 'cache: title は最新に更新');
}

console.log('----');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

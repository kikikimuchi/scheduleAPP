// 「発見(おすすめ)」用の取得係。
// Firestore のチャンネル(タイトル/タグ/お気に入り/最終視聴)を読み、
//   ・お気に入り／よく見るチャンネル名をシードに YouTube 検索（タグ名だけより精度が高い）
//   ・登録済みチャンネルは除外、再生数フィルタ・チャンネル偏り防止・スコア順に整列
// して web/data/discover.json を作る。
//
// 実行: YOUTUBE_API_KEY=xxxx node youtube-reader/gha-discover.js
//  ・APIキーが無ければ何もせず終了（discover.json は据え置き）。
//  ・search は1回100クォータと高い。SEARCH_BUDGET で検索回数の上限を設ける。
//  ・クォータ超過(403/429)時は既存 discover.json を壊さない。

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'web', 'data', 'discover.json');

const PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || 'keiriauto-6f8f1';
const FS_KEY = process.env.FIRESTORE_API_KEY || 'AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew';
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const CH_COL = 'schedule_ytChannels';

const SEARCH_BUDGET = Number(process.env.DISCOVER_SEARCH_BUDGET || 20); // 検索回数の上限(=100クォータ×この数)
const PER_QUERY = Number(process.env.DISCOVER_PER_QUERY || 25);        // 1検索から拾う最大件数
const PUBLISHED_AFTER_DAYS = Number(process.env.DISCOVER_DAYS || 45);
const MIN_VIEWS = Number(process.env.DISCOVER_MIN_VIEWS || 500);        // これ未満の再生数は除外
const PER_CHANNEL_CAP = Number(process.env.DISCOVER_PER_CHANNEL || 3);  // 同一チャンネルの最大本数(偏り防止)
const TARGET_TOTAL = Number(process.env.DISCOVER_TOTAL || 240);        // 最終的な最大本数
// タグに関係なく必ず入れる特別シード（お気に入り）
const PINNED = [{ cat: '湊あくあ切り抜き', q: '湊あくあ 切り抜き', boost: 30 }];

async function listChannels() {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${CH_COL}?key=${FS_KEY}&pageSize=300`;
  const out = [];
  let pageToken = '';
  do {
    const res = await fetch(base + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
    if (!res.ok) throw new Error(`Firestore list HTTP ${res.status}`);
    const json = await res.json();
    for (const doc of json.documents || []) {
      const id = decodeURIComponent(doc.name.split('/').pop());
      const f = doc.fields || {};
      const tags = (f.tags?.arrayValue?.values || []).map((v) => v.stringValue).filter(Boolean);
      out.push({
        channelId: id,
        title: f.title?.stringValue || '',
        tags,
        fav: f.fav?.booleanValue === true,
        muted: f.muted?.booleanValue === true,
        lastViewedAt: f.lastViewedAt?.stringValue || '',
      });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

// お気に入り→よく見る→タグ の優先で検索シードを作る。
// シードは実在のチャンネル名を使う（タグ名だけの検索より関連度が高い）。
function buildSeeds(channels) {
  const active = channels.filter((c) => !c.muted && c.title);
  const recency = (c) => Date.parse(c.lastViewedAt) || 0;
  // チャンネルの優先度: お気に入り > 最近見た > その他
  const rank = (c) => (c.fav ? 1e13 : 0) + recency(c);
  const sorted = [...active].sort((a, b) => rank(b) - rank(a));

  const seeds = [...PINNED];
  const usedQ = new Set(seeds.map((s) => s.q));
  const catOf = (c) => c.tags[0] || c.title;

  // 1) お気に入りチャンネルは個別にシード化（最優先）
  for (const c of sorted.filter((c) => c.fav)) {
    if (usedQ.has(c.title)) continue;
    seeds.push({ cat: catOf(c), q: c.title, why: `お気に入り「${c.title}」に関連`, boost: 20 });
    usedQ.add(c.title);
  }
  // 2) 各タグの代表(最上位)チャンネルをシード化（タグの網羅）
  const tags = [...new Set(active.flatMap((c) => c.tags))];
  for (const tag of tags) {
    const top = sorted.find((c) => c.tags.includes(tag) && !usedQ.has(c.title));
    if (!top) continue;
    seeds.push({ cat: tag, q: top.title, why: `${tag}の傾向から`, boost: 5 });
    usedQ.add(top.title);
  }
  // 3) 予算が余ればよく見るチャンネルを追加投入
  for (const c of sorted) {
    if (seeds.length >= SEARCH_BUDGET) break;
    if (usedQ.has(c.title)) continue;
    seeds.push({ cat: catOf(c), q: c.title, why: `「${c.title}」に関連`, boost: 3 });
    usedQ.add(c.title);
  }
  return seeds.slice(0, SEARCH_BUDGET);
}

async function searchSeed(seed, subscribed) {
  const publishedAfter = new Date(Date.now() - PUBLISHED_AFTER_DAYS * 86400_000).toISOString();
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', q: seed.q, maxResults: '40', order: 'relevance',
    regionCode: 'JP', relevanceLanguage: 'ja', publishedAfter, key: YT_KEY,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) { const body = await res.text(); const err = new Error(`search "${seed.cat}" HTTP ${res.status}: ${body}`); err.status = res.status; err.quota = /quota/i.test(body); throw err; }
  const json = await res.json();
  const items = [];
  let rank = 0;
  for (const it of json.items || []) {
    const id = it.id?.videoId; if (!id) continue;
    const cid = it.snippet?.channelId;
    if (!cid || subscribed.has(cid)) continue; // 登録済みチャンネルは除外
    rank++;
    items.push({
      id, cid, ch: it.snippet.channelTitle || '', t: it.snippet.title || '',
      p: it.snippet.publishedAt || '', cat: seed.cat, why: seed.why || `${seed.cat}の傾向から`,
      rank, boost: seed.boost || 0,
    });
    if (items.length >= PER_QUERY) break;
  }
  return items;
}

// 統計(再生数)を付与して品質フィルタに使う。videos.list は 1リクエスト1クォータと安い。
async function enrichStats(items) {
  const byId = new Map(items.map((v) => [v.id, v]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${batch.join(',')}&maxResults=50&key=${YT_KEY}`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of j.items || []) {
        const v = byId.get(it.id); if (!v) continue;
        v.views = Number(it.statistics?.viewCount || 0);
        v.dur = it.contentDetails?.duration || '';
      }
    } catch (e) { /* 統計取得失敗は無視(フィルタで残す) */ }
  }
}

function isShortDur(iso) { // PT〜60S 程度のショートを除外
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return false;
  const sec = (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  return sec > 0 && sec <= 60;
}

function rankAndCap(items) {
  const nowMs = Date.now();
  const seen = new Set();
  const uniq = [];
  for (const v of items) { if (seen.has(v.id)) continue; seen.add(v.id); uniq.push(v); }
  // 品質フィルタ: 再生数下限・ショート除外(統計が取れた場合のみ判定)
  const filtered = uniq.filter((v) => {
    if (v.views != null && v.views < MIN_VIEWS) return false;
    if (isShortDur(v.dur)) return false;
    return true;
  });
  // スコア = 検索関連度 + お気に入り等ブースト + 新しさ + 人気(log)
  for (const v of filtered) {
    const ageDays = Math.max(0, (nowMs - (Date.parse(v.p) || nowMs)) / 86400_000);
    const fresh = Math.max(0, 45 - Math.min(ageDays, 45));      // 0〜45
    const pop = v.views ? Math.log10(v.views + 10) * 4 : 0;      // だいたい0〜28
    const rel = Math.max(0, 40 - (v.rank || 40));                // 上位ほど高い
    v.sc = Math.round(rel + (v.boost || 0) + fresh * 0.6 + pop);
  }
  filtered.sort((a, b) => b.sc - a.sc);
  // チャンネル偏り防止: 同一チャンネルは PER_CHANNEL_CAP 本まで
  const perCh = new Map();
  const out = [];
  for (const v of filtered) {
    const n = perCh.get(v.cid) || 0;
    if (n >= PER_CHANNEL_CAP) continue;
    perCh.set(v.cid, n + 1);
    out.push(v);
    if (out.length >= TARGET_TOTAL) break;
  }
  return out;
}

function readExistingCount() {
  try { const j = JSON.parse(readFileSync(OUT, 'utf8')); return (j.videos || []).length; } catch (e) { return 0; }
}

async function main() {
  if (!YT_KEY) {
    console.log('YOUTUBE_API_KEY 未設定のため発見フィードはスキップします（discover.json は据え置き）。');
    return;
  }
  const channels = await listChannels();
  const subscribed = new Set(channels.map((c) => c.channelId));
  const seeds = buildSeeds(channels);
  if (seeds.length === 0) {
    console.log('シードが無いため発見フィードはスキップします。');
    return;
  }
  console.log(`検索シード ${seeds.length} 件（各最大${PER_QUERY}）: ${seeds.map((s) => s.q).join(' / ')}`);

  const all = [];
  let quotaHit = false;
  for (const seed of seeds) {
    try {
      const items = await searchSeed(seed, subscribed);
      all.push(...items);
      console.log(`  ${seed.q}: ${items.length}`);
    } catch (e) {
      console.error(`  ${seed.q}: 失敗 ${e.message}`);
      if (e.quota || e.status === 429 || e.status === 403) { quotaHit = true; console.error('  → クォータ超過のため検索を打ち切ります。'); break; }
    }
  }

  await enrichStats(all);
  const finalVids = rankAndCap(all);

  // クォータ超過で取得が激減した場合は既存を壊さない
  const existing = readExistingCount();
  if (quotaHit && finalVids.length < existing * 0.5) {
    console.log(`クォータ超過で今回 ${finalVids.length}本（既存 ${existing}本）。既存 discover.json を維持します。`);
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), count: finalVids.length, videos: finalVids }) + '\n', 'utf8');
  console.log(`→ ${OUT}（${finalVids.length}本 / シード${seeds.length}件${quotaHit ? ' ※クォータ超過で一部のみ' : ''}）`);
}

main().catch((e) => { console.error('discover 失敗:', e.message); process.exit(1); });

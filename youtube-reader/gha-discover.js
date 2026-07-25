// 「発見(おすすめ)」用の取得係。
// Firestore のチャンネルからカテゴリ(タグ)を集め、各カテゴリをキーワードに
// YouTube を検索し、登録済みチャンネルを除外して web/data/discover.json を作る。
//
// 実行: YOUTUBE_API_KEY=xxxx node youtube-reader/gha-discover.js
//  ・APIキーが無ければ何もせず終了（discover.json は書き換えない）。
//  ・search は1回100クォータと高い。カテゴリ数だけ呼ぶので、上限を設けている。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'web', 'data', 'discover.json');

const PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || 'keiriauto-6f8f1';
const FS_KEY = process.env.FIRESTORE_API_KEY || 'AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew';
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const CH_COL = 'schedule_ytChannels';

const MAX_CATEGORIES = Number(process.env.DISCOVER_MAX_CATEGORIES || 8); // クォータ抑制
const PER_CATEGORY = Number(process.env.DISCOVER_PER_CATEGORY || 12);
const PUBLISHED_AFTER_DAYS = Number(process.env.DISCOVER_DAYS || 45);

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
      out.push({ channelId: id, tags });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function searchCategory(cat, subscribed) {
  const publishedAfter = new Date(Date.now() - PUBLISHED_AFTER_DAYS * 86400_000).toISOString();
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', q: cat, maxResults: '25', order: 'relevance',
    regionCode: 'JP', relevanceLanguage: 'ja', publishedAfter, key: YT_KEY,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) throw new Error(`search "${cat}" HTTP ${res.status}: ${await res.text()}`);
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
      p: it.snippet.publishedAt || '', cat, why: `${cat} の傾向から`, sc: 100 - rank,
    });
    if (items.length >= PER_CATEGORY) break;
  }
  return items;
}

async function main() {
  if (!YT_KEY) {
    console.log('YOUTUBE_API_KEY 未設定のため発見フィードはスキップします（discover.json は据え置き）。');
    return;
  }
  const channels = await listChannels();
  const subscribed = new Set(channels.map((c) => c.channelId));
  const cats = [...new Set(channels.flatMap((c) => c.tags))].slice(0, MAX_CATEGORIES);
  if (!cats.length) {
    console.log('カテゴリ(タグ)が無いため発見フィードはスキップします。チャンネルにタグを付けてください。');
    return;
  }
  console.log(`カテゴリ ${cats.length} 件を検索: ${cats.join(', ')}（各最大${PER_CATEGORY}）`);

  const all = [];
  const seen = new Set();
  for (const cat of cats) {
    try {
      const items = await searchCategory(cat, subscribed);
      for (const it of items) {
        const key = it.cat + '|' + it.id;
        if (seen.has(key)) continue;
        seen.add(key); all.push(it);
      }
      console.log(`  ${cat}: ${items.length}`);
    } catch (e) {
      console.error(`  ${cat}: 失敗 ${e.message}`);
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), count: all.length, videos: all }) + '\n', 'utf8');
  console.log(`→ ${OUT}（${all.length}本 / ${cats.length}カテゴリ）`);
}

main().catch((e) => { console.error('discover 失敗:', e.message); process.exit(1); });

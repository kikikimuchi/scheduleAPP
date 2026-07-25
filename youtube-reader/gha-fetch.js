// GitHub Action 用の「取りに行く係」。
// Firestore の schedule_ytChannels からチャンネル一覧を読み、各RSSを取得して
// web/data/videos.json を生成する（ブラウザはCORSで直接取れないため、ここで取る）。
//
// ローカル確認: node youtube-reader/gha-fetch.js
// Firestore は OPEN ルール想定（APIキーのみで読める）。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { parseFeed } from './lib/atom.js';
import { mapPool } from './lib/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'web', 'data', 'videos.json');

const PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || 'keiriauto-6f8f1';
const API_KEY = process.env.FIRESTORE_API_KEY || 'AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew';
const CH_COL = 'schedule_ytChannels';
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS || 5000);

const now = () => new Date().toISOString();

async function listChannels() {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${CH_COL}?key=${API_KEY}&pageSize=300`;
  const channels = [];
  let pageToken = '';
  do {
    const url = base + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore list HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    for (const doc of json.documents || []) {
      const id = decodeURIComponent(doc.name.split('/').pop());
      const f = doc.fields || {};
      const muted = f.muted?.booleanValue === true;
      channels.push({ channelId: id, muted });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return channels;
}

async function fetchFeed(channelId) {
  const url = config.feedBaseUrl + encodeURIComponent(channelId);
  let lastErr;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.requestTimeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': config.userAgent, Accept: 'application/atom+xml, text/xml' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFeed(await res.text());
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function main() {
  console.log('Firestore からチャンネル一覧を取得中…');
  let channels;
  try {
    channels = await listChannels();
  } catch (e) {
    console.error('! チャンネル一覧の取得に失敗:', e.message);
    process.exit(1);
  }

  const targets = channels.filter((c) => !c.muted);
  console.log(`チャンネル ${channels.length}（muted除外 ${channels.length - targets.length}） / 同時取得 ${config.concurrency}`);

  if (targets.length === 0) {
    console.log('チャンネルが0件のため videos.json は更新しません（アプリでCSVを取り込んでください）。');
    return;
  }

  const videos = [];
  let ok = 0, failed = 0;
  const failures = [];

  await mapPool(targets, config.concurrency, async (c) => {
    try {
      const feed = await fetchFeed(c.channelId);
      ok++;
      for (const v of feed.videos) {
        videos.push({ id: v.videoId, cid: v.channelId || c.channelId, t: v.title || '', p: v.published || '', u: v.updated || '' });
      }
    } catch (e) {
      failed++;
      failures.push(`${c.channelId}: ${e.message}`);
    }
  });

  // 公開が新しい順。未来日(配信予定)は現在時刻でクランプして先頭独占を防ぐ。
  const nowMs = Date.now();
  const key = (v) => Math.min(Date.parse(v.p) || 0, nowMs);
  videos.sort((a, b) => key(b) - key(a));
  const trimmed = videos.slice(0, MAX_VIDEOS);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updatedAt: now(), count: trimmed.length, videos: trimmed }) + '\n', 'utf8');

  console.log('----');
  console.log(`取得成功: ${ok} / 失敗: ${failed} / 動画: ${trimmed.length}`);
  if (failures.length) console.log(`失敗例: ${failures.slice(0, 10).join(' | ')}${failures.length > 10 ? ' …' : ''}`);
  console.log(`→ ${OUT}`);
}

main();

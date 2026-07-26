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
const SHORT_CHECK_MAX = Number(process.env.SHORT_CHECK_MAX || 1500); // ショート判定する新しい動画の上限
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const SHORT_MAX_SEC = Number(process.env.SHORT_MAX_SEC || 60); // この秒数以下をショート扱い

const now = () => new Date().toISOString();

function isoDurToSec(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// ショート判定（#shorts タグ or 尺<=SHORT_MAX_SEC）＋ ライブ/配信予定 判定を YouTube Data API で付与。
// （データセンターIPからは shorts/ID リダイレクト法が同意ページで不安定なため API で判定）
async function markMeta(list) {
  for (const v of list) if (/#shorts?\b/i.test(v.t || '')) v.short = true;
  if (!YT_KEY) {
    console.log('YOUTUBE_API_KEY 未設定のため、尺/ライブ判定はスキップ（#shortsタグのみ）。');
    return;
  }
  let live = 0, upcoming = 0;
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const ids = batch.map((v) => v.id).join(',');
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,liveStreamingDetails&id=${ids}&maxResults=50&key=${YT_KEY}`);
      if (!r.ok) { console.error(`videos.list HTTP ${r.status}: ${await r.text()}`); continue; }
      const j = await r.json();
      const byId = new Map((j.items || []).map((it) => [it.id, it]));
      for (const v of batch) {
        const it = byId.get(v.id); if (!it) continue;
        const bc = it.snippet?.liveBroadcastContent;
        const lsd = it.liveStreamingDetails || {};
        const sec = isoDurToSec(it.contentDetails?.duration);
        if (bc === 'live') { v.live = true; if (lsd.actualStartTime) v.p = lsd.actualStartTime; live++; }
        else if (bc === 'upcoming') { v.upcoming = true; if (lsd.scheduledStartTime) v.p = lsd.scheduledStartTime; upcoming++; }
        else if (sec != null && sec > 0 && sec <= SHORT_MAX_SEC) v.short = true; // ライブ以外だけショート判定
      }
    } catch (e) {
      console.error('videos.list 失敗:', e.message);
    }
  }
  console.log(`ライブ判定: 配信中 ${live} / 配信予定 ${upcoming}`);
}

// メンバー限定候補: 各チャンネルのアップロード再生リスト(公開キーで取得可)にあって、
// RSS(=通常公開)に無く、かつRSSの新しさ範囲内の動画。RSSはメンバー限定を載せないことが多いので、
// その差分がメンバー限定候補。再生はできないのでアプリ側は公式アプリへ誘導する（mem:true）。
async function fetchMemberCandidates(targets, rssVideos) {
  if (!YT_KEY) return [];
  const byCh = new Map();
  for (const v of rssVideos) {
    let e = byCh.get(v.cid); if (!e) { e = { ids: new Set(), minP: Infinity }; byCh.set(v.cid, e); }
    e.ids.add(v.id); const t = Date.parse(v.p) || 0; if (t && t < e.minP) e.minP = t;
  }
  const out = [];
  await mapPool(targets, config.concurrency, async (c) => {
    const cid = c.channelId; if (!cid || cid.length < 3) return;
    const up = 'UU' + cid.slice(2); // アップロード再生リストID
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=${up}&key=${YT_KEY}`);
      if (!r.ok) return;
      const j = await r.json();
      const e = byCh.get(cid) || { ids: new Set(), minP: 0 };
      for (const it of j.items || []) {
        const s = it.snippet || {}, vid = s.resourceId && s.resourceId.videoId; if (!vid) continue;
        if (e.ids.has(vid)) continue; // RSSにある=通常公開なのでスキップ
        const t = Date.parse(s.publishedAt) || 0;
        if (e.minP && e.minP !== Infinity && t < e.minP) continue; // RSSの窓より古い=ただの旧動画
        out.push({ id: vid, cid, t: s.title || '', p: s.publishedAt || '', u: s.publishedAt || '', mem: true });
      }
    } catch (e) {}
  });
  return out;
}

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

  // 新しい動画からショート判定（フィードの「ショート」表示と通常フィードの除外に使う）
  const toCheck = trimmed.slice(0, SHORT_CHECK_MAX);
  await markMeta(toCheck);
  const shortCount = toCheck.filter((v) => v.short).length;
  console.log(`ショート判定: ${toCheck.length}本中 ${shortCount}本がショート`);

  // メンバー限定候補を追加（RSSに載らない差分）
  const members = await fetchMemberCandidates(targets, videos);
  const known = new Set(trimmed.map((v) => v.id));
  const memAdd = members.filter((v) => !known.has(v.id) && (known.add(v.id), true));
  for (const v of memAdd) trimmed.push(v);
  trimmed.sort((a, b) => key(b) - key(a));
  console.log(`メンバー限定候補: ${memAdd.length}本`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updatedAt: now(), count: trimmed.length, videos: trimmed }) + '\n', 'utf8');

  console.log('----');
  console.log(`取得成功: ${ok} / 失敗: ${failed} / 動画: ${trimmed.length}`);
  if (failures.length) console.log(`失敗例: ${failures.slice(0, 10).join(' | ')}${failures.length > 10 ? ' …' : ''}`);
  console.log(`→ ${OUT}`);
}

main();

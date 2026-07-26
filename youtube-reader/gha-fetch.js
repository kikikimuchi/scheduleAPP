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
const SHORT_CHECK_MAX = Number(process.env.SHORT_CHECK_MAX || 5000); // ショート/ライブ判定する上限（実質全件）
const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const SHORT_MAX_SEC = Number(process.env.SHORT_MAX_SEC || 60); // これ以下は無条件でショート
const SHORT_URLCHECK_SEC = Number(process.env.SHORT_URLCHECK_SEC || 182); // 60〜この秒数はURLで確認（ショートは最大3分）
// メンバー限定を拾うチャンネル（HTMLを匿名で読む）。チャンネルID or @handle をカンマ区切り。
const MEMBER_CHANNELS = (process.env.MEMBER_CHANNELS || 'UCpfSEgdN0vaR3Y5iBSgxE5Q,@結城さくな').split(',').map((s) => s.trim()).filter(Boolean);

// ページHTMLから ytInitialData を波括弧マッチで取り出す
function extractYtInitialData(html) {
  let i = html.indexOf('ytInitialData =');
  if (i < 0) i = html.indexOf('ytInitialData"]=');
  if (i < 0) return null;
  i = html.indexOf('{', i);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(i, j + 1)); } catch (e) { return null; } } }
  }
  return null;
}
// ytInitialData を走査し、メンバー限定バッジ付きの動画IDを集める
function collectMemberVideoIds(root) {
  const ids = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.videoId && (n.title || n.headline)) {
      const s = JSON.stringify(n);
      if (/MEMBERS_ONLY/.test(s) || /メンバー(限定|シップ)/.test(s) || /"Members only"/i.test(s)) ids.add(n.videoId);
    }
    for (const k in n) walk(n[k]);
  })(root);
  return [...ids];
}
async function fetchMemberVideos() {
  if (!MEMBER_CHANNELS.length) return [];
  const ids = new Set();
  for (const ref of MEMBER_CHANNELS) {
    const url = ref.startsWith('@')
      ? `https://www.youtube.com/${encodeURIComponent(ref)}/videos`
      : `https://www.youtube.com/channel/${ref}/videos`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': config.userAgent, 'Accept-Language': 'ja,en;q=0.8', Cookie: 'SOCS=CAI; CONSENT=YES+cb' } });
      if (!r.ok) { console.error(`  member HTML ${ref}: HTTP ${r.status}`); continue; }
      const html = await r.text();
      const data = extractYtInitialData(html);
      if (!data) { console.error(`  member ${ref}: ytInitialData取得失敗（同意ページ等の可能性）`); continue; }
      const found = collectMemberVideoIds(data);
      console.error(`  member ${ref}: メンバー限定 ${found.length}本`);
      found.forEach((id) => ids.add(id));
    } catch (e) { console.error(`  member ${ref}: ${e.message}`); }
  }
  if (!ids.size || !YT_KEY) return [];
  // videos.list で正確なタイトル・公開日・チャンネルIDを取得
  const out = [];
  const arr = [...ids];
  for (let i = 0; i < arr.length; i += 50) {
    const batch = arr.slice(i, i + 50);
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(',')}&maxResults=50&key=${YT_KEY}`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of j.items || []) {
        const s = it.snippet || {};
        out.push({ id: it.id, cid: s.channelId || '', t: s.title || 'メンバー限定動画', p: s.publishedAt || new Date().toISOString(), u: s.publishedAt || '', mem: true });
      }
    } catch (e) {}
  }
  return out;
}

const now = () => new Date().toISOString();

function isoDurToSec(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// youtube.com/shorts/ID は、ショートなら200、通常動画なら/watchへ302。同意ページ回避にCookie付与。
async function isShortUrl(id) {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${id}`, {
      redirect: 'manual',
      headers: { 'User-Agent': config.userAgent, Cookie: 'SOCS=CAI; CONSENT=YES+cb', 'Accept-Language': 'ja' },
    });
    r.body?.cancel?.();
    if (r.status === 200) return true;
    const loc = r.headers.get('location') || '';
    if (/\/watch/.test(loc)) return false;
    return false;
  } catch (e) { return false; }
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
  const urlCand = []; // 60〜3分の動画はURLでショート確認
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
        else if (sec != null && sec > 0 && sec <= SHORT_MAX_SEC) v.short = true; // 60秒以下は無条件ショート
        else if (sec != null && sec > SHORT_MAX_SEC && sec <= SHORT_URLCHECK_SEC && !v.short) urlCand.push(v); // 60秒〜3分はURL確認
      }
    } catch (e) {
      console.error('videos.list 失敗:', e.message);
    }
  }
  // 60秒〜3分の候補をURLでショート確認（縦型ショートを取りこぼさない）
  let urlShort = 0;
  await mapPool(urlCand, config.concurrency, async (v) => { if (await isShortUrl(v.id)) { v.short = true; urlShort++; } });
  console.log(`ライブ判定: 配信中 ${live} / 配信予定 ${upcoming} / URL確認ショート ${urlShort}/${urlCand.length}`);
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

  // メンバー限定動画（対象チャンネルのHTMLを匿名で読む）を追加
  console.log('メンバー限定を取得中…');
  const members = await fetchMemberVideos();
  const known = new Set(trimmed.map((v) => v.id));
  const memAdd = members.filter((v) => !known.has(v.id) && (known.add(v.id), true));
  for (const v of memAdd) trimmed.push(v);
  if (memAdd.length) trimmed.sort((a, b) => key(b) - key(a));
  console.log(`メンバー限定: ${memAdd.length}本を追加`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updatedAt: now(), count: trimmed.length, videos: trimmed }) + '\n', 'utf8');

  console.log('----');
  console.log(`取得成功: ${ok} / 失敗: ${failed} / 動画: ${trimmed.length}`);
  if (failures.length) console.log(`失敗例: ${failures.slice(0, 10).join(' | ')}${failures.length > 10 ? ' …' : ''}`);
  console.log(`→ ${OUT}`);
}

main();

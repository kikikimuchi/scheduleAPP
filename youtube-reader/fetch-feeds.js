// channels.json の各チャンネルのRSSを取得し、videos.json にキャッシュする。
//
//   使い方:
//     node fetch-feeds.js
//     CONCURRENCY=10 node fetch-feeds.js   # 同時取得数を変える
//
// 仕様書の注意点への対応:
//   - 取得は必ず個別に try/catch。1件失敗しても全体は止めない（仕様書 7）
//   - 同時取得数を制限（既定6）。300チャンネルでも一気に投げない（仕様書 7）
//   - videoId をキーに重複取得を防ぎ、fetchedAt を持たせて古いものを掃除（仕様書 5.3）
//   - Shorts は区別できないので混在のまま（仕様書 7）
//   - ライブ配信で published が未来日になり得るのはそのまま保持（ソートは後段UIの担当）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { parseFeed } from './lib/atom.js';
import { mapPool } from './lib/pool.js';

const now = () => new Date().toISOString();

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`! ${path} を読めませんでした: ${e.message}`);
    process.exit(1);
  }
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
      const xml = await res.text();
      return parseFeed(xml);
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function main() {
  const channels = loadJson(config.paths.channels, null);
  if (!channels || Object.keys(channels).length === 0) {
    console.error('! channels.json が空です。先に `node import-subscriptions.js` を実行してください。');
    process.exit(1);
  }

  const cache = loadJson(config.paths.videos, {});
  const targets = Object.entries(channels).filter(([, c]) => !c.muted);
  const mutedCount = Object.keys(channels).length - targets.length;

  console.log(`対象チャンネル: ${targets.length}（muted除外 ${mutedCount}） / 同時取得 ${config.concurrency}`);

  let ok = 0;
  let failed = 0;
  let newVideos = 0;
  const failures = [];

  const runAt = now();

  await mapPool(targets, config.concurrency, async ([channelId, ch]) => {
    try {
      const feed = await fetchFeed(channelId);
      ok++;
      for (const v of feed.videos) {
        const existing = cache[v.videoId];
        if (existing) {
          // 既知の動画: 最終確認時刻(fetchedAt)だけ更新。updated/titleは最新に。
          existing.fetchedAt = runAt;
          existing.title = v.title ?? existing.title;
          existing.updated = v.updated ?? existing.updated;
          existing.thumbnail = v.thumbnail ?? existing.thumbnail;
        } else {
          cache[v.videoId] = {
            ...v,
            // フィードにチャンネル名が無い場合は channels.json の名前で補完
            channelTitle: v.channelTitle || ch.title,
            firstSeenAt: runAt,
            fetchedAt: runAt,
          };
          newVideos++;
        }
      }
    } catch (e) {
      failed++;
      failures.push({ channelId, title: ch.title, error: e.message });
    }
  });

  // 掃除: 最後に見かけてから pruneDays を超えた動画を削除（仕様書 5.3）
  const cutoff = Date.now() - config.pruneDays * 86400_000;
  let pruned = 0;
  for (const [videoId, v] of Object.entries(cache)) {
    const seen = Date.parse(v.fetchedAt || v.firstSeenAt || '');
    if (Number.isFinite(seen) && seen < cutoff) {
      delete cache[videoId];
      pruned++;
    }
  }

  mkdirSync(dirname(config.paths.videos), { recursive: true });
  writeFileSync(config.paths.videos, JSON.stringify(cache, null, 2) + '\n', 'utf8');

  console.log('----');
  console.log(`取得成功: ${ok} / 失敗: ${failed}`);
  console.log(`新規動画: ${newVideos} / キャッシュ合計: ${Object.keys(cache).length}（掃除 ${pruned}）`);
  if (failures.length) {
    console.log('---- 失敗したチャンネル ----');
    for (const f of failures.slice(0, 20)) {
      console.log(`  [${f.channelId}] ${f.title} : ${f.error}`);
    }
    if (failures.length > 20) console.log(`  ...ほか ${failures.length - 20} 件`);
  }
  console.log(`→ ${config.paths.videos} に保存しました。`);
}

main();

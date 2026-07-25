// Takeout の subscriptions.csv を読み、channels.json を生成/更新する。
//
//   使い方:
//     node import-subscriptions.js [path/to/subscriptions.csv]
//     （省略時は data/subscriptions.csv、無ければ data/subscriptions.sample.csv）
//
// 既存の channels.json があれば「マージ」する:
//   - 既存チャンネルの tags / lastViewedAt / muted は保持（手作業の分類を壊さない）
//   - CSVにあって未登録のチャンネルだけ、既定値で追加
//   - CSVから消えたチャンネルは残す（購読解除しても記録を消さない）
//
// channels.json のスキーマ（仕様書 5.2）:
//   { "<channelId>": { title, tags:[], lastViewedAt:null, muted:false, channelUrl } }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { parseCsvObjects, pick } from './lib/csv.js';

function resolveCsvPath(argPath) {
  if (argPath) return argPath;
  if (existsSync(config.paths.subscriptionsCsv)) return config.paths.subscriptionsCsv;
  return config.paths.subscriptionsSampleCsv;
}

function loadChannels() {
  if (!existsSync(config.paths.channels)) return {};
  try {
    return JSON.parse(readFileSync(config.paths.channels, 'utf8'));
  } catch (e) {
    console.error(`! 既存の channels.json を読めませんでした: ${e.message}`);
    process.exit(1);
  }
}

function main() {
  const csvPath = resolveCsvPath(process.argv[2]);
  if (!existsSync(csvPath)) {
    console.error(`! CSVが見つかりません: ${csvPath}`);
    console.error('  Takeout の subscriptions.csv を data/ に置くか、パスを引数で渡してください。');
    process.exit(1);
  }

  const rows = parseCsvObjects(readFileSync(csvPath, 'utf8'));
  const channels = loadChannels();

  let added = 0;
  let updatedTitle = 0;
  let skippedNoId = 0;

  for (const row of rows) {
    const channelId = (pick(row, ['Channel Id', 'Channel ID', 'channelId']) || '').trim();
    const title = (pick(row, ['Channel Title', 'Title', 'channelTitle']) || '').trim();
    const channelUrl = (pick(row, ['Channel Url', 'Channel URL', 'channelUrl']) || '').trim();

    if (!channelId) {
      skippedNoId++;
      continue;
    }

    if (channels[channelId]) {
      // 既存: タイトルとURLだけ最新化（分類は保持）
      if (title && channels[channelId].title !== title) {
        channels[channelId].title = title;
        updatedTitle++;
      }
      if (channelUrl && !channels[channelId].channelUrl) {
        channels[channelId].channelUrl = channelUrl;
      }
    } else {
      channels[channelId] = {
        title: title || channelId,
        tags: [],
        lastViewedAt: null,
        muted: false,
        channelUrl: channelUrl || `https://www.youtube.com/channel/${channelId}`,
      };
      added++;
    }
  }

  mkdirSync(dirname(config.paths.channels), { recursive: true });
  writeFileSync(config.paths.channels, JSON.stringify(channels, null, 2) + '\n', 'utf8');

  const total = Object.keys(channels).length;
  const untagged = Object.values(channels).filter((c) => !c.tags || c.tags.length === 0).length;

  console.log(`CSV: ${csvPath}`);
  console.log(`  取り込み行:        ${rows.length}`);
  console.log(`  新規追加:          ${added}`);
  console.log(`  タイトル更新:      ${updatedTitle}`);
  if (skippedNoId) console.log(`  ID欠落でスキップ:  ${skippedNoId}`);
  console.log('----');
  console.log(`channels.json 合計:  ${total} チャンネル`);
  console.log(`  うちタグ未設定:    ${untagged}（分類漏れ）`);
  console.log(`→ ${config.paths.channels} に保存しました。`);
}

main();

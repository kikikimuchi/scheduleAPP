// まんぼーちゅーぶ メンバー限定スクレイパー（あなたのPCで動かす用）
// あなたがログイン済みのChromeを使って、指定チャンネルの「メンバー限定動画」を拾い、
// Firestore(schedule_ytMembers)へ書き込む。アプリ(iPhone)はそれを読んで🔒付きで表示する。
//
// ● 準備（初回だけ）
//   1) Node.js を入れる（https://nodejs.org）
//   2) このフォルダで:  npm i playwright   →  npx playwright install chromium
//   3) 対象チャンネルのURLを下の CHANNELS に入れる（例: https://www.youtube.com/@channelname）
//      ※ 引数でも渡せる:  node member-scraper.mjs "https://youtube.com/@a" "https://youtube.com/@b"
//
// ● 実行
//   node member-scraper.mjs
//   初回はブラウザが開くので YouTube にログインしてください（メンバーのアカウントで）。
//   ログインは ./yt-profile に保存され、次回から自動。ウィンドウは閉じずに待てば完了します。
//
// ● 定期自動化（任意）
//   Mac: crontab、Windows: タスクスケジューラで「node member-scraper.mjs」を1時間ごと等に実行。
//   ※ 初回ログイン後は headless:true でも動くはず（下の HEADLESS を true に）。

import { chromium } from 'playwright';

// ★ここに、あなたがメンバーになっている2チャンネルのURLを入れてください★
let CHANNELS = [
  // 'https://www.youtube.com/@daini_group',
  // 'https://www.youtube.com/@sakuna',
];
if (process.argv.length > 2) CHANNELS = process.argv.slice(2);

const HEADLESS = false; // 初回ログイン後は true にすると裏で静かに動く
const PROFILE_DIR = './yt-profile'; // ログイン状態の保存先
const PROJECT_ID = 'keiriauto-6f8f1';
const FS_KEY = 'AIzaSyC4kuVMrD1iKBxsX8V12n8OHzPBW2xA0Ew';
const MEM_COL = 'schedule_ytMembers';

// ---- ytInitialData から「メンバー限定動画」を抽出 ----
function collectVideos(root) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.videoId && (n.title || n.headline)) {
      const s = JSON.stringify(n);
      const members = /MEMBERS_ONLY/.test(s) || /メンバー(限定|シップ)/.test(s) || /"Members only"/i.test(s);
      if (members) {
        const title = (n.title?.runs?.[0]?.text) || (n.title?.simpleText) || (n.headline?.simpleText) || '';
        out.push({ id: n.videoId, t: title });
      }
    }
    for (const k in n) walk(n[k]);
  })(root);
  return out;
}
function channelInfo(data) {
  const cid = data?.metadata?.channelMetadataRenderer?.externalId
    || data?.header?.c4TabbedHeaderRenderer?.channelId || '';
  const name = data?.metadata?.channelMetadataRenderer?.title
    || data?.header?.c4TabbedHeaderRenderer?.title || '';
  return { cid, name };
}

async function fsUpsert(v) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${MEM_COL}/${encodeURIComponent(v.id)}?key=${FS_KEY}`;
  const body = { fields: {
    id: { stringValue: v.id }, cid: { stringValue: v.cid || '' }, t: { stringValue: v.t || 'メンバー限定動画' },
    ch: { stringValue: v.ch || '' }, p: { stringValue: v.p || new Date().toISOString() },
    mem: { booleanValue: true }, updatedAt: { stringValue: new Date().toISOString() },
  } };
  const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.error('Firestore書き込み失敗', v.id, r.status, await r.text());
}

async function main() {
  if (!CHANNELS.length) {
    console.error('CHANNELS が空です。スクリプト上部の CHANNELS にチャンネルURLを入れるか、引数で渡してください。');
    process.exit(1);
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: HEADLESS, channel: 'chrome', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // ログイン確認
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const loggedIn = await page.evaluate(() => !!(window.ytInitialData && JSON.stringify(window.ytInitialData).includes('accountName')) || !!document.querySelector('#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn'));
  if (!loggedIn && !HEADLESS) {
    console.log('▶ YouTubeにログインしてください（メンバーのアカウントで）。ログイン後、ここで自動的に続行します…');
    // アバターが出るまで最大3分待つ
    try { await page.waitForSelector('#avatar-btn', { timeout: 180000 }); } catch (e) {}
  }

  let total = 0;
  for (const chUrl of CHANNELS) {
    const base = chUrl.replace(/\/+$/, '');
    const vurl = /\/videos$/.test(base) ? base : base + '/videos';
    console.log('→', vurl);
    try {
      await page.goto(vurl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      // 遅延読み込みのため少しスクロール
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(1200); }
      const data = await page.evaluate(() => window.ytInitialData);
      if (!data) { console.error('  ytInitialData取得失敗'); continue; }
      const { cid, name } = channelInfo(data);
      const vids = collectVideos(data);
      // 念のため重複除去
      const seen = new Set(), uniq = [];
      for (const v of vids) { if (seen.has(v.id)) continue; seen.add(v.id); uniq.push(v); }
      console.log(`  ${name || chUrl}: メンバー限定 ${uniq.length}本`);
      for (const v of uniq) { await fsUpsert({ ...v, cid, ch: name }); total++; }
    } catch (e) { console.error('  失敗', e.message); }
  }
  console.log(`完了: ${total}本を保存しました（アプリの「すべて」に🔒付きで出ます）`);
  await ctx.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

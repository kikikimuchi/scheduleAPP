// メンバー限定動画スクレイプの診断スクリプト（GitHub Actionで実行してログを見る用）。
// 目的: 「YouTubeがGitHubのサーバーに、メンバー動画を含むページを返しているか？」を突き止める。
// 実行: node youtube-reader/gha-member-probe.js
//   MEMBER_CHANNELS 環境変数で対象指定（既定: だいにぐるーぷ / 結城さくな）

const MEMBER_CHANNELS = (process.env.MEMBER_CHANNELS || 'UCpfSEgdN0vaR3Y5iBSgxE5Q,@結城さくな')
  .split(',').map((s) => s.trim()).filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Cookie': 'SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmphIAEaBgiAo_myBg; CONSENT=YES+cb; PREF=hl=ja&gl=JP',
};

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

// videoRenderer/richItemRenderer 系ノードを走査し、メンバーバッジ付きの動画を集める
function collectMembers(root) {
  const out = []; const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.videoId && (n.title || n.headline || n.thumbnailOverlays || n.badges)) {
      const s = JSON.stringify(n);
      const isMem = /BADGE_STYLE_TYPE_MEMBERS_ONLY/.test(s) || /MEMBERS_ONLY/.test(s) || /メンバー(限定|シップ)/.test(s) || /"Members only"/i.test(s);
      if (isMem && !seen.has(n.videoId)) {
        seen.add(n.videoId);
        const title = (n.title?.runs?.[0]?.text) || (n.title?.simpleText) || (n.headline?.simpleText) || '';
        const when = (n.publishedTimeText?.simpleText) || '';
        out.push({ id: n.videoId, t: title, when });
      }
    }
    for (const k in n) walk(n[k]);
  })(root);
  return out;
}

// 全 videoId の数（グリッドがそもそも入っているかの指標）
function countVideoIds(root) {
  let c = 0;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.videoId) c++;
    for (const k in n) walk(n[k]);
  })(root);
  return c;
}

async function probe(ref) {
  const bases = ref.startsWith('@')
    ? [`https://www.youtube.com/${encodeURIComponent(ref)}/videos`, `https://www.youtube.com/${encodeURIComponent(ref)}/streams`]
    : [`https://www.youtube.com/channel/${ref}/videos`, `https://www.youtube.com/channel/${ref}/streams`];
  for (const url of bases) {
    console.log(`\n===== ${ref}  ${url} =====`);
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      console.log(`HTTP ${r.status}  final=${r.url}`);
      const html = await r.text();
      console.log(`HTML長: ${html.length}`);
      // 生HTMLでの指標
      const raw = {
        ytInitialData: html.includes('ytInitialData'),
        consent: /consent\.youtube\.com|同意して続行|Before you continue/.test(html),
        membersRaw: (html.match(/メンバー限定/g) || []).length,
        membersBadge: (html.match(/BADGE_STYLE_TYPE_MEMBERS_ONLY/g) || []).length,
      };
      console.log('生HTML:', JSON.stringify(raw));
      const data = extractYtInitialData(html);
      if (!data) { console.log('→ ytInitialData 取り出し失敗'); continue; }
      const total = countVideoIds(data);
      const mem = collectMembers(data);
      console.log(`ytInitialData: 全videoId=${total} / メンバー検出=${mem.length}`);
      mem.slice(0, 8).forEach((m) => console.log(`   🔒 ${m.id}  ${m.when}  ${m.t.slice(0, 40)}`));
    } catch (e) { console.log('取得エラー:', e.message); }
  }
}

(async () => {
  console.log('UA:', UA);
  for (const ref of MEMBER_CHANNELS) await probe(ref);
  console.log('\n=== probe 完了 ===');
})();

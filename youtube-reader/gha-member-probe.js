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

// 文字列ベース: JSON全体で「メンバー限定」の各出現位置から、直前の "videoId":"..." を紐づける
function collectMembersByString(root) {
  const json = JSON.stringify(root);
  const marks = [];
  const re = /メンバー限定|Members only/gi;
  let m; while ((m = re.exec(json))) marks.push(m.index);
  const vidRe = /"videoId":"([\w-]{11})"/g;
  // 各出現の直前の videoId を探す
  const out = []; const seen = new Set();
  const vids = []; let vm; while ((vm = vidRe.exec(json))) vids.push({ i: vm.index, id: vm[1] });
  for (const pos of marks) {
    let best = null;
    for (const v of vids) { if (v.i < pos) best = v; else break; }
    if (best && !seen.has(best.id)) { seen.add(best.id); out.push(best.id); }
  }
  return out;
}
// 「メンバー限定」出現周辺のJSONを少し見せる（構造確認用）
function dumpContext(root, max = 2) {
  const json = JSON.stringify(root);
  const re = /メンバー限定/g; let m; let c = 0;
  while ((m = re.exec(json)) && c < max) { c++;
    const a = Math.max(0, m.index - 300), b = Math.min(json.length, m.index + 60);
    console.log(`   …ctx${c}: ${json.slice(a, b)}`);
  }
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
      const mem = collectMembersByString(data);
      console.log(`ytInitialData: 全videoId=${total} / メンバー検出(文字列)=${mem.length}`);
      mem.slice(0, 12).forEach((id) => console.log(`   🔒 ${id}`));
      dumpContext(data, 2);
    } catch (e) { console.log('取得エラー:', e.message); }
  }
}

(async () => {
  console.log('UA:', UA);
  for (const ref of MEMBER_CHANNELS) await probe(ref);
  console.log('\n=== probe 完了 ===');
})();

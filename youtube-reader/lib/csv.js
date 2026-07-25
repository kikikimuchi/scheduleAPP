// 依存ゼロの小さなCSVパーサ。
// Takeout の subscriptions.csv（Channel Id / Channel Url / Channel Title）を想定。
// ダブルクオート内のカンマ・改行・"" によるエスケープに対応する。

export function parseCsv(text) {
  // BOM除去
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // エスケープされた "" を1つの " として取り込む
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // CRLF / CR を吸収（次が \n ならそこで行確定）
      if (text[i + 1] !== '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else {
      field += c;
    }
  }
  // 最終フィールド/行（末尾に改行が無い場合）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 完全な空行を除去
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// ヘッダ行を使って [{col: value}] に変換する。
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

// Takeout の列名ゆらぎ（大文字小文字・空白）を吸収して取り出すヘルパ。
export function pick(obj, candidates) {
  const keys = Object.keys(obj);
  for (const cand of candidates) {
    const target = cand.toLowerCase().replace(/\s+/g, '');
    const hit = keys.find(
      (k) => k.toLowerCase().replace(/\s+/g, '') === target
    );
    if (hit) return obj[hit];
  }
  return undefined;
}

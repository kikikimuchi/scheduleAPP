// 調整可能な定数はここに集約する（仕様書 6.1 の「重み付けは外出し」に対応）。
// 環境変数で上書き可能。例: CONCURRENCY=10 npm run fetch

const num = (name, def) => {
  const v = process.env[name];
  if (v == null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  // チャンネルRSSのベースURL（channel_id を付けて使う）
  feedBaseUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=',

  // 同時取得数。300チャンネルでも一気に投げず 5〜10 に制限する（仕様書 7）。
  concurrency: num('CONCURRENCY', 6),

  // 1リクエストのタイムアウト(ms)。固まったチャンネルで全体を止めないため。
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 15000),

  // 取得失敗時のリトライ回数（RSSが稀に空/404になる。仕様書 7）。
  maxRetries: num('MAX_RETRIES', 1),

  // キャッシュの掃除: 最後にフィードで見かけてから この日数 を超えた動画は削除。
  pruneDays: num('PRUNE_DAYS', 45),

  // 一部チャンネルはUAが無いと弾かれることがあるため付与。
  userAgent:
    process.env.YT_USER_AGENT ||
    'Mozilla/5.0 (compatible; youtube-reader/0.1; personal use)',

  // ファイルパス
  paths: {
    subscriptionsCsv: 'data/subscriptions.csv',
    subscriptionsSampleCsv: 'data/subscriptions.sample.csv',
    channels: 'data/channels.json',
    videos: 'data/videos.json',
  },
};

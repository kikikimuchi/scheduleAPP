// 依存ゼロの YouTube Atom フィード パーサ。
// youtube.com/feeds/videos.xml の構造は安定しているので、必要な項目だけを
// 対象を絞って抽出する（汎用XMLパーサは持ち込まない = 個人利用で十分）。
//
// 取り出す項目（仕様書 3.1）:
//   videoId / title / published / updated / channelId / author.name /
//   media:thumbnail / link

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

export function decodeXml(s) {
  if (s == null) return s;
  return s
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .trim();
}

function first(re, s) {
  const m = s.match(re);
  return m ? decodeXml(m[1]) : undefined;
}

// <link ... rel="alternate" ... href="..."> を、属性順に依存せず取り出す。
function altLink(block) {
  const links = block.match(/<link\b[^>]*>/g) || [];
  for (const l of links) {
    if (/rel="alternate"/.test(l)) {
      const m = l.match(/href="([^"]+)"/);
      if (m) return decodeXml(m[1]);
    }
  }
  return undefined;
}

// フィード1本ぶんのXML文字列をパースして
// { channelId, channelTitle, videos: [...] } を返す。
export function parseFeed(xml) {
  const firstEntry = xml.indexOf('<entry>');
  const header = firstEntry === -1 ? xml : xml.slice(0, firstEntry);

  const feedChannelId = first(/<yt:channelId>([^<]+)<\/yt:channelId>/, header);
  const feedTitle = first(/<title>([\s\S]*?)<\/title>/, header);
  const feedAuthor = first(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/, header);

  const videos = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const videoId = first(/<yt:videoId>([^<]+)<\/yt:videoId>/, block);
    if (!videoId) continue; // videoIdが無いものは動画として扱わない

    const channelId =
      first(/<yt:channelId>([^<]+)<\/yt:channelId>/, block) || feedChannelId;
    const channelTitle =
      first(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/, block) ||
      feedAuthor ||
      feedTitle;
    const thumbnail = first(/<media:thumbnail\s+url="([^"]+)"/, block);

    videos.push({
      videoId,
      channelId,
      channelTitle,
      title: first(/<title>([\s\S]*?)<\/title>/, block),
      link: altLink(block) || `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail,
      published: first(/<published>([^<]+)<\/published>/, block),
      updated: first(/<updated>([^<]+)<\/updated>/, block),
    });
  }

  return { channelId: feedChannelId, channelTitle: feedTitle, videos };
}

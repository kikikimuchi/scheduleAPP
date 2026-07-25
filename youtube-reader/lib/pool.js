// 同時実行数を制限しながら items を worker で処理する。
// worker は必ず解決する想定（各自 try/catch する）。返り値の配列は入力順。
export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let k = 0; k < n; k++) runners.push(run());
  await Promise.all(runners);
  return results;
}

// Queue-Times.com から USJ の待ち時間を1回取得し、月別CSVへ追記する。
// ローカル（server.js から呼び出し）と GitHub Actions（CLI実行）の両方で使う。
//   CLI: node collect.js --dir data/cloud
// CSV: data/<dir>/YYYY-MM.csv  列 = time(UTC ISO, 分単位), ride_id, open(1/0), wait(分)
const fs = require('fs');
const path = require('path');

const API_URL = 'https://queue-times.com/parks/284/queue_times.json'; // 284 = Universal Studios Japan
const STALE_MS = 60 * 60 * 1000;

async function fetchRides() {
  const res = await fetch(API_URL, { headers: { 'User-Agent': 'usj-wait-times (personal dashboard)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return [...(json.rides || []), ...(json.lands || []).flatMap((l) => l.rides || [])].map((r) => ({
    id: r.id,
    name: r.name.trim(),
    isOpen: r.is_open,
    wait: r.wait_time,
    lastUpdated: r.last_updated,
  }));
}

function appendRecord(dir, rides, date = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const time = date.toISOString().slice(0, 16) + 'Z';
  const file = path.join(dir, `${time.slice(0, 7)}.csv`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'time,ride_id,open,wait\n');
  // 閉園後も最後の値が「運営中」のまま残るため、最終更新から60分以上経った値は休止扱いで記録する
  const isFresh = (r) => date - Date.parse(r.lastUpdated) < STALE_MS;
  fs.appendFileSync(file, rides.map((r) => `${time},${r.id},${r.isOpen && isFresh(r) ? 1 : 0},${r.wait}\n`).join(''));

  // 英語名の台帳（新アトラクション追加時の確認用）
  const namesFile = path.join(dir, 'rides.json');
  let known = {};
  try { known = JSON.parse(fs.readFileSync(namesFile, 'utf8')); } catch {}
  for (const r of rides) known[r.id] = r.name;
  fs.writeFileSync(namesFile, JSON.stringify(known, null, 2) + '\n');
}

async function collect(dir) {
  const rides = await fetchRides();
  appendRecord(dir, rides);
  return rides;
}

module.exports = { fetchRides, appendRecord, collect };

if (require.main === module) {
  const i = process.argv.indexOf('--dir');
  const dir = path.resolve(__dirname, i > 0 ? process.argv[i + 1] : 'data/local');
  collect(dir)
    .then((rides) => console.log(`取得 ${rides.length}件 → ${dir}`))
    .catch((err) => { console.error(`取得失敗: ${err.message}`); process.exit(1); });
}

// USJ アトラクション待ち時間ダッシュボード用ローカルサーバー
// - 5分ごとに Queue-Times.com から取得して data/local/ に記録（collect.js）
// - GitHub Actions が記録した data/cloud/ は、git管理下なら1時間ごとに git pull で取り込む
// - 両者を5分枠で重複排除して、現在値・当日推移・時間帯別平均を返す
// 追加npmパッケージなし（Node 18+ の組み込み fetch を使用）。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { collect } = require('./collect');

const PORT = Number(process.env.PORT) || 8787;
const POLL_MS = 5 * 60 * 1000;
const PULL_MS = 60 * 60 * 1000;
const SLOT_MS = 5 * 60 * 1000;
const JST_MS = 9 * 3600 * 1000;
const DATA_DIRS = ['data/local', 'data/cloud'].map((d) => path.join(__dirname, d));

let latest = null; // { fetchedAt, rides }

const jstDate = (t) => new Date(t + JST_MS).toISOString().slice(0, 10);
const jstHour = (t) => new Date(t + JST_MS).getUTCHours();

function loadNames() {
  const ja = JSON.parse(fs.readFileSync(path.join(__dirname, 'names.json'), 'utf8'));
  const en = {};
  for (const dir of DATA_DIRS) {
    try { Object.assign(en, JSON.parse(fs.readFileSync(path.join(dir, 'rides.json'), 'utf8'))); } catch {}
  }
  if (latest) for (const r of latest.rides) en[r.id] = r.name;
  const out = {};
  for (const id of Object.keys(en)) out[id] = ja[id] || en[id];
  return out;
}

// 期間（"2026-10" / "2026" / "all"）に該当する月CSVを読み、5分枠で重複排除した記録を返す
function loadRecords(period) {
  const seen = new Map();
  for (const dir of DATA_DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.csv$/.test(f)); } catch { continue; }
    for (const f of files) {
      // 月ファイルはUTC基準のため、JSTの月境界をまたぐ前後の月も読んでから日付で絞る
      if (period !== 'all' && !isNearPeriod(f.slice(0, 7), period)) continue;
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      for (let i = 1; i < lines.length; i++) {
        const [time, id, open, wait] = lines[i].split(',');
        if (!time) continue;
        const t = Date.parse(time);
        if (period !== 'all' && !jstDate(t).startsWith(period)) continue;
        const key = `${id}|${Math.floor(t / SLOT_MS)}`;
        if (!seen.has(key)) seen.set(key, { t, id: Number(id), open: open === '1', wait: Number(wait) });
      }
    }
  }
  return [...seen.values()];
}

function isNearPeriod(month, period) {
  if (period.length === 4) return month.startsWith(period) || month === `${Number(period) - 1}-12`;
  const [y, m] = period.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return month === period || month === prev;
}

function listPeriods() {
  const months = new Set();
  for (const r of loadRecords('all')) months.add(jstDate(r.t).slice(0, 7));
  const m = [...months].sort().reverse();
  return { months: m, years: [...new Set(m.map((x) => x.slice(0, 4)))] };
}

// 時間帯（日本時間の1時間単位）ごとの平均待ち時間。運営中の記録のみで平均する
function hourly(period) {
  const recs = loadRecords(period).filter((r) => r.open);
  const names = loadNames();
  const days = new Set(recs.map((r) => jstDate(r.t)));
  const acc = {}; // id -> hour -> [sum, n]
  const park = {};
  for (const r of recs) {
    const h = jstHour(r.t);
    const cell = ((acc[r.id] ||= {})[h] ||= [0, 0]);
    cell[0] += r.wait; cell[1]++;
    const p = (park[h] ||= [0, 0]);
    p[0] += r.wait; p[1]++;
  }
  const avg = (c) => Math.round(c[0] / c[1]);
  const hours = [...new Set(recs.map((r) => jstHour(r.t)))].sort((a, b) => a - b);
  const rides = Object.entries(acc).map(([id, byH]) => {
    const all = Object.values(byH).reduce((s, c) => [s[0] + c[0], s[1] + c[1]], [0, 0]);
    return {
      id: Number(id),
      name: names[id] || id,
      avg: avg(all),
      byHour: Object.fromEntries(Object.entries(byH).map(([h, c]) => [h, { avg: avg(c), n: c[1] }])),
    };
  });
  rides.sort((a, b) => b.avg - a.avg);
  return {
    period,
    days: days.size,
    hours,
    park: Object.fromEntries(Object.entries(park).map(([h, c]) => [h, avg(c)])),
    rides,
  };
}

// 当日（日本時間）の推移
function today() {
  const d = jstDate(Date.now());
  const series = {};
  for (const r of loadRecords(d.slice(0, 7))) {
    if (jstDate(r.t) !== d) continue;
    (series[r.id] ||= []).push([r.t, r.open ? r.wait : null]);
  }
  for (const s of Object.values(series)) s.sort((a, b) => a[0] - b[0]);
  return series;
}

async function poll() {
  const stamp = new Date().toLocaleTimeString('ja-JP');
  try {
    const rides = await collect(DATA_DIRS[0]);
    latest = { fetchedAt: new Date().toISOString(), rides };
    console.log(`[${stamp}] 取得 ${rides.length}件`);
  } catch (err) {
    console.error(`[${stamp}] 取得失敗: ${err.message}`);
  }
}

function pullCloud() {
  if (!fs.existsSync(path.join(__dirname, '.git'))) return;
  execFile('git', ['pull', '--ff-only', '-q'], { cwd: __dirname }, (err, _out, stderr) => {
    if (err) console.error(`git pull 失敗: ${stderr.trim() || err.message}`);
  });
}

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/now') {
      const names = loadNames();
      const rides = latest ? latest.rides.map((r) => ({ ...r, name: names[r.id] || r.name })) : [];
      return sendJson(res, { latest: latest && { fetchedAt: latest.fetchedAt, rides }, today: today() });
    }
    if (url.pathname === '/api/periods') return sendJson(res, listPeriods());
    if (url.pathname === '/api/hourly') {
      const period = url.searchParams.get('period') || 'all';
      if (!/^(all|\d{4}|\d{4}-\d{2})$/.test(period)) { res.writeHead(400); return res.end('bad period'); }
      return sendJson(res, hourly(period));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('error');
  }
});

poll();
setInterval(poll, POLL_MS);
pullCloud();
setInterval(pullCloud, PULL_MS);
server.listen(PORT, () => console.log(`USJ待ち時間ダッシュボード: http://localhost:${PORT}`));

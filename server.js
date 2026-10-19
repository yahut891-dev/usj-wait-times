// USJ アトラクション待ち時間ダッシュボード用ローカルサーバー
// - 5分ごとに Queue-Times.com から取得して data/local/ に記録（collect.js）
// - GitHub Actions が記録した data/cloud/ は、git管理下なら1時間ごとに git pull で取り込む
// - 両者を5分枠で重複排除して、現在値・当日推移・時間帯別平均を返す（aggregate.js）
// 追加npmパッケージなし（Node 18+ の組み込み fetch を使用）。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { collect } = require('./collect');
const { createAggregator } = require('./aggregate');

const PORT = Number(process.env.PORT) || 8787;
const POLL_MS = 5 * 60 * 1000;
const PULL_MS = 60 * 60 * 1000;
const DATA_DIRS = ['data/local', 'data/cloud'].map((d) => path.join(__dirname, d));
const agg = createAggregator(DATA_DIRS);

let latest = null; // { fetchedAt, rides }

async function poll() {
  const stamp = new Date().toLocaleTimeString('ja-JP');
  try {
    latest = await collect(DATA_DIRS[0]);
    console.log(`[${stamp}] 取得 ${latest.rides.length}件`);
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
      const names = agg.loadNames(latest ? latest.rides : []);
      const rides = latest ? latest.rides.map((r) => ({ ...r, name: names[r.id] || r.name })) : [];
      return sendJson(res, { latest: latest && { fetchedAt: latest.fetchedAt, rides }, today: agg.today() });
    }
    if (url.pathname === '/api/periods') return sendJson(res, agg.listPeriods());
    if (url.pathname === '/api/hourly') {
      const period = url.searchParams.get('period') || 'all';
      if (!/^(all|\d{4}|\d{4}-\d{2})$/.test(period)) { res.writeHead(400); return res.end('bad period'); }
      return sendJson(res, agg.hourly(period));
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

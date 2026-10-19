// GitHub Pages 公開版の生成：data/cloud/ の記録から静的JSONを作り、index.html と一緒に出力する
//   node build-public.js [--out _site]
// 出力: <out>/index.html, <out>/site-data/{now.json, periods.json, hourly-<期間>.json}
// 公開版はサーバーが無いため、index.html はこれらのJSONを直接読む（ローカル版は server.js の /api/*）。
const fs = require('fs');
const path = require('path');
const { createAggregator } = require('./aggregate');

const i = process.argv.indexOf('--out');
const OUT = path.resolve(__dirname, i > 0 ? process.argv[i + 1] : '_site');
const CLOUD = path.join(__dirname, 'data/cloud');
const agg = createAggregator([CLOUD]);

let latest = null;
try { latest = JSON.parse(fs.readFileSync(path.join(CLOUD, 'latest.json'), 'utf8')); } catch {}

const names = agg.loadNames(latest ? latest.rides : []);
const dataDir = path.join(OUT, 'site-data');
fs.mkdirSync(dataDir, { recursive: true });
const write = (file, body) => fs.writeFileSync(path.join(dataDir, file), JSON.stringify(body));

write('now.json', {
  latest: latest && {
    fetchedAt: latest.fetchedAt,
    rides: latest.rides.map((r) => ({ ...r, name: names[r.id] || r.name })),
  },
  today: agg.today(),
});

const periods = agg.listPeriods();
write('periods.json', periods);
for (const p of [...periods.months, ...periods.years, 'all']) write(`hourly-${p}.json`, agg.hourly(p, names));

fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(OUT, 'index.html'));
console.log(`公開版を出力: ${OUT}（期間 ${periods.months.length}か月）`);

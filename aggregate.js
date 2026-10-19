// 月別CSVの読み込みと集計（server.js と build-public.js で共用）
// 複数の保存先（data/local・data/cloud）を読み、同じ5分枠の重複は1件にまとめる。
const fs = require('fs');
const path = require('path');

const SLOT_MS = 5 * 60 * 1000;
const JST_MS = 9 * 3600 * 1000;
const NAMES_FILE = path.join(__dirname, 'names.json');

const jstDate = (t) => new Date(t + JST_MS).toISOString().slice(0, 10);
const jstHour = (t) => new Date(t + JST_MS).getUTCHours();

function isNearPeriod(month, period) {
  if (period.length === 4) return month.startsWith(period) || month === `${Number(period) - 1}-12`;
  const [y, m] = period.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return month === period || month === prev;
}

function createAggregator(dataDirs) {
  // 英語名（rides.json・最新取得値）に日本語名（names.json）を上書きした表示名
  function loadNames(latestRides = []) {
    const ja = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'));
    const en = {};
    for (const dir of dataDirs) {
      try { Object.assign(en, JSON.parse(fs.readFileSync(path.join(dir, 'rides.json'), 'utf8'))); } catch {}
    }
    for (const r of latestRides) en[r.id] = r.name;
    const out = {};
    for (const id of Object.keys(en)) out[id] = ja[id] || en[id];
    return out;
  }

  // 期間（"2026-10" / "2026" / "all"、JST基準）に該当する記録
  function loadRecords(period) {
    const seen = new Map();
    for (const dir of dataDirs) {
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.csv$/.test(f)); } catch { continue; }
      for (const f of files) {
        // 月ファイルはUTC基準のため、JSTの月境界をまたぐ前月分も読んでから日付で絞る
        if (period !== 'all' && !isNearPeriod(f.slice(0, 7), period)) continue;
        const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
        for (let i = 1; i < lines.length; i++) {
          const [time, id, open, wait] = lines[i].trim().split(',');
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

  function listPeriods() {
    const months = new Set();
    for (const r of loadRecords('all')) months.add(jstDate(r.t).slice(0, 7));
    const m = [...months].sort().reverse();
    return { months: m, years: [...new Set(m.map((x) => x.slice(0, 4)))] };
  }

  // 時間帯（JST 1時間単位）ごとの平均待ち時間。運営中の記録のみで平均する
  function hourly(period, names = loadNames()) {
    const recs = loadRecords(period).filter((r) => r.open);
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

  // 当日（JST）の推移 { rideId: [[timestampMs, wait|null], ...] }
  function today(now = Date.now()) {
    const d = jstDate(now);
    const series = {};
    for (const r of loadRecords(d.slice(0, 7))) {
      if (jstDate(r.t) !== d) continue;
      (series[r.id] ||= []).push([r.t, r.open ? r.wait : null]);
    }
    for (const s of Object.values(series)) s.sort((a, b) => a[0] - b[0]);
    return series;
  }

  return { loadNames, loadRecords, listPeriods, hourly, today };
}

module.exports = { createAggregator };

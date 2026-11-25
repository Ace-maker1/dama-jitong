const COMPANIES = ['magnum', 'toto', 'damacai', 'sabah88', 'stc', 'cashsweep'];

function emptyBoard(drawDate = '', drawNo = '') {
  return {
    drawNo,
    drawDate,
    p1: '----',
    p2: '----',
    p3: '----',
    special: Array(10).fill('----'),
    consolation: Array(10).fill('----')
  };
}

function getMytNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

function getMytDateStr(offsetDays = 0) {
  const myt = new Date(getMytNow().getTime() + offsetDays * 86400000);
  return myt.toISOString().slice(0, 10);
}

function isLiveDrawHourMyt() {
  const myt = getMytNow();
  const d = myt.getDay();
  const h = myt.getHours();
  return (d === 0 || d === 3 || d === 6) && h >= 19 && h < 20;
}

function normalizeCompanyKey(raw = '') {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'magnum' || s.includes('magnum')) return 'magnum';
  if (s === 'toto' || s.includes('toto')) return 'toto';
  if (s === 'damacai' || s.includes('da ma cai') || s.includes('damacai')) return 'damacai';
  if (s === 'sabah88' || s.includes('sabah') || s.includes('diriwan')) return 'sabah88';
  if (s === 'stc' || s.includes('sandakan')) return 'stc';
  if (s === 'cashsweep' || s.includes('sarawak') || s.includes('cashsweep')) return 'cashsweep';
  return null;
}

function fmt4(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 4 ? d : '----';
}

function pad4List(arr, count = 10) {
  const clean = (Array.isArray(arr) ? arr : []).map(v => fmt4(v));
  const out = clean.slice(0, count);
  while (out.length < count) out.push('----');
  return out;
}

function hasAnyValid4D(board) {
  if (!board) return false;
  return [board.p1, board.p2, board.p3, ...(board.special || []), ...(board.consolation || [])]
    .some(n => /^\d{4}$/.test(n));
}

// 关键：只要开出任意 1 个号码（哪怕头奖还没开，先开了安慰奖/特别奖）就保留！
function normalizeDrawRecord(item, fallbackDate = '') {
  if (!item || typeof item !== 'object') return null;

  const p1 = fmt4(item.first ?? item.p1 ?? item['1st']);
  const p2 = fmt4(item.second ?? item.p2 ?? item['2nd']);
  const p3 = fmt4(item.third ?? item.p3 ?? item['3rd']);
  const special = pad4List(item.special, 10);
  const consolation = pad4List(item.consolation, 10);

  const board = {
    drawNo: String(item.draw_no ?? item.drawNo ?? ''),
    drawDate: String(item.date ?? item.draw_date ?? fallbackDate).slice(0, 10),
    p1,
    p2,
    p3,
    special,
    consolation
  };

  return hasAnyValid4D(board) ? board : null;
}

function extractItemsArray(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data?.results)) return payload.data.results;
  if (Array.isArray(payload.data?.draws)) return payload.data.draws;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload.data && typeof payload.data === 'object') return [payload.data];
  return [];
}

async function fetchJsonSafe(url, ms = 5500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache'
      }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadHistoryFromSupabase() {
  const url = process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co';
  const key = process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';
  const history = { magnum: [], toto: [], damacai: [], sabah88: [], stc: [], cashsweep: [] };

  try {
    const r = await fetch(`${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc&limit=120`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows)) {
        rows.forEach(row => {
          if (history[row.company_id] && history[row.company_id].length < 25) {
            history[row.company_id].push({
              drawNo: row.draw_no || '',
              drawDate: row.draw_date || '',
              p1: row.p1 || '----',
              p2: row.p2 || '----',
              p3: row.p3 || '----',
              special: pad4List(row.special, 10),
              consolation: pad4List(row.consolation, 10)
            });
          }
        });
      }
    }
  } catch (_) {}
  return history;
}

async function saveTodayPartialOrFull(resultsMap, todayStr) {
  const url = process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';

  const rows = [];
  for (const comp of COMPANIES) {
    const item = resultsMap?.[comp];
    if (!item || item.drawDate !== todayStr || !hasAnyValid4D(item)) continue;
    rows.push({
      company_id: comp,
      draw_no: item.drawNo || '',
      draw_date: todayStr,
      p1: item.p1,
      p2: item.p2,
      p3: item.p3,
      special: item.special,
      consolation: item.consolation
    });
  }
  if (rows.length === 0) return;

  try {
    await fetch(`${url}/rest/v1/results_4d_history?on_conflict=company_id,draw_date`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(rows)
    });
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const todayStr = getMytDateStr(0);
  const liveWindow = isLiveDrawHourMyt();
  const results = {};
  COMPANIES.forEach(k => { results[k] = emptyBoard(todayStr, ''); });

  // 1. 先加载 Supabase 里的全部历史记录（确保往期记录永远不会消失）
  const history = await loadHistoryFromSupabase();

  // 2. 并发拉取实时开奖接口 + 各家最近开彩接口
  const [liveJson, latestJson, ...opJsons] = await Promise.all([
    fetchJsonSafe(`https://4dlivetoday.com/api/v1/live?_t=${Date.now()}`, 5000),
    fetchJsonSafe(`https://4dlivetoday.com/api/v1/latest?_t=${Date.now()}`, 5000),
    ...COMPANIES.map(comp => fetchJsonSafe(`https://4dlivetoday.com/api/v1/operators/${comp}?limit=15&_t=${Date.now()}`, 5000))
  ]);

  // 合并历史记录
  COMPANIES.forEach((comp, idx) => {
    const list = extractItemsArray(opJsons[idx]);
    for (const item of list) {
      const board = normalizeDrawRecord(item, todayStr);
      if (!board) continue;
      const existIdx = history[comp].findIndex(h => h.drawDate === board.drawDate);
      if (existIdx === -1) history[comp].push(board);
      else history[comp][existIdx] = board;
    }
    history[comp].sort((a, b) => String(b.drawDate).localeCompare(String(a.drawDate)));
  });

  // 合并 /live 和 /latest 里的今日实时出奖号码（出一个合并一个）
  const incomingLive = [...extractItemsArray(latestJson), ...extractItemsArray(liveJson)];
  for (const item of incomingLive) {
    const comp = normalizeCompanyKey(item.operator || item.operator_name || item.company);
    if (!comp) continue;
    const board = normalizeDrawRecord(item, todayStr);
    if (!board) continue;

    const existIdx = history[comp].findIndex(h => h.drawDate === board.drawDate);
    if (existIdx === -1) history[comp].unshift(board);
    else history[comp][existIdx] = board;
  }

  // 决定主面板展示：开奖时段优先展示今日实时进度的盘面；非开奖时段展示最新一期完整结果
  for (const comp of COMPANIES) {
    const todayRec = history[comp].find(h => h.drawDate === todayStr);
    if (todayRec) {
      results[comp] = { ...todayRec };
    } else if (!liveWindow && history[comp][0]) {
      results[comp] = { ...history[comp][0] };
    }
  }

  await saveTodayPartialOrFull(results, todayStr);

  return res.status(200).json({
    ok: true,
    today: todayStr,
    liveWindow,
    results,
    history
  });
};

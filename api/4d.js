const COMPANIES = ['magnum', 'toto', 'damacai', 'sabah88', 'stc', 'cashsweep'];

function emptyBoard() {
  return {
    drawNo: '',
    drawDate: '',
    p1: '----',
    p2: '----',
    p3: '----',
    special: Array(10).fill('----'),
    consolation: Array(10).fill('----')
  };
}

function normalizeCompanyKey(rawName = '') {
  const s = String(rawName).toLowerCase();
  if (s.includes('magnum') || s.includes('万能')) return 'magnum';
  if (s.includes('toto') || s.includes('多多')) return 'toto';
  if (s.includes('damacai') || s.includes('da ma cai') || s.includes('大马彩') || s.includes('pmp')) return 'damacai';
  if (s.includes('sabah') || s.includes('沙巴')) return 'sabah88';
  if (s.includes('stc') || s.includes('sandakan') || s.includes('山打根')) return 'stc';
  if (s.includes('cashsweep') || s.includes('sarawak') || s.includes('砂拉越')) return 'cashsweep';
  return null;
}

function pad4List(arr, count = 10) {
  const clean = (Array.isArray(arr) ? arr : [])
    .map(v => String(v || '').replace(/\D/g, '').slice(0, 4))
    .filter(v => v.length === 4);
  const out = clean.slice(0, count);
  while (out.length < count) out.push('----');
  return out;
}

function fmt4(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 4);
  return d.length === 4 ? d : '----';
}

function getMytDateStr() {
  const now = new Date(Date.now() + 8 * 3600000);
  return now.toISOString().slice(0, 10);
}

async function fetchFromPublic4DApi() {
  const sources = [
    'https://api.4dnum.com/api/v1/results',
    'https://4dresult.api.my/latest.json'
  ];

  for (const url of sources) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const json = await r.json();

      const map = {};
      COMPANIES.forEach(k => { map[k] = emptyBoard(); });

      const items = Array.isArray(json)
        ? json
        : (Array.isArray(json?.data) ? json.data : (Array.isArray(json?.results) ? json.results : []));

      let matched = 0;
      for (const item of items) {
        const key = normalizeCompanyKey(item.company || item.name || item.code || item.id);
        if (!key) continue;
        map[key] = {
          drawNo: String(item.draw_no || item.drawNo || item.draw || ''),
          drawDate: String(item.draw_date || item.drawDate || item.date || getMytDateStr()),
          p1: fmt4(item.p1 || item.first || item['1st']),
          p2: fmt4(item.p2 || item.second || item['2nd']),
          p3: fmt4(item.p3 || item.third || item['3rd']),
          special: pad4List(item.special || item.specials, 10),
          consolation: pad4List(item.consolation || item.consolations, 10)
        };
        if (map[key].p1 !== '----') matched++;
      }

      if (matched > 0) {
        return { source: url, results: map };
      }
    } catch (_) {}
  }
  return null;
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co',
    key: process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU'
  };
}

async function fetchFromSupabaseLatest() {
  const { url, key } = getSupabaseConfig();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const r = await fetch(`${url}/rest/v1/results_4d?select=*`, {
      signal: controller.signal,
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const map = {};
    COMPANIES.forEach(k => { map[k] = emptyBoard(); });
    for (const row of rows) {
      const comp = normalizeCompanyKey(row.company_id || row.company || row.name);
      if (!comp) continue;
      map[comp] = {
        drawNo: String(row.draw_no || ''),
        drawDate: String(row.draw_date || getMytDateStr()),
        p1: fmt4(row.p1),
        p2: fmt4(row.p2),
        p3: fmt4(row.p3),
        special: pad4List(row.special, 10),
        consolation: pad4List(row.consolation, 10)
      };
    }
    return { source: 'supabase:results_4d', results: map };
  } catch (_) {
    return null;
  }
}

// 自动把有效开奖结果归档到 results_4d_history（遇到同 company_id + draw_date 自动跳过）
async function archiveResultsToHistory(resultsMap) {
  const { url, key } = getSupabaseConfig();
  const rows = [];
  for (const comp of COMPANIES) {
    const item = resultsMap?.[comp];
    if (!item || !/^\d{4}$/.test(item.p1)) continue;
    rows.push({
      company_id: comp,
      draw_no: item.drawNo || '',
      draw_date: item.drawDate || getMytDateStr(),
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
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify(rows)
    });
  } catch (_) {}
}

// 读取各机构最近 20 期历史记录
async function fetchHistoryByCompany() {
  const { url, key } = getSupabaseConfig();
  const historyMap = {};
  COMPANIES.forEach(k => { historyMap[k] = []; });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const r = await fetch(
      `${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc,id.desc&limit=120`,
      {
        signal: controller.signal,
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
      }
    );
    clearTimeout(timer);
    if (!r.ok) return historyMap;
    const rows = await r.json();
    if (!Array.isArray(rows)) return historyMap;

    for (const row of rows) {
      const comp = normalizeCompanyKey(row.company_id);
      if (!comp || historyMap[comp].length >= 20) continue;
      historyMap[comp].push({
        id: row.id,
        drawNo: String(row.draw_no || ''),
        drawDate: String(row.draw_date || ''),
        p1: fmt4(row.p1),
        p2: fmt4(row.p2),
        p3: fmt4(row.p3),
        special: pad4List(row.special, 10),
        consolation: pad4List(row.consolation, 10)
      });
    }
  } catch (_) {}

  return historyMap;
}

let cachePayload = null;
let cacheTime = 0;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const now = Date.now();
  if (cachePayload && now - cacheTime < 2 * 60 * 1000) {
    return res.status(200).json(cachePayload);
  }

  const emptyMap = {};
  COMPANIES.forEach(k => { emptyMap[k] = emptyBoard(); });

  const liveData = await fetchFromPublic4DApi();
  const finalData = liveData || (await fetchFromSupabaseLatest()) || { source: 'none', results: emptyMap };

  await archiveResultsToHistory(finalData.results);
  const history = await fetchHistoryByCompany();

  // 如果最新接口没拿到数，但历史表里有最新一期，自动用历史最新一期兜底展示
  for (const comp of COMPANIES) {
    if (finalData.results[comp].p1 === '----' && history[comp]?.length > 0) {
      finalData.results[comp] = { ...history[comp][0] };
    }
  }

  cachePayload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    ...finalData,
    history
  };
  cacheTime = now;

  return res.status(200).json(cachePayload);
};

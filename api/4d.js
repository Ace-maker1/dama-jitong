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

function getMytDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
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

function fmt4(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 4);
  return d.length === 4 ? d : '----';
}

function pad4List(arr, count = 10) {
  const clean = (Array.isArray(arr) ? arr : [])
    .map(v => fmt4(v))
    .filter(v => v !== '----');
  const out = clean.slice(0, count);
  while (out.length < count) out.push('----');
  return out;
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co',
    key: process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU'
  };
}

// 尝试从公开 JSON 接口抓取最新开奖
async function fetchFromJsonSources(todayStr) {
  const urls = [
    'https://api.4dnum.com/api/v1/results',
    'https://4dresult.api.my/latest.json'
  ];

  for (const url of urls) {
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
      const items = Array.isArray(json)
        ? json
        : (Array.isArray(json?.data) ? json.data : (Array.isArray(json?.results) ? json.results : []));

      const map = {};
      COMPANIES.forEach(k => { map[k] = emptyBoard(todayStr, ''); });

      let hitCount = 0;
      for (const item of items) {
        const key = normalizeCompanyKey(item.company || item.name || item.code || item.id);
        if (!key) continue;
        const p1 = fmt4(item.p1 || item.first || item['1st']);
        const p2 = fmt4(item.p2 || item.second || item['2nd']);
        const p3 = fmt4(item.p3 || item.third || item['3rd']);
        map[key] = {
          drawNo: String(item.draw_no || item.drawNo || item.draw || ''),
          drawDate: String(item.draw_date || item.drawDate || item.date || todayStr),
          p1,
          p2,
          p3,
          special: pad4List(item.special || item.specials, 10),
          consolation: pad4List(item.consolation || item.consolations, 10)
        };
        if (p1 !== '----') hitCount++;
      }

      if (hitCount > 0) {
        return { source: url, results: map };
      }
    } catch (_) {}
  }
  return null;
}

// 自动把有效开奖按 (company_id, draw_date) 存入历史表，每天一条
async function saveDailyHistory(resultsMap, fallbackDate) {
  const { url, key } = getSupabaseConfig();
  const rows = [];
  for (const comp of COMPANIES) {
    const item = resultsMap?.[comp];
    if (!item || !/^\d{4}$/.test(item.p1)) continue;
    rows.push({
      company_id: comp,
      draw_no: item.drawNo || '',
      draw_date: item.drawDate || fallbackDate,
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
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(rows)
    });
  } catch (_) {}
}

// 读取各机构历史记录（按日期倒序）
async function loadHistoryMap() {
  const { url, key } = getSupabaseConfig();
  const map = {};
  COMPANIES.forEach(k => { map[k] = []; });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const r = await fetch(
      `${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc,id.desc&limit=180`,
      {
        signal: controller.signal,
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
      }
    );
    clearTimeout(timer);
    if (!r.ok) return map;
    const rows = await r.json();
    if (!Array.isArray(rows)) return map;

    for (const row of rows) {
      const comp = normalizeCompanyKey(row.company_id);
      if (!comp || map[comp].length >= 30) continue;
      map[comp].push({
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

  return map;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const todayStr = getMytDateStr(0);
  const results = {};
  COMPANIES.forEach(k => { results[k] = emptyBoard(todayStr, ''); });

  // 1. 先尝试抓最新开奖
  const fetched = await fetchFromJsonSources(todayStr);
  if (fetched && fetched.results) {
    for (const comp of COMPANIES) {
      if (fetched.results[comp]?.p1 !== '----') {
        results[comp] = fetched.results[comp];
      }
    }
    await saveDailyHistory(results, todayStr);
  }

  // 2. 读历史库（含今天刚存进去的 + 往期每天记录）
  const history = await loadHistoryMap();

  // 3. 若某家机构当天还没抓到，优先用历史库里最新的一期显示（隔天自动更新时也始终有最新开奖号）
  for (const comp of COMPANIES) {
    if (results[comp].p1 === '----' && history[comp] && history[comp].length > 0) {
      results[comp] = { ...history[comp][0] };
    }
  }

  return res.status(200).json({
    ok: true,
    today: todayStr,
    source: fetched ? fetched.source : 'history_or_pending',
    results,
    history
  });
};

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
  try {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const myt = new Date(utc + 8 * 3600000 + offsetDays * 86400000);
    return myt.toISOString().slice(0, 10);
  } catch (_) {
    return '2026-11-21';
  }
}

function normalizeCompanyKey(raw = '') {
  const s = String(raw).toLowerCase().trim();
  if (s === 'magnum' || s.includes('magnum') || s.includes('万能')) return 'magnum';
  if (s === 'toto' || s.includes('toto') || s.includes('多多')) return 'toto';
  if (s === 'damacai' || s.includes('damacai') || s.includes('da ma cai') || s.includes('大马彩') || s.includes('pmp')) return 'damacai';
  if (s === 'sabah88' || s.includes('sabah') || s.includes('diriwan') || s.includes('沙巴')) return 'sabah88';
  if (s === 'stc' || s.includes('stc') || s.includes('sandakan') || s.includes('山打根')) return 'stc';
  if (s === 'cashsweep' || s.includes('cashsweep') || s.includes('sarawak') || s.includes('砂拉越')) return 'cashsweep';
  return null;
}

function fmt4(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 4);
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
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU'
  };
}

async function fetchJsonSafe(url, options = {}, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 若配置了自定义可靠数据源接口（环境变量 FOUR_D_FEED_URL），优先自动拉取
async function fetchCustomFeed(todayStr) {
  const feedUrl = process.env.FOUR_D_FEED_URL;
  if (!feedUrl) return null;

  const headers = { Accept: 'application/json' };
  if (process.env.FOUR_D_FEED_TOKEN) {
    headers.Authorization = `Bearer ${process.env.FOUR_D_FEED_TOKEN}`;
  }

  const data = await fetchJsonSafe(feedUrl, { headers }, 6000);
  if (!data) return null;

  const map = {};
  COMPANIES.forEach(k => { map[k] = emptyBoard(todayStr, ''); });

  const list = Array.isArray(data)
    ? data
    : (Array.isArray(data.results) ? data.results : (Array.isArray(data.data) ? data.data : []));

  for (const item of list) {
    const key = normalizeCompanyKey(item.company_id || item.company || item.name || item.code);
    if (!key) continue;
    map[key] = {
      drawNo: String(item.draw_no || item.drawNo || ''),
      drawDate: String(item.draw_date || item.drawDate || todayStr),
      p1: fmt4(item.p1 ?? item.first ?? item['1st']),
      p2: fmt4(item.p2 ?? item.second ?? item['2nd']),
      p3: fmt4(item.p3 ?? item.third ?? item['3rd']),
      special: pad4List(item.special ?? item.specials, 10),
      consolation: pad4List(item.consolation ?? item.consolations, 10)
    };
  }

  return map;
}

// 写入 / 更新历史记录表 results_4d_history（按 company_id + draw_date 每天一条）
async function upsertHistoryRows(records, fallbackDate) {
  const { url, key } = getSupabaseConfig();
  const rows = [];

  for (const rec of records) {
    const comp = normalizeCompanyKey(rec.company_id || rec.company);
    if (!comp) continue;
    const p1 = fmt4(rec.p1);
    if (p1 === '----') continue;

    rows.push({
      company_id: comp,
      draw_no: String(rec.draw_no || rec.drawNo || ''),
      draw_date: String(rec.draw_date || rec.drawDate || fallbackDate),
      p1,
      p2: fmt4(rec.p2),
      p3: fmt4(rec.p3),
      special: pad4List(rec.special, 10),
      consolation: pad4List(rec.consolation, 10)
    });
  }

  if (rows.length === 0) return { ok: false, count: 0 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${url}/rest/v1/results_4d_history?on_conflict=company_id,draw_date`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(rows)
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return { ok: false, count: 0, error: errText };
    }
    const saved = await r.json().catch(() => rows);
    return { ok: true, count: Array.isArray(saved) ? saved.length : rows.length };
  } catch (err) {
    return { ok: false, count: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// 从 results_4d_history 读取最近历史（按日期倒序）
async function loadHistoryMap() {
  const { url, key } = getSupabaseConfig();
  const map = {};
  COMPANIES.forEach(k => { map[k] = []; });

  const rows = await fetchJsonSafe(
    `${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc,id.desc&limit=180`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    },
    5000
  );

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

  return map;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const todayStr = getMytDateStr(0);

  // POST：供自动化脚本/数据源推送或批量归档开奖结果
  if (req.method === 'POST') {
    const syncSecret = process.env.FOUR_D_SYNC_KEY;
    if (syncSecret) {
      const provided =
        req.headers['x-api-key'] ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (provided !== syncSecret) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const incoming = Array.isArray(body.results)
        ? body.results
        : (Array.isArray(body) ? body : [body]);

      const saveRes = await upsertHistoryRows(incoming, todayStr);
      const history = await loadHistoryMap();

      return res.status(200).json({
        ok: saveRes.ok,
        savedCount: saveRes.count,
        today: todayStr,
        history,
        error: saveRes.error || undefined
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Invalid JSON' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const results = {};
  const history = {};
  COMPANIES.forEach(k => {
    results[k] = emptyBoard(todayStr, '');
    history[k] = [];
  });

  try {
    // 1. 如果配置了稳定 JSON Feed，自动拉取并写入历史
    const feedMap = await fetchCustomFeed(todayStr);
    if (feedMap) {
      const feedArray = COMPANIES.map(k => ({ company_id: k, ...feedMap[k] }));
      await upsertHistoryRows(feedArray, todayStr);
    }

    // 2. 从历史表读取最新与往期记录
    const loaded = await loadHistoryMap();
    for (const comp of COMPANIES) {
      history[comp] = loaded[comp] || [];
      if (feedMap && feedMap[comp] && feedMap[comp].p1 !== '----') {
        results[comp] = feedMap[comp];
      } else if (history[comp].length > 0) {
        // 自动显示最新一期（隔天自动更新为最新入库期次）
        results[comp] = { ...history[comp][0] };
      }
    }

    return res.status(200).json({
      ok: true,
      today: todayStr,
      source: feedMap ? 'custom-feed + supabase-history' : 'supabase-history',
      results,
      history
    });
  } catch (_) {
    return res.status(200).json({
      ok: true,
      today: todayStr,
      source: 'safe-fallback',
      results,
      history
    });
  }
};

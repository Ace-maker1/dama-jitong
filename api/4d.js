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
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'magnum' || s.includes('magnum')) return 'magnum';
  if (s === 'toto' || s.includes('toto')) return 'toto';
  if (s === 'damacai' || s.includes('da ma cai') || s.includes('damacai')) return 'damacai';
  if (s === 'sabah88' || s.includes('sabah')) return 'sabah88';
  if (s === 'stc' || s.includes('sandakan')) return 'stc';
  if (s === 'cashsweep' || s.includes('sarawak')) return 'cashsweep';
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

function normalizeDrawRecord(item, fallbackDate = '') {
  if (!item || typeof item !== 'object') return null;

  const p1 = fmt4(item.first ?? item.p1 ?? item['1st']);
  const p2 = fmt4(item.second ?? item.p2 ?? item['2nd']);
  const p3 = fmt4(item.third ?? item.p3 ?? item['3rd']);

  if (p1 === '----' && p2 === '----' && p3 === '----') return null;

  return {
    drawNo: String(item.draw_no ?? item.drawNo ?? ''),
    drawDate: String(item.date ?? item.draw_date ?? fallbackDate).slice(0, 10),
    p1,
    p2,
    p3,
    special: pad4List(item.special, 10),
    consolation: pad4List(item.consolation, 10)
  };
}

function extractItemsArray(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data?.results)) return payload.data.results;
  if (Array.isArray(payload.data?.draws)) return payload.data.draws;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload.data && typeof payload.data === 'object' && (payload.data.first || payload.data.p1)) {
    return [payload.data];
  }
  return [];
}

async function fetchJsonSafe(url, ms = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
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

// 查询已存在的 (company_id, draw_date) 组合，用于判断是否为全新一期开奖
async function getExistingDrawKeys(url, key, rows) {
  const existing = new Set();
  const dates = [...new Set(rows.map(r => r.draw_date).filter(Boolean))];
  if (dates.length === 0) return existing;

  try {
    const inList = dates.map(d => `"${d}"`).join(',');
    const endpoint = `${url}/rest/v1/results_4d_history?select=company_id,draw_date&draw_date=in.(${encodeURIComponent(inList)})`;
    const resp = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data)) {
        data.forEach(row => existing.add(`${row.company_id}_${row.draw_date}`));
      }
    }
  } catch (_) {}
  return existing;
}

// 发送合规的 4D 开奖更新通知（仅在新一期入库时触发一次）
async function send4DUpdatePush(newDraws, drawDate) {
  const appId = process.env.ONESIGNAL_APP_ID;
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !restApiKey || newDraws.length === 0) return false;

  try {
    const resp = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${restApiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        included_segments: ['All'],
        headings: {
          en: '4D Draw Results Updated',
          zh: '4D 开奖通知',
          ms: 'Keputusan 4D Dikemas Kini'
        },
        contents: {
          en: `4D draw results (${drawDate}) are updated. Tap to view latest results.`,
          zh: `今晚 4D 开奖号码已更新，点击查看最新开奖结果。`,
          ms: `Keputusan 4D (${drawDate}) telah dikemas kini. Tekan untuk semak.`
        },
        url: 'https://damajitong.com/4d.html',
        data: { route: '/4d.html', drawDate, operators: newDraws }
      })
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

// 写入 Supabase 历史表，并在检测到全新开奖期数时触发推送
async function saveToSupabaseHistory(resultsMap, fallbackDate) {
  const url = process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';

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
  if (rows.length === 0) return { pushed: false, newCount: 0 };

  const existingKeys = await getExistingDrawKeys(url, key, rows);
  const brandNewRows = rows.filter(r => !existingKeys.has(`${r.company_id}_${r.draw_date}`));

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

  let pushed = false;
  if (brandNewRows.length > 0) {
    const latestDate = brandNewRows[0].draw_date || fallbackDate;
    pushed = await send4DUpdatePush(brandNewRows.map(r => r.company_id), latestDate);
  }

  return { pushed, newCount: brandNewRows.length };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const todayStr = getMytDateStr(0);
  const results = {};
  const history = {};
  COMPANIES.forEach(k => {
    results[k] = emptyBoard(todayStr, '');
    history[k] = [];
  });

  try {
    const [latestJson, ...opJsons] = await Promise.all([
      fetchJsonSafe('https://4dlivetoday.com/api/v1/latest', 6500),
      ...COMPANIES.map(comp => fetchJsonSafe(`https://4dlivetoday.com/api/v1/operators/${comp}?limit=15`, 6000))
    ]);

    COMPANIES.forEach((comp, idx) => {
      const list = extractItemsArray(opJsons[idx]);
      const seen = new Set();
      for (const item of list) {
        const board = normalizeDrawRecord(item, todayStr);
        if (!board || board.p1 === '----') continue;
        const uid = `${board.drawDate}_${board.drawNo}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        history[comp].push(board);
      }
      history[comp].sort((a, b) => String(b.drawDate).localeCompare(String(a.drawDate)));
      if (history[comp].length > 0) {
        results[comp] = { ...history[comp][0] };
      }
    });

    const latestItems = extractItemsArray(latestJson);
    for (const item of latestItems) {
      const comp = normalizeCompanyKey(item.operator || item.operator_name);
      if (!comp) continue;
      const board = normalizeDrawRecord(item, todayStr);
      if (!board || board.p1 === '----') continue;

      results[comp] = board;
      const existIdx = history[comp].findIndex(h => h.drawDate === board.drawDate);
      if (existIdx === -1) {
        history[comp].unshift(board);
      } else {
        history[comp][existIdx] = board;
      }
    }

    const syncMeta = await saveToSupabaseHistory(results, todayStr);
    const hitCount = COMPANIES.filter(c => results[c].p1 !== '----').length;

    return res.status(200).json({
      ok: true,
      today: todayStr,
      source: hitCount > 0 ? '4dlivetoday.com/api/v1' : 'pending',
      pushTriggered: syncMeta.pushed,
      results,
      history
    });
  } catch (_) {
    return res.status(200).json({
      ok: true,
      today: todayStr,
      source: 'safe-fallback',
      pushTriggered: false,
      results,
      history
    });
  }
};

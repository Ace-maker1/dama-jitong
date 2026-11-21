const COMPANIES = ['magnum', 'toto', 'damacai', 'sabah88', 'stc', 'cashsweep'];

const OPERATOR_SLUGS = {
  magnum: ['magnum', 'magnum4d'],
  toto: ['toto', 'sportstoto'],
  damacai: ['damacai', 'pmp'],
  sabah88: ['sabah88', 'sabah', 'diriwan'],
  stc: ['stc', 'sandakan'],
  cashsweep: ['cashsweep', 'sarawak']
};

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
  if (s.includes('magnum')) return 'magnum';
  if (s.includes('toto')) return 'toto';
  if (s.includes('damacai') || s.includes('da_ma_cai') || s.includes('pmp')) return 'damacai';
  if (s.includes('sabah') || s.includes('diriwan')) return 'sabah88';
  if (s.includes('stc') || s.includes('sandakan')) return 'stc';
  if (s.includes('cashsweep') || s.includes('sarawak')) return 'cashsweep';
  return null;
}

function fmt4(v) {
  if (v && typeof v === 'object') {
    v = v.number ?? v.num ?? v.value ?? v.code ?? '';
  }
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

// 兼容多种字段结构的开奖对象标准化
function normalizeDrawRecord(item, fallbackDate = '') {
  if (!item || typeof item !== 'object') return null;

  const p1 = fmt4(
    item.p1 ?? item.first ?? item['1st'] ?? item.prize_1 ?? item.prizes?.first ?? item.prizes?.['1st'] ?? item.numbers?.[0]
  );
  const p2 = fmt4(
    item.p2 ?? item.second ?? item['2nd'] ?? item.prize_2 ?? item.prizes?.second ?? item.prizes?.['2nd'] ?? item.numbers?.[1]
  );
  const p3 = fmt4(
    item.p3 ?? item.third ?? item['3rd'] ?? item.prize_3 ?? item.prizes?.third ?? item.prizes?.['3rd'] ?? item.numbers?.[2]
  );

  const rawSpecial =
    item.special ?? item.specials ?? item.starter ?? item.starters ??
    item.prizes?.special ?? item.prizes?.starter ??
    (Array.isArray(item.numbers) ? item.numbers.slice(3, 13) : []);

  const rawConsolation =
    item.consolation ?? item.consolations ??
    item.prizes?.consolation ??
    (Array.isArray(item.numbers) ? item.numbers.slice(13, 23) : []);

  if (p1 === '----' && p2 === '----' && p3 === '----') return null;

  return {
    drawNo: String(item.draw_no ?? item.drawNo ?? item.draw ?? ''),
    drawDate: String(item.date ?? item.draw_date ?? item.drawDate ?? fallbackDate).slice(0, 10),
    p1,
    p2,
    p3,
    special: pad4List(rawSpecial, 10),
    consolation: pad4List(rawConsolation, 10)
  };
}

function extractItemsArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.draws)) return payload.draws;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.results && typeof payload.results === 'object') {
    return Object.entries(payload.results).map(([k, v]) => ({ operator: k, ...(v || {}) }));
  }
  if (payload.operator || payload.p1 || payload.first || payload['1st']) {
    return [payload];
  }
  return [];
}

async function fetchJsonSafe(url, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DaMaJiTong-4D/1.0'
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

async function fetchOperatorHistoryFromApi(comp, todayStr) {
  const slugs = OPERATOR_SLUGS[comp] || [comp];
  for (const slug of slugs) {
    const json = await fetchJsonSafe(`https://4dlivetoday.com/api/v1/operators/${slug}?limit=15`, 5500);
    const list = extractItemsArray(json);
    const boards = [];
    for (const item of list) {
      const board = normalizeDrawRecord({ operator: comp, ...item }, todayStr);
      if (board && board.p1 !== '----') {
        boards.push(board);
      }
    }
    if (boards.length > 0) {
      boards.sort((a, b) => String(b.drawDate).localeCompare(String(a.drawDate)));
      return boards;
    }
  }
  return [];
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
    // 并发拉取最新全盘结果 + 6家各自历史多期
    const [latestJson, ...opHistories] = await Promise.all([
      fetchJsonSafe('https://4dlivetoday.com/api/v1/latest', 6000),
      ...COMPANIES.map(comp => fetchOperatorHistoryFromApi(comp, todayStr))
    ]);

    COMPANIES.forEach((comp, idx) => {
      if (Array.isArray(opHistories[idx]) && opHistories[idx].length > 0) {
        history[comp] = opHistories[idx];
        results[comp] = { ...opHistories[idx][0] };
      }
    });

    const latestItems = extractItemsArray(latestJson);
    for (const item of latestItems) {
      const comp = normalizeCompanyKey(item.operator || item.operator_name || item.company || item.name);
      if (!comp) continue;
      const board = normalizeDrawRecord(item, todayStr);
      if (!board || board.p1 === '----') continue;

      results[comp] = board;
      const existsIdx = history[comp].findIndex(h => h.drawDate === board.drawDate && h.drawNo === board.drawNo);
      if (existsIdx === -1) {
        history[comp].unshift(board);
      } else {
        history[comp][existsIdx] = board;
      }
    }

    const hitCount = COMPANIES.filter(c => results[c].p1 !== '----').length;

    return res.status(200).json({
      ok: true,
      today: todayStr,
      source: hitCount > 0 ? '4dlivetoday.com/api/v1' : 'pending',
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

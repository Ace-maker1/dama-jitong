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
    const d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
  } catch (_) {
    return '2026-11-21';
  }
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

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function fetchWithTimeout(url, options = {}, ms = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { ...HEADERS, ...(options.headers || {}) }
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function htmlToCleanText(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ /gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseChunkBoard(chunk, fallbackDate) {
  const drawNo = chunk.match(/(?:No\.?|Draw\s*No\.?)?\s*(\d{3,4}\/\d{2})\b/i)?.[1] || '';
  const dmy = chunk.match(/\b(\d{2})[-/](\d{2})[-/](20\d{2})\b/);
  const iso = chunk.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const drawDate = iso ? iso[1] : (dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : fallbackDate);

  // 优先按具名奖项提取
  const p1Labeled = fmt4(chunk.match(/1st(?:\s*prize)?[\s:,-]*(\d{4}|-{4})/i)?.[1]);
  const p2Labeled = fmt4(chunk.match(/2nd(?:\s*prize)?[\s:,-]*(\d{4}|-{4})/i)?.[1]);
  const p3Labeled = fmt4(chunk.match(/3rd(?:\s*prize)?[\s:,-]*(\d{4}|-{4})/i)?.[1]);

  const specBlock = chunk.match(/(?:special|starter)(?:\s*prizes?)?([\s\S]*?)(?:consolation|1st\s*prize\s*\d{3}|jackpot|$)/i)?.[1] || '';
  const consBlock = chunk.match(/consolation(?:\s*prizes?)?([\s\S]*?)(?:1st\s*prize\s*\d{3}|3d\b|jackpot|$)/i)?.[1] || '';

  const specLabeled = (specBlock.match(/\b(?:\d{4}|-{4})\b/g) || []).slice(0, 10).map(fmt4);
  const consLabeled = (consBlock.match(/\b(?:\d{4}|-{4})\b/g) || []).slice(0, 10).map(fmt4);

  if (p1Labeled !== '----' || p2Labeled !== '----' || p3Labeled !== '----') {
    return {
      drawNo,
      drawDate,
      p1: p1Labeled,
      p2: p2Labeled,
      p3: p3Labeled,
      special: pad4List(specLabeled, 10),
      consolation: pad4List(consLabeled, 10)
    };
  }

  // 兜底：按顺序提取 23 个 4 位数字
  const cleanNums = chunk
    .replace(/\b\d{3,4}\/\d{2}\b/g, ' ')
    .replace(/\b\d{2}[-/]\d{2}[-/]20\d{2}\b/g, ' ')
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b19:00\b/g, ' ')
    .match(/\b\d{4}\b/g) || [];

  if (cleanNums.length >= 23) {
    return {
      drawNo,
      drawDate,
      p1: cleanNums[0],
      p2: cleanNums[1],
      p3: cleanNums[2],
      special: pad4List(cleanNums.slice(3, 13), 10),
      consolation: pad4List(cleanNums.slice(13, 23), 10)
    };
  }

  return null;
}

// 1. 大马彩 Da Ma Cai 官方接口 + 页面
async function fetchDaMaCai(todayStr) {
  try {
    const rawJson = await fetchWithTimeout('https://www.damacai.com.my/callpassresult?pastdate=' + todayStr.replace(/-/g, ''));
    if (rawJson) {
      const json = JSON.parse(rawJson);
      if (json?.link) {
        const detailRaw = await fetchWithTimeout(json.link);
        if (detailRaw) {
          const d = JSON.parse(detailRaw);
          const p1 = fmt4(d['1st'] || d.first);
          if (p1 !== '----') {
            return {
              drawNo: String(d.drawno || ''),
              drawDate: todayStr,
              p1,
              p2: fmt4(d['2nd'] || d.second),
              p3: fmt4(d['3rd'] || d.third),
              special: pad4List(d.starter || d.special, 10),
              consolation: pad4List(d.consolation, 10)
            };
          }
        }
      }
    }
  } catch (_) {}

  const html = await fetchWithTimeout('https://www.damacai.com.my/past-draw-result')
    || await fetchWithTimeout('https://www.damacai.com.my/');
  if (!html) return null;
  const board = parseChunkBoard(htmlToCleanText(html), todayStr);
  return board && board.p1 !== '----' ? board : null;
}

// 2. 从综合开奖页及东马开奖页提取 6 家公司
async function fetchFromMirrorPages(todayStr) {
  const mirrors = [
    'https://4d88.com/',
    'https://www.4d88.com/',
    'https://app.4d88.com/loto88-stc-cashsweep.html',
    'https://4d88.co/',
    'https://www.4dmoon.com/',
    'https://4d2ulive.com/'
  ];

  const anchors = [
    { key: 'magnum', re: /Magnum\s*4D/i },
    { key: 'damacai', re: /Da\s*Ma\s*Cai/i },
    { key: 'toto', re: /Sports\s*Toto|Toto\s*4D/i },
    { key: 'sabah88', re: /Sabah\s*(?:Lotto\s*)?88|Diriwan/i },
    { key: 'stc', re: /Sandakan\s*(?:STC\s*)?4D|STC\s*4D/i },
    { key: 'cashsweep', re: /(?:Special\s*)?CashSweep|Sarawak/i }
  ];

  const mergedMap = {};
  const sourcesUsed = [];

  for (const url of mirrors) {
    const html = await fetchWithTimeout(url, {}, 6500);
    if (!html) continue;

    const text = htmlToCleanText(html);
    const positions = anchors
      .map(a => ({ key: a.key, idx: text.search(a.re) }))
      .filter(x => x.idx !== -1)
      .sort((a, b) => a.idx - b.idx);

    if (positions.length === 0) continue;

    let pageHit = false;
    for (let i = 0; i < positions.length; i++) {
      const key = positions[i].key;
      if (mergedMap[key]?.p1 && mergedMap[key].p1 !== '----') continue;

      const start = positions[i].idx;
      const end = i + 1 < positions.length ? Math.min(positions[i + 1].idx, start + 2600) : start + 2600;
      const parsed = parseChunkBoard(text.slice(start, end), todayStr);
      if (parsed && parsed.p1 !== '----') {
        mergedMap[key] = parsed;
        pageHit = true;
      }
    }

    if (pageHit) sourcesUsed.push(url);
  }

  return Object.keys(mergedMap).length > 0
    ? { source: sourcesUsed.join(' + '), results: mergedMap }
    : null;
}

// 自动写入 Supabase 历史库（按 company_id + draw_date 每天自动更新）
async function upsertHistory(resultsMap, fallbackDate) {
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

// 读取各机构历史记录（近 30 期）
async function loadHistoryMap() {
  const { url, key } = getSupabaseConfig();
  const map = {};
  COMPANIES.forEach(k => { map[k] = []; });

  const raw = await fetchWithTimeout(
    `${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc,id.desc&limit=180`,
    { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } },
    4500
  );
  if (!raw) return map;

  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return map;

    for (const row of rows) {
      const comp = String(row.company_id || '').toLowerCase();
      if (!map[comp] || map[comp].length >= 30) continue;
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
  const history = {};
  COMPANIES.forEach(k => {
    results[k] = emptyBoard(todayStr, '');
    history[k] = [];
  });

  try {
    const [mirrorData, dmcData] = await Promise.all([
      fetchFromMirrorPages(todayStr),
      fetchDaMaCai(todayStr)
    ]);

    if (mirrorData?.results) {
      for (const comp of COMPANIES) {
        if (mirrorData.results[comp]?.p1 !== '----') {
          results[comp] = mirrorData.results[comp];
        }
      }
    }

    if (dmcData && dmcData.p1 !== '----') {
      results.damacai = dmcData;
    }

    await upsertHistory(results, todayStr);

    const loadedHistory = await loadHistoryMap();
    for (const comp of COMPANIES) {
      history[comp] = loadedHistory[comp] || [];
      if (results[comp].p1 === '----' && history[comp].length > 0) {
        results[comp] = { ...history[comp][0] };
      }
    }

    return res.status(200).json({
      ok: true,
      today: todayStr,
      source: [mirrorData?.source, dmcData ? 'damacai-official' : null].filter(Boolean).join(' + ') || 'history_or_pending',
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

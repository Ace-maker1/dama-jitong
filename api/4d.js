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
  if (s.includes('sabah') || s.includes('diriwan') || s.includes('沙巴')) return 'sabah88';
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

// 从公开 4D 成绩汇总网页解析各家公司最新开奖号码（每家共 23 个 4 位号：1+1+1+10+10）
function parse4DFromHtml(html, fallbackDate) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ /gi, ' ')
    .replace(/\s+/g, ' ');

  const anchors = [
    { key: 'magnum', patterns: [/Magnum\s*4D/i, /万能/i] },
    { key: 'damacai', patterns: [/Da\s*Ma\s*Cai/i, /大马彩/i, /1\+3D/i] },
    { key: 'toto', patterns: [/Sports\s*Toto/i, /Toto\s*4D/i, /多多/i] },
    { key: 'sabah88', patterns: [/Sabah\s*88/i, /Diriwan/i, /沙巴/i] },
    { key: 'stc', patterns: [/Sandakan\s*4D/i, /STC\s*4D/i, /山打根/i] },
    { key: 'cashsweep', patterns: [/Special\s*CashSweep/i, /CashSweep/i, /砂拉越/i] }
  ];

  // 定位每家公司在纯文本中的出现位置
  const found = [];
  for (const item of anchors) {
    let bestIdx = -1;
    for (const re of item.patterns) {
      const m = re.exec(text);
      if (m && (bestIdx === -1 || m.index < bestIdx)) {
        bestIdx = m.index;
      }
    }
    if (bestIdx !== -1) {
      found.push({ key: item.key, index: bestIdx });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const map = {};
  COMPANIES.forEach(k => { map[k] = emptyBoard(fallbackDate, ''); });

  let hitCount = 0;
  for (let i = 0; i < found.length; i++) {
    const start = found[i].index;
    const end = i + 1 < found.length ? Math.min(found[i + 1].index, start + 2600) : start + 2600;
    const chunk = text.slice(start, end);

    // 提取期号（例如 5489/26 或 123/26）和日期（例如 21/11/2026 或 2026-11-21）
    const drawNoMatch = chunk.match(/\b(\d{3,4}\/\d{2})\b/);
    const isoDateMatch = chunk.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const dmyDateMatch = chunk.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);

    let parsedDate = fallbackDate;
    if (isoDateMatch) {
      parsedDate = isoDateMatch[1];
    } else if (dmyDateMatch) {
      parsedDate = `${dmyDateMatch[3]}-${dmyDateMatch[2]}-${dmyDateMatch[1]}`;
    }

    // 过滤掉年份(2025/2026)和期号里的4位数字，按顺序提取23个4D开奖号码
    const cleanedForNums = chunk
      .replace(/\b\d{3,4}\/\d{2}\b/g, ' ')
      .replace(/\b\d{2}\/\d{2}\/20\d{2}\b/g, ' ')
      .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b19:00\b/g, ' ');

    const nums = cleanedForNums.match(/\b\d{4}\b/g) || [];
    if (nums.length >= 23) {
      map[found[i].key] = {
        drawNo: drawNoMatch ? drawNoMatch[1] : '',
        drawDate: parsedDate,
        p1: nums[0],
        p2: nums[1],
        p3: nums[2],
        special: nums.slice(3, 13),
        consolation: nums.slice(13, 23)
      };
      hitCount++;
    }
  }

  return hitCount > 0 ? map : null;
}

async function fetchLive4DResults(todayStr) {
  const pages = [
    'https://www.4d88.com/',
    'https://www.check4d.org/',
    'https://www.4dking.com/'
  ];

  for (const url of pages) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const html = await r.text();
      const parsed = parse4DFromHtml(html, todayStr);
      if (parsed) {
        return { source: url, results: parsed };
      }
    } catch (_) {}
  }
  return null;
}

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

  const fetched = await fetchLive4DResults(todayStr);
  if (fetched && fetched.results) {
    for (const comp of COMPANIES) {
      if (fetched.results[comp]?.p1 !== '----') {
        results[comp] = fetched.results[comp];
      }
    }
    await saveDailyHistory(results, todayStr);
  }

  const history = await loadHistoryMap();

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

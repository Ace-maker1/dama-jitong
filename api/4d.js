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
    return await fetch(url, { ...options, signal: controller.signal, headers: { ...HEADERS, ...(options.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

// 1. 大马彩 Da Ma Cai 官方 JSON 接口
async function fetchDaMaCai(todayStr) {
  try {
    const r = await fetchWithTimeout('https://www.damacai.com.my/callpassresult?pastdate=' + todayStr.replace(/-/g, ''));
    if (r.ok) {
      const text = await r.text();
      const json = JSON.parse(text);
      const link = json?.link;
      if (link) {
        const r2 = await fetchWithTimeout(link);
        if (r2.ok) {
          const d = await r2.json();
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

  // 备用：抓取大马彩公开结果页 HTML
  try {
    const r = await fetchWithTimeout('https://www.damacai.com.my/past-draw-result');
    if (r.ok) {
      const html = await r.text();
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const drawNoMatch = text.match(/draw\s*no\.?\s*[:\-]?\s*(\d{3,4}\/\d{2})/i);
      const dmyMatch = text.match(/draw\s*date\s*[:\-]?\s*(\d{2})\/(\d{2})\/(20\d{2})/i);
      const drawDate = dmyMatch ? `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}` : todayStr;
      const p1 = text.match(/1st\s*prize\s*(\d{4})/i)?.[1] || '----';
      const p2 = text.match(/2nd\s*prize\s*(\d{4})/i)?.[1] || '----';
      const p3 = text.match(/3rd\s*prize\s*(\d{4})/i)?.[1] || '----';
      const starterSec = text.match(/starter\s*prizes([\s\S]*?)consolation\s*prizes/i)?.[1] || '';
      const consSec = text.match(/consolation\s*prizes([\s\S]*?)(?:1st\s*prize\s*\d{3}|1\+3d\s*jackpot)/i)?.[1] || '';
      if (p1 !== '----') {
        return {
          drawNo: drawNoMatch ? drawNoMatch[1] : '',
          drawDate,
          p1,
          p2,
          p3,
          special: pad4List(starterSec.match(/\d{4}/g), 10),
          consolation: pad4List(consSec.match(/\d{4}/g), 10)
        };
      }
    }
  } catch (_) {}
  return null;
}

// 2. 从公开综合 4D 镜像页提取其余各家（Magnum / Toto / Sabah88 / STC / CashSweep）
async function fetchFromMirrorPages(todayStr) {
  const mirrors = [
    'https://4d88.com/',
    'https://www.4d88.com/',
    'https://www.check4d.com/',
    'https://www.check4d.org/',
    'https://www.4dmoon.com/',
    'https://www.gdlotto.net/4d-results/'
  ];

  const anchors = [
    { key: 'magnum', re: /Magnum\s*4D/i },
    { key: 'damacai', re: /Da\s*Ma\s*Cai/i },
    { key: 'toto', re: /Sports\s*Toto/i },
    { key: 'sabah88', re: /Sabah\s*88|Diriwan/i },
    { key: 'stc', re: /Sandakan\s*4D|STC\s*4D/i },
    { key: 'cashsweep', re: /CashSweep|Sarawak/i }
  ];

  for (const url of mirrors) {
    try {
      const r = await fetchWithTimeout(url, {}, 6500);
      if (!r.ok) continue;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ');

      const positions = anchors
        .map(a => ({ key: a.key, idx: text.search(a.re) }))
        .filter(x => x.idx !== -1)
        .sort((a, b) => a.idx - b.idx);

      if (positions.length === 0) continue;

      const foundMap = {};
      let count = 0;

      for (let i = 0; i < positions.length; i++) {
        const start = positions[i].idx;
        const end = i + 1 < positions.length ? Math.min(positions[i + 1].idx, start + 2400) : start + 2400;
        const chunk = text.slice(start, end);

        const drawNo = chunk.match(/\b(\d{3,4}\/\d{2})\b/)?.[1] || '';
        const dmy = chunk.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
        const iso = chunk.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
        const drawDate = iso ? iso[1] : (dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : todayStr);

        const cleanNums = chunk
          .replace(/\b\d{3,4}\/\d{2}\b/g, ' ')
          .replace(/\b\d{2}\/\d{2}\/20\d{2}\b/g, ' ')
          .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
          .replace(/\b19:00\b/g, ' ')
          .match(/\b\d{4}\b/g) || [];

        if (cleanNums.length >= 23) {
          foundMap[positions[i].key] = {
            drawNo,
            drawDate,
            p1: cleanNums[0],
            p2: cleanNums[1],
            p3: cleanNums[2],
            special: cleanNums.slice(3, 13),
            consolation: cleanNums.slice(13, 23)
          };
          count++;
        }
      }

      if (count > 0) {
        return { source: url, results: foundMap };
      }
    } catch (_) {}
  }

  return null;
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

  try {
    const r = await fetchWithTimeout(
      `${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc,id.desc&limit=180`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } },
      4500
    );
    if (!r.ok) return map;
    const rows = await r.json();
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
  COMPANIES.forEach(k => { results[k] = emptyBoard(todayStr, ''); });

  // 并发抓取综合镜像 + 大马彩官方接口
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

  // 自动保存到每天历史表
  await upsertHistory(results, todayStr);

  // 读取历史库，若某家当天尚未出号则自动显示最近一期历史号
  const history = await loadHistoryMap();
  for (const comp of COMPANIES) {
    if (results[comp].p1 === '----' && history[comp]?.length > 0) {
      results[comp] = { ...history[comp][0] };
    }
  }

  return res.status(200).json({
    ok: true,
    today: todayStr,
    source: [mirrorData?.source, dmcData ? 'damacai-official' : null].filter(Boolean).join(' + ') || 'history_fallback',
    results,
    history
  });
};

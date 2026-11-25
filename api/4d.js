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
  return (d === 0 || d === 3 || d === 6) && h >= 19 && h < 21;
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

async function fetchTextSafe(url, ms = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache'
      }
    });
    if (!r.ok) return '';
    return await r.text();
  } catch (_) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// 从直播页面区块中按顺序提取 23 个奖号 (1st, 2nd, 3rd, 10 Special, 10 Consolation)
function parseOperatorBlock(blockHtml, todayStr) {
  if (!blockHtml) return null;

  // 剥离 HTML 标签，按文本 token 提取
  const text = blockHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ /gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 检查日期是否匹配今天（支持 2026-11-25 或 25-11-2026 或 25/11/2026）
  const [yyyy, mm, dd] = todayStr.split('-');
  const datePatterns = [
    `${yyyy}-${mm}-${dd}`,
    `${dd}-${mm}-${yyyy}`,
    `${dd}/${mm}/${yyyy}`
  ];
  const isToday = datePatterns.some(p => text.includes(p));
  if (!isToday) return null;

  // 提取期号 Draw No（例如 454/26 或 5678/26）
  const drawNoMatch = text.match(/\b(\d{3,4}\/\d{2})\b/);
  const drawNo = drawNoMatch ? drawNoMatch[1] : '';

  // 按位置定位 1st / 2nd / 3rd / Special / Consolation 后的 4 位数字或占位符 ----
  const extractAfter = (labelRegex, count) => {
    const m = text.match(labelRegex);
    if (!m) return Array(count).fill('----');
    const sub = text.slice(m.index + m[0].length, m.index + m[0].length + 450);
    const tokens = sub.match(/\b\d{4}\b|----/g) || [];
    return pad4List(tokens, count);
  };

  const p1 = extractAfter(/(?:1st\s*Prize|1ST|首奖|头奖)/i, 1)[0];
  const p2 = extractAfter(/(?:2nd\s*Prize|2ND|二奖)/i, 1)[0];
  const p3 = extractAfter(/(?:3rd\s*Prize|3RD|三奖)/i, 1)[0];
  const special = extractAfter(/(?:Special|特别奖)/i, 10);
  const consolation = extractAfter(/(?:Consolation|安慰奖)/i, 10);

  const board = { drawNo, drawDate: todayStr, p1, p2, p3, special, consolation };
  return hasAnyValid4D(board) ? board : null;
}

// 切分主流 4D 直播页面各家运营商区块
function scrapeLiveFromHtml(html, todayStr) {
  const out = {};
  if (!html) return out;

  const markers = [
    { key: 'magnum', rx: /Magnum\s*4D/i },
    { key: 'damacai', rx: /Da\s*Ma\s*Cai|PMP\s*1\+3D/i },
    { key: 'toto', rx: /Sports\s*Toto/i },
    { key: 'sabah88', rx: /Sabah\s*88|Diriwan/i },
    { key: 'stc', rx: /Sandakan\s*STC|STC\s*4D/i },
    { key: 'cashsweep', rx: /CashSweep|Special\s*CashSweep/i }
  ];

  // 找到每个运营商标题在 HTML 中的位置并切片
  const positions = [];
  for (const m of markers) {
    const match = html.match(m.rx);
    if (match && typeof match.index === 'number') {
      positions.push({ key: m.key, idx: match.index });
    }
  }
  positions.sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : start + 18000;
    const slice = html.slice(start, Math.min(end, start + 18000));
    const parsed = parseOperatorBlock(slice, todayStr);
    if (parsed) {
      out[positions[i].key] = parsed;
    }
  }

  return out;
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
          if (history[row.company_id] && history[row.company_id].length < 20) {
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

async function saveTodayToSupabase(resultsMap, todayStr) {
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

  // 1. 并发拉取多个秒级直播源 + 历史数据库
  const [htmlCheck4d, html4d88, history] = await Promise.all([
    fetchTextSafe(`https://www.check4d.com/?_t=${Date.now()}`, 6000),
    fetchTextSafe(`https://www.4d88.com/?_t=${Date.now()}`, 6000),
    loadHistoryFromSupabase()
  ]);

  const liveFromCheck4d = scrapeLiveFromHtml(htmlCheck4d, todayStr);
  const liveFrom4d88 = scrapeLiveFromHtml(html4d88, todayStr);

  for (const comp of COMPANIES) {
    const todayLive = liveFromCheck4d[comp] || liveFrom4d88[comp];
    if (todayLive) {
      results[comp] = todayLive;
      const idx = history[comp].findIndex(h => h.drawDate === todayStr);
      if (idx === -1) history[comp].unshift(todayLive);
      else history[comp][idx] = todayLive;
    } else if (!liveWindow && history[comp][0]) {
      // 非开奖时段，展示最新一期归档成绩
      results[comp] = { ...history[comp][0] };
    }
  }

  await saveTodayToSupabase(results, todayStr);

  const liveHitCount = COMPANIES.filter(c => hasAnyValid4D(results[c])).length;
  return res.status(200).json({
    ok: true,
    today: todayStr,
    liveWindow,
    liveHitCount,
    results,
    history
  });
};

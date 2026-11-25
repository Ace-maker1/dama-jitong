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
  try {
    const myt = new Date(getMytNow().getTime() + offsetDays * 86400000);
    return myt.toISOString().slice(0, 10);
  } catch (_) {
    return '2026-11-25';
  }
}

function isLiveDrawHourMyt() {
  const myt = getMytNow();
  const d = myt.getDay();
  const h = myt.getHours();
  return (d === 0 || d === 3 || d === 6) && h >= 19 && h < 20;
}

function normalizeDateStr(raw = '', fallback = '') {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  // YYYY-MM-DD
  const iso = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  // DD-MM-YYYY 或 DD/MM/YYYY
  const dmy = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return fallback;
}

function normalizeCompanyKey(raw = '') {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'magnum' || s.includes('magnum')) return 'magnum';
  if (s === 'toto' || s.includes('toto')) return 'toto';
  if (s === 'damacai' || s.includes('da ma cai') || s.includes('damacai') || s.includes('pmp')) return 'damacai';
  if (s === 'sabah88' || s.includes('sabah') || s.includes('diriwan')) return 'sabah88';
  if (s === 'stc' || s.includes('sandakan')) return 'stc';
  if (s === 'cashsweep' || s.includes('sarawak') || s.includes('cashsweep')) return 'cashsweep';
  return null;
}

function fmt4(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 4);
  return d.length === 4 ? d : '----';
}

function pad4List(arr, count = 10) {
  const list = Array.isArray(arr)
    ? arr
    : (typeof arr === 'string' ? arr.split(/[\s,|]+/) : []);
  const clean = list.map(v => fmt4(v));
  const out = clean.slice(0, count);
  while (out.length < count) out.push('----');
  return out;
}

function hasAnyValid4D(board) {
  if (!board) return false;
  return [board.p1, board.p2, board.p3, ...(board.special || []), ...(board.consolation || [])]
    .some(n => /^\d{4}$/.test(n));
}

// 合并同一期的两次抓包：已开出的号码绝对不被 ---- 覆盖
function mergeDrawBoards(oldBoard, newBoard) {
  if (!oldBoard) return newBoard;
  if (!newBoard) return oldBoard;
  const pick = (a, b) => (/^\d{4}$/.test(b) ? b : (/^\d{4}$/.test(a) ? a : '----'));
  const mergeArr = (arrA = [], arrB = []) => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      out.push(pick(arrA[i], arrB[i]));
    }
    return out;
  };
  return {
    drawNo: newBoard.drawNo || oldBoard.drawNo || '',
    drawDate: newBoard.drawDate || oldBoard.drawDate || '',
    p1: pick(oldBoard.p1, newBoard.p1),
    p2: pick(oldBoard.p2, newBoard.p2),
    p3: pick(oldBoard.p3, newBoard.p3),
    special: mergeArr(oldBoard.special, newBoard.special),
    consolation: mergeArr(oldBoard.consolation, newBoard.consolation)
  };
}

// 兼容多种字段命名，只要开出任意 1 个号码就保留
function normalizeDrawRecord(item, fallbackDate = '') {
  if (!item || typeof item !== 'object') return null;

  const p1 = fmt4(item.first ?? item.first_prize ?? item.prize1 ?? item.p1 ?? item['1st']);
  const p2 = fmt4(item.second ?? item.second_prize ?? item.prize2 ?? item.p2 ?? item['2nd']);
  const p3 = fmt4(item.third ?? item.third_prize ?? item.prize3 ?? item.p3 ?? item['3rd']);
  const special = pad4List(item.special ?? item.special_prizes ?? item.specials, 10);
  const consolation = pad4List(item.consolation ?? item.consolation_prizes ?? item.consolations, 10);

  const drawDate = normalizeDateStr(item.date ?? item.draw_date ?? item.drawDate, fallbackDate);
  const drawNo = String(item.draw_no ?? item.drawNo ?? item.draw_number ?? '');

  const board = { drawNo, drawDate, p1, p2, p3, special, consolation };
  return hasAnyValid4D(board) ? board : null;
}

// 兼容数组格式 & { magnum: {...}, toto: {...} } 键值对格式
function extractItemsArray(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data?.results)) return payload.data.results;
  if (Array.isArray(payload.data?.draws)) return payload.data.draws;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;

  const targetObj = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
  const extracted = [];
  for (const [k, v] of Object.entries(targetObj)) {
    const compKey = normalizeCompanyKey(k);
    if (compKey && v && typeof v === 'object') {
      extracted.push({ operator: compKey, ...v });
    }
  }
  if (extracted.length > 0) return extracted;

  if (targetObj.first || targetObj.p1 || targetObj.special || targetObj.consolation) {
    return [targetObj];
  }
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

async function loadHistoryFromSupabase() {
  const url = process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co';
  const key = process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';
  const history = { magnum: [], toto: [], damacai: [], sabah88: [], stc: [], cashsweep: [] };

  try {
    const r = await fetch(`${url}/rest/v1/results_4d_history?select=*&order=draw_date.desc&limit=150`, {
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

// 写入 Supabase 历史表，并在检测到全新开奖期数时触发 OneSignal 推送
async function saveToSupabaseHistory(resultsMap, fallbackDate) {
  const url = process.env.SUPABASE_URL || 'https://uhgukdqggvyaepkvlugg.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';

  const rows = [];
  for (const comp of COMPANIES) {
    const item = resultsMap?.[comp];
    if (!item || !hasAnyValid4D(item)) continue;
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
  const liveWindow = isLiveDrawHourMyt();
  const results = {};
  COMPANIES.forEach(k => { results[k] = emptyBoard(todayStr, ''); });

  try {
    // 1. 先加载 Supabase 里的全部历史记录（确保往期记录永远不会消失）
    const history = await loadHistoryFromSupabase();

    // 2. 并发拉取实时开奖接口 + 各家最近开彩接口
    const [liveJson, latestJson, ...opJsons] = await Promise.all([
      fetchJsonSafe(`https://4dlivetoday.com/api/v1/live?_t=${Date.now()}`, 5500),
      fetchJsonSafe(`https://4dlivetoday.com/api/v1/latest?_t=${Date.now()}`, 5500),
      ...COMPANIES.map(comp => fetchJsonSafe(`https://4dlivetoday.com/api/v1/operators/${comp}?limit=15&_t=${Date.now()}`, 5500))
    ]);

    // 合并各家历史记录
    COMPANIES.forEach((comp, idx) => {
      const list = extractItemsArray(opJsons[idx]);
      for (const item of list) {
        const board = normalizeDrawRecord(item, todayStr);
        if (!board) continue;
        const existIdx = history[comp].findIndex(h => h.drawDate === board.drawDate);
        if (existIdx === -1) history[comp].push(board);
        else history[comp][existIdx] = mergeDrawBoards(history[comp][existIdx], board);
      }
      history[comp].sort((a, b) => String(b.drawDate).localeCompare(String(a.drawDate)));
    });

    // 合并 /live 和 /latest 里的实时出奖号码（出一个合并一个）
    const incomingLive = [...extractItemsArray(latestJson), ...extractItemsArray(liveJson)];
    for (const item of incomingLive) {
      const comp = normalizeCompanyKey(item.operator || item.operator_name || item.company);
      if (!comp) continue;
      const board = normalizeDrawRecord(item, todayStr);
      if (!board) continue;

      const existIdx = history[comp].findIndex(h => h.drawDate === board.drawDate);
      if (existIdx === -1) history[comp].unshift(board);
      else history[comp][existIdx] = mergeDrawBoards(history[comp][existIdx], board);
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

    const syncMeta = await saveToSupabaseHistory(results, todayStr);
    const hitCount = COMPANIES.filter(c => hasAnyValid4D(results[c])).length;

    return res.status(200).json({
      ok: true,
      today: todayStr,
      liveWindow,
      source: hitCount > 0 ? '4dlivetoday.com/api/v1' : 'pending',
      pushTriggered: syncMeta.pushed,
      results,
      history
    });
  } catch (_) {
    return res.status(200).json({
      ok: true,
      today: todayStr,
      liveWindow,
      source: 'safe-fallback',
      pushTriggered: false,
      results,
      history: { magnum: [], toto: [], damacai: [], sabah88: [], stc: [], cashsweep: [] }
    });
  }
};

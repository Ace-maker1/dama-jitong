// /api/backfill-phones.js
// 批量为已收录商家从 Google Places API 自动补全真实电话并写回 Supabase

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query.secret || '';
  if (secret !== 'dama2026') {
    return res.status(401).json({ ok: false, error: 'Unauthorized: missing ?secret=dama2026' });
  }

  const SUPABASE_URL = 'https://uhgukdqggvyaepkvlugg.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';
  const PLACES_KEY = process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

  if (!PLACES_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing GOOGLE_PLACES_KEY in Vercel env' });
  }

  const batchSize = Math.min(25, Math.max(1, Number(req.query.limit || 15)));

  try {
    // 1. 拉取尚未补全真实电话的商家记录（whatsapp 为管理员默认号或为空）
    const fetchUrl = `${SUPABASE_URL}/rest/v1/posts?select=id,title,city,description,whatsapp&category=eq.${encodeURIComponent('本地优惠')}&or=(whatsapp.eq.601125490636,whatsapp.is.null,whatsapp.eq.)&order=id.desc&limit=${batchSize}`;
    const dbRes = await fetch(fetchUrl, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!dbRes.ok) {
      const errTxt = await dbRes.text();
      return res.status(500).json({ ok: false, error: 'Supabase query failed: ' + errTxt });
    }

    const rows = await dbRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ ok: true, done: true, processed: 0, message: '全部商家电话已处理完毕！' });
    }

    const results = [];

    for (const row of rows) {
      const cleanName = String(row.title || '')
        .replace(/^【[^】]+】/g, '')
        .replace(/^\[[^\]]+\]/g, '')
        .trim();

      const addrMatch = String(row.description || '').match(/地址[：:]\s*([^\n\[]+)/);
      const addrHint = addrMatch ? addrMatch[1].trim() : (row.city && row.city !== '全马' ? row.city : 'Malaysia');
      const queryText = `${cleanName} ${addrHint}, Malaysia`.trim();

      let foundPhone = '';
      try {
        const pRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': PLACES_KEY,
            'X-Goog-FieldMask': 'places.internationalPhoneNumber,places.nationalPhoneNumber'
          },
          body: JSON.stringify({
            textQuery: queryText,
            regionCode: 'MY',
            maxResultCount: 1
          })
        });

        if (pRes.ok) {
          const pJson = await pRes.json();
          const p0 = Array.isArray(pJson?.places) ? pJson.places[0] : null;
          const raw = p0?.internationalPhoneNumber || p0?.nationalPhoneNumber || '';
          const digits = String(raw).replace(/[^0-9]/g, '');
          if (digits.startsWith('0')) {
            foundPhone = '60' + digits.slice(1);
          } else if (digits.startsWith('60')) {
            foundPhone = digits;
          }
        }
      } catch (_) {}

      // 查不到电话时写入 'NO_PHONE' 标记（前端识别后隐藏假 WhatsApp 按钮），避免下次重复查询浪费额度
      const nextWhatsapp = foundPhone || 'NO_PHONE';

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/posts?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ whatsapp: nextWhatsapp })
      });

      results.push({
        id: row.id,
        name: cleanName,
        whatsapp: nextWhatsapp,
        updated: patchRes.ok
      });
    }

    return res.status(200).json({
      ok: true,
      done: false,
      processed: results.length,
      foundCount: results.filter(r => r.whatsapp !== 'NO_PHONE').length,
      results
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}

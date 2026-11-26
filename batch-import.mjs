// batch-import.mjs —— 大马吉通全马实体商户批量自动收录机器人
const GEO_PROXY_URL = 'https://damajitong.com/api/geo-proxy';
const SUPABASE_URL = 'https://uhgukdqggvyaepkvlugg.supabase.co';
// 建议在 Supabase 后台 Settings -> API 复制 service_role key 填在这里（绕过 RLS 限制，写入最稳）；若暂时没有也可先用 anon key 测试
const SUPABASE_KEY = 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU';

// 1. 想要批量扫的城市与区域（可随时增减）
const TARGET_CITIES = [
  { city: '槟城', queryArea: 'Penang' },
  { city: '槟城', queryArea: 'Butterworth Penang' },
  { city: '槟城', queryArea: 'Bukit Mertajam Penang' },
  { city: '槟城', queryArea: 'Nibong Tebal Penang' },
  { city: '吉隆坡', queryArea: 'Kuala Lumpur' },
  { city: '吉隆坡', queryArea: 'Cheras Kuala Lumpur' },
  { city: '雪兰莪', queryArea: 'Petaling Jaya Selangor' },
  { city: '雪兰莪', queryArea: 'Puchong Selangor' },
  { city: '雪兰莪', queryArea: 'Subang Jaya Selangor' },
  { city: '柔佛', queryArea: 'Johor Bahru' },
  { city: '柔佛', queryArea: 'Mount Austin Johor Bahru' },
  { city: '霹雳', queryArea: 'Ipoh Perak' },
  { city: '马六甲', queryArea: 'Melaka' }
];

// 2. 想要批量扫的高频本地刚需行业
const TARGET_CATEGORIES = [
  { tag: '本地美食', keywords: ['Kopitiam', 'Restaurant', 'Nasi Lemak', 'Chicken Rice', 'Dim Sum', 'Cafe', '烧腊', '火锅', '猪脚饭'] },
  { tag: '便民医疗', keywords: ['Klinik', 'Poliklinik', 'Dental Clinic', 'Pharmacy'] },
  { tag: '汽车维修', keywords: ['Car Workshop', 'Tyre Shop', 'Car Wash', 'Auto Aircond'] },
  { tag: '美容美发', keywords: ['Hair Salon', 'Barber Shop', 'Beauty Salon'] },
  { tag: '生活服务', keywords: ['Aircond Service', 'Hardware Shop', 'Plumber', 'Laundry'] }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 拉取数据库已有标题，防止重复入库
async function fetchExistingSignatures() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/posts?select=title,city&category=eq.${encodeURIComponent('本地优惠')}&limit=5000`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) throw new Error(`读取现有数据失败: HTTP ${res.status}`);
  const rows = await res.json();
  const set = new Set();
  for (const r of rows) {
    set.add(`${r.city}::${String(r.title || '').toLowerCase()}`);
  }
  return set;
}

// 调用你的 /api/geo-proxy 检索真实店铺
async function searchPlaces(textQuery) {
  const res = await fetch(GEO_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'places_search',
      textQuery,
      languageCode: 'zh-CN',
      regionCode: 'MY',
      maxResultCount: 10
    })
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.places) ? data.places : [];
}

// 批量写入 Supabase
async function insertBatchPosts(records) {
  if (!records.length) return 0;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(records)
  });
  if (!res.ok) {
    const errTxt = await res.text();
    console.error('写入失败:', errTxt);
    return 0;
  }
  return records.length;
}

async function runRobot() {
  console.log('🤖 大马吉通商户自动收录机器人启动...');
  const existingSet = await fetchExistingSignatures();
  console.log(`📦 当前数据库已收录本地商家: ${existingSet.size} 家`);

  let totalAdded = 0;

  for (const area of TARGET_CITIES) {
    for (const cat of TARGET_CATEGORIES) {
      for (const kw of cat.keywords) {
        const query = `${kw} in ${area.queryArea}, Malaysia`;
        console.log(`🔍 正在扫描: ${query}`);

        const places = await searchPlaces(query);
        const toInsert = [];

        for (const pl of places) {
          const name = (pl.displayName?.text || '').trim();
          const addr = (pl.formattedAddress || area.queryArea).trim();
          const lat = pl.location?.latitude;
          const lng = pl.location?.longitude;
          if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue;

          const fullTitle = `【收录商户·${cat.tag}】${name}`;
          const sig = `${area.city}::${fullTitle.toLowerCase()}`;
          if (existingSet.has(sig)) continue;

          existingSet.add(sig);
          const packedDesc = `📍 地址：${addr}\n全马本地生活目录收录，支持一键语音导航到店\n[[MAP:${lat},${lng}|${addr.replace(/\|/g, ' ')}]]`;

          toInsert.push({
            category: '本地优惠',
            city: area.city,
            title: fullTitle,
            title_zh: fullTitle,
            title_en: `[Verified Directory · ${cat.tag}] ${name}`,
            title_ms: `[Direktori Kedai · ${cat.tag}] ${name}`,
            price: '到店咨询 / 实惠价',
            price_zh: '到店咨询 / 实惠价',
            price_en: 'Visit Store',
            price_ms: 'Rujuk Kedai',
            whatsapp: '601125490636',
            description: packedDesc,
            desc_zh: packedDesc,
            desc_en: packedDesc,
            desc_ms: packedDesc,
            image_url: null,
            is_pinned: false
          });
        }

        if (toInsert.length > 0) {
          const added = await insertBatchPosts(toInsert);
          totalAdded += added;
          console.log(`   ✅ 新增入库 ${added} 家 (累计新增: ${totalAdded} 家)`);
        } else {
          console.log('   ⏭️ 本组无新增（已存在或无结果）');
        }

        // 每次请求间隔 1.5 秒，保护接口稳定性与 API 限流
        await sleep(1500);
      }
    }
  }

  console.log(`🎉 全部扫描完成！本次共为大马吉通新增 ${totalAdded} 家真实商户。`);
}

runRobot();

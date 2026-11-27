// /api/traffic-cctv.js
// 拉取新加坡-柔佛新马关卡实时交通快照（带容错、缓存头、三语字段与直达关卡导航坐标）

const CAUSEWAY_CAMERAS = [
  {
    id: '2701',
    corridor: 'woodlands',
    title: {
      zh: 'Woodlands Causeway (往柔佛方向)',
      en: 'Woodlands Causeway (To Johor)',
      ms: 'Tambak Woodlands (Ke Johor)'
    },
    sub: {
      zh: '兀兰长堤往新山 CIQ 方向',
      en: 'Woodlands Causeway towards JB CIQ',
      ms: 'Arah ke CIQ Johor Bahru'
    }
  },
  {
    id: '2702',
    corridor: 'woodlands',
    title: {
      zh: 'Woodlands Checkpoint (兀兰关卡)',
      en: 'Woodlands Checkpoint',
      ms: 'Pusat Pemeriksaan Woodlands'
    },
    sub: {
      zh: '兀兰关卡出入境通道',
      en: 'Woodlands immigration & customs lanes',
      ms: 'Laluan keluar masuk imigresen Woodlands'
    }
  },
  {
    id: '2704',
    corridor: 'woodlands',
    title: {
      zh: 'BKE 往兀兰关卡方向',
      en: 'BKE towards Woodlands Checkpoint',
      ms: 'BKE ke Arah Woodlands'
    },
    sub: {
      zh: '武吉知马快速公路往兀兰关卡',
      en: 'Bukit Timah Expressway heading to checkpoint',
      ms: 'Lebuhraya BKE menuju ke pusat pemeriksaan'
    }
  },
  {
    id: '4703',
    corridor: 'tuas',
    title: {
      zh: 'Tuas Second Link (大士第二通道)',
      en: 'Tuas Second Link',
      ms: 'Laluan Kedua Tuas'
    },
    sub: {
      zh: '大士往柔佛振林山/依斯干达方向',
      en: 'Tuas towards Iskandar Puteri / Gelang Patah',
      ms: 'Arah ke Iskandar Puteri / Gelang Patah'
    }
  },
  {
    id: '4713',
    corridor: 'tuas',
    title: {
      zh: 'Tuas Checkpoint (大士关卡)',
      en: 'Tuas Checkpoint',
      ms: 'Pusat Pemeriksaan Tuas'
    },
    sub: {
      zh: '大士关卡出入境区域',
      en: 'Tuas immigration & customs zone',
      ms: 'Kawasan pemeriksaan imigresen Tuas'
    }
  }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const fetchedAt = new Date().toISOString();
  const cameraMap = new Map();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const sgRes = await fetch('https://api.data.gov.sg/v1/transport/traffic-images', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DamaJitong-MY/1.0'
      }
    });
    clearTimeout(timer);

    if (sgRes.ok) {
      const json = await sgRes.json();
      const items = Array.isArray(json?.items) ? json.items : [];
      const cams = Array.isArray(items[0]?.cameras) ? items[0].cameras : [];
      for (const cam of cams) {
        if (cam && cam.camera_id) {
          cameraMap.set(String(cam.camera_id), {
            imageUrl: cam.image,
            timestamp: cam.timestamp || fetchedAt,
            location: cam.location || null
          });
        }
      }
    }
  } catch (err) {
    console.error('SG traffic fetch error:', err?.message || err);
  }

  const cameras = CAUSEWAY_CAMERAS.map(meta => {
    const live = cameraMap.get(meta.id);
    return {
      ...meta,
      imageUrl: live?.imageUrl || '',
      timestamp: live?.timestamp || fetchedAt,
      liveAvailable: Boolean(live?.imageUrl)
    };
  });

  const jbLinks = [
    {
      id: 'nav_woodlands',
      title: {
        zh: '🧭 一键导航：新山 CIQ / 兀兰关卡',
        en: '🧭 Navigate: JB CIQ / Woodlands Checkpoint',
        ms: '🧭 Navigasi: CIQ JB / Pusat Pemeriksaan Woodlands'
      },
      desc: {
        zh: '自动锁定第一通道关卡坐标并开启路线规划',
        en: 'Auto-set First Link checkpoint destination on map',
        ms: 'Tetapkan destinasi Tambak Johor secara automatik'
      },
      url: '/map.html?dest=Woodlands%20Checkpoint%20%2F%20JB%20CIQ&lat=1.4457&lng=103.7691',
      external: false
    },
    {
      id: 'nav_tuas',
      title: {
        zh: '🧭 一键导航：大士第二通道 (Tuas / Linkedua)',
        en: '🧭 Navigate: Tuas Checkpoint / Second Link',
        ms: '🧭 Navigasi: Pusat Pemeriksaan Tuas / Laluan Kedua'
      },
      desc: {
        zh: '自动锁定第二通道关卡坐标并开启路线规划',
        en: 'Auto-set Second Link checkpoint destination on map',
        ms: 'Tetapkan destinasi Laluan Kedua Tuas secara automatik'
      },
      url: '/map.html?dest=Tuas%20Checkpoint%20%2F%20Second%20Link&lat=1.3489&lng=103.6361',
      external: false
    },
    {
      id: 'llm',
      title: {
        zh: 'LLM 大马大道局官网',
        en: 'LLM Malaysia Highway Authority',
        ms: 'Lembaga Lebuhraya Malaysia (LLM)'
      },
      desc: {
        zh: '查看柔佛 EDL / LINK2 及全马高速路况公告',
        en: 'Johor EDL / Second Link & highway advisories',
        ms: 'Info trafik EDL / Laluan Kedua & lebuhraya'
      },
      url: 'https://www.llm.gov.my',
      external: true
    },
    {
      id: 'lta',
      title: {
        zh: 'LTA OneMotoring 官方路况',
        en: 'LTA OneMotoring Official Traffic',
        ms: 'Laman Trafik Rasmi LTA OneMotoring'
      },
      desc: {
        zh: '新加坡陆交局官方关卡与高速路况总览',
        en: 'Singapore LTA checkpoint & expressway status',
        ms: 'Status pusat pemeriksaan & lebuhraya SG'
      },
      url: 'https://onemotoring.lta.gov.sg',
      external: true
    }
  ];

  return res.status(200).json({
    ok: true,
    updatedAt: fetchedAt,
    cameras,
    jbLinks
  });
}

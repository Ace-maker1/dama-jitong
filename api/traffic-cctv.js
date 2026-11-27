// /api/traffic-cctv.js
// 新马关卡实时交通抓拍 + Google Routes API 四向实时拥堵耗时测算

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

// 4 条核心跨关卡测算路段（参考 Checkpoint.sg 双向分段测算逻辑）
const CHECKPOINT_ROUTES = [
  {
    id: 'w_to_jb',
    corridor: 'woodlands',
    direction: 'SG → JB',
    title: {
      zh: '兀兰长堤 → 往新山 (JB)',
      en: 'Woodlands → To Johor (JB)',
      ms: 'Woodlands → Ke Johor (JB)'
    },
    segment: {
      zh: 'BKE / Woodlands 引道 → 新山 CIQ 出口',
      en: 'BKE / Woodlands Approach → JB CIQ Exit',
      ms: 'Susur BKE / Woodlands → Keluar CIQ JB'
    },
    origin: { lat: 1.4368, lng: 103.7712 },
    destination: { lat: 1.4631, lng: 103.7647 },
    baseMins: 8
  },
  {
    id: 'w_to_sg',
    corridor: 'woodlands',
    direction: 'JB → SG',
    title: {
      zh: '新山关卡 → 往新加坡 (SG)',
      en: 'JB CIQ → To Singapore (SG)',
      ms: 'CIQ JB → Ke Singapura (SG)'
    },
    segment: {
      zh: 'EDL / 新山引道 → 兀兰关卡出口',
      en: 'EDL / JB Approach → Woodlands Checkpoint',
      ms: 'Susur EDL / JB → Pusat Pemeriksaan Woodlands'
    },
    origin: { lat: 1.4669, lng: 103.7634 },
    destination: { lat: 1.4423, lng: 103.7689 },
    baseMins: 9
  },
  {
    id: 't_to_jb',
    corridor: 'tuas',
    direction: 'SG → JB',
    title: {
      zh: '大士第二通道 → 往柔佛 (JB)',
      en: 'Tuas Link → To Johor (JB)',
      ms: 'Laluan Tuas → Ke Johor (JB)'
    },
    segment: {
      zh: 'AYE / 大士引道 → 振林山 Tanjung Kupang',
      en: 'AYE / Tuas Approach → Tanjung Kupang CIQ',
      ms: 'Susur AYE / Tuas → CIQ Tanjung Kupang'
    },
    origin: { lat: 1.3418, lng: 103.6382 },
    destination: { lat: 1.3752, lng: 103.6115 },
    baseMins: 10
  },
  {
    id: 't_to_sg',
    corridor: 'tuas',
    direction: 'JB → SG',
    title: {
      zh: '第二通道 → 往新加坡 (SG)',
      en: 'Linkedua → To Singapore (SG)',
      ms: 'Linkedua → Ke Singapura (SG)'
    },
    segment: {
      zh: 'LINK2 收费站 → 大士关卡出口',
      en: 'LINK2 Plaza → Tuas Checkpoint Exit',
      ms: 'Plaza Tol LINK2 → Keluar CIQ Tuas'
    },
    origin: { lat: 1.3788, lng: 103.6088 },
    destination: { lat: 1.3455, lng: 103.6368 },
    baseMins: 10
  }
];

function parseGoogleSeconds(durStr) {
  if (!durStr) return null;
  const m = String(durStr).match(/^(\d+(?:\.\d+)?)s$/);
  return m ? Math.round(Number(m[1]) / 60) : null;
}

function buildFallbackEstimate(route) {
  const now = new Date();
  const sgHour = Number(now.toLocaleString('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', hour12: false }));
  const sgDay = now.toLocaleString('en-US', { timeZone: 'Asia/Singapore', weekday: 'short' });
  const isWeekend = sgDay === 'Sat' || sgDay === 'Sun';

  let extra = 4;
  if (route.direction === 'JB → SG') {
    if (!isWeekend && sgHour >= 5 && sgHour <= 9) extra = route.corridor === 'woodlands' ? 38 : 24;
    else if (isWeekend && sgHour >= 16 && sgHour <= 22) extra = route.corridor === 'woodlands' ? 35 : 22;
    else if (sgHour >= 10 && sgHour <= 21) extra = route.corridor === 'woodlands' ? 14 : 9;
  } else {
    if (!isWeekend && sgHour >= 17 && sgHour <= 21) extra = route.corridor === 'woodlands' ? 42 : 26;
    else if (isWeekend && sgHour >= 8 && sgHour <= 13) extra = route.corridor === 'woodlands' ? 40 : 25;
    else if (sgHour >= 10 && sgHour <= 22) extra = route.corridor === 'woodlands' ? 15 : 10;
  }

  const estMins = route.baseMins + extra;
  const level = extra >= 25 ? 'heavy' : (extra >= 10 ? 'moderate' : 'smooth');

  return {
    id: route.id,
    corridor: route.corridor,
    direction: route.direction,
    title: route.title,
    segment: route.segment,
    estMins,
    baseMins: route.baseMins,
    delayMins: extra,
    level,
    source: 'model'
  };
}

async function computeLiveRouteEstimate(route, apiKey) {
  if (!apiKey) return buildFallbackEstimate(route);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration'
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: route.origin.lat, longitude: route.origin.lng } } },
        destination: { location: { latLng: { latitude: route.destination.lat, longitude: route.destination.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL'
      })
    });
    clearTimeout(timer);

    if (!resp.ok) return buildFallbackEstimate(route);
    const data = await resp.json();
    const r0 = Array.isArray(data?.routes) ? data.routes[0] : null;
    const liveMins = parseGoogleSeconds(r0?.duration);
    const staticMins = parseGoogleSeconds(r0?.staticDuration) || route.baseMins;

    if (typeof liveMins !== 'number' || liveMins <= 0) {
      return buildFallbackEstimate(route);
    }

    const delayMins = Math.max(0, liveMins - staticMins);
    const level = delayMins >= 20 || liveMins >= 32
      ? 'heavy'
      : (delayMins >= 7 || liveMins >= 18 ? 'moderate' : 'smooth');

    return {
      id: route.id,
      corridor: route.corridor,
      direction: route.direction,
      title: route.title,
      segment: route.segment,
      estMins: liveMins,
      baseMins: staticMins,
      delayMins,
      level,
      source: 'google_live'
    };
  } catch (_) {
    return buildFallbackEstimate(route);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=90, stale-while-revalidate=180');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const fetchedAt = new Date().toISOString();
  const cameraMap = new Map();
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const [_, routeEstimates] = await Promise.all([
    (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const sgRes = await fetch('https://api.data.gov.sg/v1/transport/traffic-images', {
          signal: controller.signal,
          headers: { 'User-Agent': 'DamaJitong-MY/1.0' }
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
                timestamp: cam.timestamp || fetchedAt
              });
            }
          }
        }
      } catch (err) {
        console.error('SG traffic fetch error:', err?.message || err);
      }
    })(),
    Promise.all(CHECKPOINT_ROUTES.map(r => computeLiveRouteEstimate(r, googleApiKey)))
  ]);

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
    routeEstimates,
    cameras,
    jbLinks
  });
}

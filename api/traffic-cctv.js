// /api/traffic-cctv.js
// 拉取新加坡-柔佛新马关卡实时交通快照（免申请 Key，带容错与缓存头）

const CAUSEWAY_CAMERAS = [
  { id: '2701', corridor: 'woodlands', title: 'Woodlands Causeway (往柔佛方向)', sub: '兀兰长堤往新山 CIQ 方向' },
  { id: '2702', corridor: 'woodlands', title: 'Woodlands Checkpoint (兀兰关卡)', sub: '兀兰关卡出入境通道' },
  { id: '2704', corridor: 'woodlands', title: 'BKE towards Woodlands Checkpoint', sub: '武吉知马快速公路往兀兰关卡' },
  { id: '4703', corridor: 'tuas', title: 'Tuas Second Link (大士第二通道)', sub: '大士往柔佛振林山/依斯干达方向' },
  { id: '4713', corridor: 'tuas', title: 'Tuas Checkpoint (大士关卡)', sub: '大士关卡出入境区域' }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

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

  // 柔佛侧官方/常用路况参考入口（LLM 大马大道局与常用路况页）
  const jbLinks = [
    {
      name: 'LLM 大马大道局官网',
      desc: '查看柔佛 EDL / LINK2 及全马高速路况公告',
      url: 'https://www.llm.gov.my'
    },
    {
      name: 'LTA OneMotoring 官方路况',
      desc: '新加坡陆交局官方关卡与高速路况总览',
      url: 'https://onemotoring.lta.gov.sg'
    },
    {
      name: '大马吉通出行导航',
      desc: '一键规划前往新山 CIQ / 兀兰 / 大士路线',
      url: '/map.html'
    }
  ];

  return res.status(200).json({
    ok: true,
    updatedAt: fetchedAt,
    cameras,
    jbLinks
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload || '{}');
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  } else if (!payload || typeof payload !== 'object') {
    payload = {};
  }

  const action = payload.action;

  try {
    // 1. Google Places 逐字实时自动补全联想（Autocomplete - 带当前起点直线距离与地区偏置）
    if (action === 'autocomplete') {
      const apiKey = process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      }

      const input = String(payload.input || '').trim();
      if (!input) {
        return res.status(400).json({ error: 'Missing input' });
      }

      const body = {
        input,
        languageCode: payload.languageCode || 'zh-CN',
        includedRegionCodes: ['my']
      };

      if (typeof payload.lat === 'number' && typeof payload.lng === 'number') {
        const radiusMeters = Math.min(Math.max(Number(payload.radius) || 15000.0, 500.0), 50000.0);
        body.origin = { latitude: payload.lat, longitude: payload.lng };
        body.locationBias = {
          circle: {
            center: { latitude: payload.lat, longitude: payload.lng },
            radius: radiusMeters
          }
        };
      }

      const googleRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey
        },
        body: JSON.stringify(body)
      });

      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

    // 2. 单个 Place ID 精准坐标与电话/营业时间解析（用户点击 Autocomplete 候选词后瞬间获取精确坐标）
    if (action === 'place_details') {
      const apiKey = process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      }

      const placeId = String(payload.placeId || '').trim().replace(/^places\//, '');
      if (!placeId) {
        return res.status(400).json({ error: 'Missing placeId' });
      }

      const lang = encodeURIComponent(payload.languageCode || 'zh-CN');
      const googleRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${lang}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,internationalPhoneNumber,nationalPhoneNumber,currentOpeningHours,rating,userRatingCount'
        }
      });

      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

    // 3. Google Places 文本检索（含营业状态、评分、距离优先排序）
    if (action === 'places_search') {
      const apiKey = process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      }

      const textQuery = String(payload.textQuery || '').trim();
      if (!textQuery) {
        return res.status(400).json({ error: 'Missing textQuery' });
      }

      const maxCount = Math.min(Math.max(Number(payload.maxResultCount) || 10, 1), 15);
      const body = {
        textQuery,
        languageCode: payload.languageCode || 'zh-CN',
        regionCode: payload.regionCode || 'MY',
        maxResultCount: maxCount
      };

      if (typeof payload.lat === 'number' && typeof payload.lng === 'number') {
        const radiusMeters = Math.min(Math.max(Number(payload.radius) || 2500.0, 300.0), 50000.0);
        body.locationBias = {
          circle: {
            center: { latitude: payload.lat, longitude: payload.lng },
            radius: radiusMeters
          }
        };
        if (payload.rankByDistance !== false) {
          body.rankPreference = 'DISTANCE';
        }
      }

      const googleRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber,places.currentOpeningHours,places.rating,places.userRatingCount'
        },
        body: JSON.stringify(body)
      });

      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

    // 4. Google Places 严格半径附近检索（楼下 1.5km 餐饮/商铺一网打尽）
    if (action === 'places_nearby') {
      const apiKey = process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      }

      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'Invalid lat/lng' });
      }

      const radiusMeters = Math.min(Math.max(Number(payload.radius) || 1500.0, 200.0), 10000.0);
      const maxCount = Math.min(Math.max(Number(payload.maxResultCount) || 10, 1), 20);
      const includedTypes = Array.isArray(payload.includedTypes) && payload.includedTypes.length > 0
        ? payload.includedTypes
        : ['restaurant', 'cafe', 'meal_takeaway', 'bakery'];

      const body = {
        includedTypes,
        maxResultCount: maxCount,
        rankPreference: 'DISTANCE',
        languageCode: payload.languageCode || 'zh-CN',
        regionCode: payload.regionCode || 'MY',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters
          }
        }
      };

      const googleRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber,places.currentOpeningHours,places.rating,places.userRatingCount'
        },
        body: JSON.stringify(body)
      });

      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

    // 5. 正向地理编码
    if (action === 'geocode') {
      const apiKey = process.env.GOOGLE_GEOCODING_KEY || process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_GEOCODING_KEY' });
      }

      const address = String(payload.address || '').trim();
      if (!address) {
        return res.status(400).json({ error: 'Missing address' });
      }

      const region = encodeURIComponent(payload.region || 'my');
      const lang = encodeURIComponent(payload.language || 'zh-CN');
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=${region}&language=${lang}&key=${encodeURIComponent(apiKey)}`;

      const googleRes = await fetch(url);
      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

    // 6. 逆向地理编码（坐标 -> 精确社区/花园/路名）
    if (action === 'reverse_geocode') {
      const apiKey = process.env.GOOGLE_GEOCODING_KEY || process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_GEOCODING_KEY' });
      }

      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'Invalid lat/lng' });
      }

      const lang = encodeURIComponent(payload.language || 'zh-CN');
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&language=${lang}&key=${encodeURIComponent(apiKey)}`;

      const googleRes = await fetch(url);
      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    return res.status(502).json({
      error: err?.message || 'Proxy request failed'
    });
  }
}

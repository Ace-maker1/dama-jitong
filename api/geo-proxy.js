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
    if (action === 'places_search') {
      const apiKey = process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      }

      const textQuery = String(payload.textQuery || '').trim();
      if (!textQuery) {
        return res.status(400).json({ error: 'Missing textQuery' });
      }

      const body = {
        textQuery,
        languageCode: payload.languageCode || 'zh-CN',
        regionCode: payload.regionCode || 'MY',
        maxResultCount: Math.min(Math.max(Number(payload.maxResultCount) || 6, 1), 10)
      };

      if (typeof payload.lat === 'number' && typeof payload.lng === 'number') {
        body.locationBias = {
          circle: {
            center: { latitude: payload.lat, longitude: payload.lng },
            radius: Number(payload.radius) || 15000.0
          }
        };
      }

      const googleRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber,places.currentOpeningHours'
        },
        body: JSON.stringify(body)
      });

      const data = await googleRes.json();
      return res.status(googleRes.status).json(data);
    }

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

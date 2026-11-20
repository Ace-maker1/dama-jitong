module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GOOGLE_MAPS_API_KEY on server' });
  }

  const { query, lat, lng, lang = 'zh' } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query' });
  }

  const langCodeMap = { zh: 'zh-CN', en: 'en', ms: 'ms' };
  const languageCode = langCodeMap[lang] || 'zh-CN';

  const body = {
    textQuery: query.trim(),
    languageCode,
    regionCode: 'MY',
    maxResultCount: 8
  };

  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  if (!Number.isNaN(numLat) && !Number.isNaN(numLng)) {
    body.locationBias = {
      circle: {
        center: { latitude: numLat, longitude: numLng },
        radius: 15000.0
      }
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.currentOpeningHours,places.regularOpeningHours,places.nationalPhoneNumber,places.internationalPhoneNumber'
      },
      body: JSON.stringify(body)
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Google Places API error', detail: errText });
    }

    const data = await response.json();
    const places = (data.places || []).map(p => ({
      id: p.id,
      name: p.displayName?.text || query.trim(),
      address: p.formattedAddress || 'Malaysia',
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      openNow: p.currentOpeningHours?.openNow ?? null,
      phone: p.internationalPhoneNumber || p.nationalPhoneNumber || ''
    })).filter(x => typeof x.lat === 'number' && typeof x.lng === 'number');

    return res.status(200).json({ places });
  } catch (err) {
    return res.status(502).json({ error: 'Places request failed', detail: err.message });
  }
};

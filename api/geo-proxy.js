export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action || 'places_search';
    const placesKey = process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_MAPS_KEY || '';
    const geocodeKey = process.env.GOOGLE_GEOCODING_KEY || placesKey;

    if (action === 'places_search') {
      if (!placesKey) return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      const payload = {
        textQuery: String(body.textQuery || '').trim(),
        languageCode: body.languageCode || 'zh-CN',
        regionCode: body.regionCode || 'MY',
        maxResultCount: Math.min(Number(body.maxResultCount) || 10, 20),
        rankPreference: body.rankByDistance ? 'DISTANCE' : 'RELEVANCE'
      };
      if (typeof body.lat === 'number' && typeof body.lng === 'number') {
        payload.locationBias = {
          circle: {
            center: { latitude: body.lat, longitude: body.lng },
            radius: Number(body.radius) || 2500.0
          }
        };
      }
      const gRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': placesKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber,places.currentOpeningHours.openNow,places.rating'
        },
        body: JSON.stringify(payload)
      });
      const data = await gRes.json();
      return res.status(gRes.status).json(data);
    }

    if (action === 'places_nearby') {
      if (!placesKey) return res.status(500).json({ error: 'Missing GOOGLE_PLACES_KEY' });
      const payload = {
        includedTypes: Array.isArray(body.includedTypes) && body.includedTypes.length > 0
          ? body.includedTypes
          : ['restaurant', 'cafe', 'convenience_store', 'supermarket', 'grocery_store', 'hospital', 'pharmacy', 'school'],
        maxResultCount: Math.min(Number(body.maxResultCount) || 15, 20),
        rankPreference: 'DISTANCE',
        languageCode: body.languageCode || 'zh-CN',
        regionCode: body.regionCode || 'MY',
        locationRestriction: {
          circle: {
            center: { latitude: Number(body.lat), longitude: Number(body.lng) },
            radius: Number(body.radius) || 2000.0
          }
        }
      };
      const gRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': placesKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber,places.currentOpeningHours.openNow,places.rating'
        },
        body: JSON.stringify(payload)
      });
      const data = await gRes.json();
      return res.status(gRes.status).json(data);
    }

    if (action === 'geocode') {
      if (!geocodeKey) return res.status(500).json({ error: 'Missing GOOGLE_GEOCODING_KEY' });
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(body.address || '')}&region=${encodeURIComponent(body.region || 'my')}&key=${encodeURIComponent(geocodeKey)}`;
      const gRes = await fetch(url);
      const data = await gRes.json();
      return res.status(gRes.status).json(data);
    }

    if (action === 'reverse_geocode') {
      if (!geocodeKey) return res.status(500).json({ error: 'Missing GOOGLE_GEOCODING_KEY' });
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(body.lat)},${encodeURIComponent(body.lng)}&language=${encodeURIComponent(body.language || 'zh-CN')}&key=${encodeURIComponent(geocodeKey)}`;
      const gRes = await fetch(url);
      const data = await gRes.json();
      return res.status(gRes.status).json(data);
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Proxy error' });
  }
}

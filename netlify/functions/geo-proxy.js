exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const action = payload.action;

  try {
    if (action === 'places_search') {
      const apiKey = process.env.GOOGLE_PLACES_KEY;
      if (!apiKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GOOGLE_PLACES_KEY' }) };
      }

      const textQuery = String(payload.textQuery || '').trim();
      if (!textQuery) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing textQuery' }) };
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
            radius: Number(payload.radius) || 30000.0
          }
        };
      }

      const googleRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.currentOpeningHours'
        },
        body: JSON.stringify(body)
      });

      const data = await googleRes.json();
      return { statusCode: googleRes.status, headers, body: JSON.stringify(data) };
    }

    if (action === 'geocode') {
      const apiKey = process.env.GOOGLE_GEOCODING_KEY;
      if (!apiKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GOOGLE_GEOCODING_KEY' }) };
      }

      const address = String(payload.address || '').trim();
      if (!address) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing address' }) };
      }

      const region = encodeURIComponent(payload.region || 'my');
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}®ion=${region}&key=${encodeURIComponent(apiKey)}`;

      const googleRes = await fetch(url);
      const data = await googleRes.json();
      return { statusCode: googleRes.status, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported action' }) };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err?.message || 'Proxy request failed' })
    };
  }
};

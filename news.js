module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream error' });
    }

    const xml = await response.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(502).json({ error: 'Fetch timeout', detail: err.message });
  }
};
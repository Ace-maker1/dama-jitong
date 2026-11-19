const ALLOWED_HOSTS = [
  'feeds.bbci.co.uk',
  'www.thestar.com.my',
  'www.malaymail.com',
  'www.freemalaysiatoday.com',
  'www.sinchew.com.my',
  'www.chinapress.com.my',
  'www.orientaldaily.com.my',
  'rss.nytimes.com'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid url' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Unsupported protocol' });
  }

  const host = parsedUrl.hostname.toLowerCase();
  const isAllowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Host not allowed' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream error' });
    }

    const xml = await response.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(xml);
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    return res.status(502).json({
      error: isTimeout ? 'Fetch timeout' : 'Fetch failed',
      detail: err.message
    });
  } finally {
    clearTimeout(timer);
  }
};

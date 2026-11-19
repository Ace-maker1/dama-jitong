module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream error' });
    }

    let xml = await response.text();

    // 统一将 <media:thumbnail url="..."> 与 <media:content url="..."> 补写一份标准 <enclosure>，彻底消除浏览器 XML 命名空间解析兼容问题
    xml = xml.replace(/<item>([\s\S]*?)<\/item>/gi, (match, inner) => {
      if (/<enclosure\s/i.test(inner)) return match;
      const mediaMatch = inner.match(/<media:(?:thumbnail|content)[^>]+url=["']([^"']+)["']/i)
                      || inner.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
      if (mediaMatch && mediaMatch[1] && !mediaMatch[1].includes('google.com')) {
        const cleanImg = mediaMatch[1].replace(/\/240\//, '/640/'); // BBC 缩略图自动升级高清大图
        return `<item>${inner}<enclosure url="${cleanImg}" type="image/jpeg" /></item>`;
      }
      return match;
    });

    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(502).json({ error: 'Fetch timeout', detail: err.message });
  }
};

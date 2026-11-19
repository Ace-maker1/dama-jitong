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

    // 统一补齐封面图：有原生图用原生图；Google News 无图源自动通过 Bing 新闻图库匹配真实新闻配图
    xml = xml.replace(/<item>([\s\S]*?)<\/item>/gi, (match, inner) => {
      if (/<enclosure\s/i.test(inner)) return match;

      const mediaMatch = inner.match(/<media:(?:thumbnail|content)[^>]+url=["']([^"']+)["']/i)
                      || inner.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
      if (mediaMatch && mediaMatch[1] && !mediaMatch[1].includes('google.com')) {
        const cleanImg = mediaMatch[1].replace(/\/240\//, '/640/');
        return `<item>${inner}<enclosure url="${cleanImg}" type="image/jpeg" /></item>`;
      }

      // 提取标题，为纯文字新闻自动匹配对应真实新闻缩略图
      const titleMatch = inner.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').split(' - ')[0].trim() : '';
      if (rawTitle) {
        const thumbUrl = `https://tse2.mm.bing.net/th?q=${encodeURIComponent(rawTitle.slice(0, 28))}&w=240&h=240&c=7&rs=1&p=0`;
        return `<item>${inner}<enclosure url="${thumbUrl}" type="image/jpeg" /></item>`;
      }

      return match;
    });

    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(502).json({ error: 'Fetch timeout', detail: err.message });
  }
};

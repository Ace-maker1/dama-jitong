async function getCandidateModels(apiKey, preferVision) {
  let list = [];
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (r.ok) {
      const json = await r.json();
      list = Array.isArray(json.data)
        ? json.data
            .map(m => m.id)
            .filter(id =>
              id &&
              !id.includes('whisper') &&
              !id.includes('guard') &&
              !id.includes('tts') &&
              !id.includes('orpheus') &&
              !id.includes('safeguard')
            )
        : [];
    }
  } catch (_) {}

  const priority = preferVision
    ? ['vision', 'llama-4', 'scout', 'maverick', 'qwen', 'llama-3.3', 'llama-3.1', 'llama', 'gemma', 'deepseek', 'mistral', 'kimi', 'gpt']
    : ['llama-3.3', 'llama-4', 'qwen', 'llama-3.1', 'deepseek', 'gemma', 'mistral', 'kimi', 'gpt', 'llama'];

  const scored = [...list].sort((a, b) => {
    const ia = priority.findIndex(k => a.toLowerCase().includes(k));
    const ib = priority.findIndex(k => b.toLowerCase().includes(k));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return scored.length > 0 ? scored : ['llama-3.1-8b-instant'];
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      hasGroqKey: Boolean(process.env.GROQ_API_KEY)
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GROQ_API_KEY on server' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { messages = [], imageBase64 = '', imageMimeType = 'image/jpeg', lang = 'zh' } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required' });
    }

    const langGuide = lang === 'en'
      ? 'Reply clearly in English.'
      : (lang === 'ms' ? 'Jawab dengan jelas dalam Bahasa Melayu.' : '请使用简体中文清晰回答（如涉及马来文/英文专有名词或信件内容，保留原文并附中文解释）。');

    const systemPrompt = `你是“大马吉通 AI 助手”，专注服务马来西亚（Penang、KL、Selangor、Ipoh、JB 等）与新马本地生活用户。${langGuide}
回答要求：
1. 实用、准确、简洁，适合手机端阅读；
2. 用户上传图片（如马来文公函、罚单、收据、菜单、合同或广告图）时，先提取关键信息/翻译，再给出清晰的行动建议或解释；
3. 涉及法律、税务、医疗或大额资金往来时，附带简短风险提示。`;

    const hasImage = Boolean(imageBase64 && imageBase64.length > 20);
    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map((m, idx, arr) => {
        const isLastUser = idx === arr.length - 1 && m.role === 'user';
        const textPart = String(m.content || '').slice(0, 4000);

        if (isLastUser && hasImage) {
          const dataUrl = imageBase64.startsWith('data:')
            ? imageBase64
            : `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`;
          return {
            role: 'user',
            content: [
              { type: 'text', text: textPart },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          };
        }

        return {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: textPart
        };
      })
    ];

    const candidates = await getCandidateModels(apiKey, hasImage);
    let lastError = 'AI upstream request failed';

    for (const model of candidates.slice(0, 6)) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          temperature: 0.5,
          max_tokens: 512
        })
      });

      const data = await response.json();
      if (response.ok) {
        const replyText = data?.choices?.[0]?.message?.content?.trim()
          || '抱歉，这次没有生成回复，请换一种说法再试一次。';
        return res.status(200).json({ reply: replyText, model });
      }

      lastError = data?.error?.message || `HTTP ${response.status}`;
    }

    return res.status(400).json({
      error: `${lastError}（可用模型列表: ${candidates.join(', ') || '空'}）`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY on server' });
  }

  try {
    const { messages = [], imageBase64 = '', imageMimeType = 'image/jpeg', lang = 'zh' } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required' });
    }

    const langGuide = lang === 'en'
      ? 'Reply clearly in English.'
      : (lang === 'ms' ? 'Jawab dengan jelas dalam Bahasa Melayu.' : '请使用简体中文清晰回答（如涉及马来文/英文专有名词或信件内容，保留原文并附中文解释）。');

    const systemInstruction = `你是“大马吉通 AI 助手”，专注服务马来西亚（Penang、KL、Selangor、Ipoh、JB 等）与新马本地生活用户。${langGuide}
回答要求：
1. 实用、准确、简洁，适合手机端阅读；
2. 用户上传图片（如马来文公函、罚单、收据、菜单、合同或广告图）时，先提取关键信息/翻译，再给出清晰的行动建议或解释；
3. 涉及法律、税务、医疗或大额资金往来时，附带简短风险提示。`;

    const contents = messages.slice(-10).map((m, idx, arr) => {
      const isLastUser = idx === arr.length - 1 && m.role === 'user';
      const parts = [{ text: String(m.content || '').slice(0, 4000) }];
      if (isLastUser && imageBase64) {
        const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        if (cleanBase64.length > 0 && cleanBase64.length < 3600000) {
          parts.push({
            inline_data: {
              mime_type: imageMimeType || 'image/jpeg',
              data: cleanBase64
            }
          });
        }
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 1200
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'AI upstream request failed'
      });
    }

    const replyText = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '')
      .join('')
      .trim() || '抱歉，这次没有生成回复，请换一种说法再试一次。';

    return res.status(200).json({ reply: replyText });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

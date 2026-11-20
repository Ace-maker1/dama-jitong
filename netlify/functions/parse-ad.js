const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty model response');
  }
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Invalid JSON from model');
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const rawKey = process.env.GEMINI_API_KEY || '';
  const cleanKey = rawKey.replace(/[^A-Za-z0-9_-]/g, '');
  if (!cleanKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: '未配置有效的 GEMINI_API_KEY' }),
    };
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg', extraNotes = '' } = JSON.parse(event.body || '{}');

    if (!imageBase64 && !extraNotes.trim()) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: '请上传图片或输入简要说明' }),
      };
    }

    const prompt =
      '你是马来西亚本地生活门户平台「大马吉通 (DaMaJitong)」的智能填表与文案助手。\n' +
      '请识别图片中的商家宣传海报、价目表、名片或门店照片（并结合补充说明：' + extraNotes + '），提取关键信息并撰写符合马来西亚本地习惯的中、英、巫三语推广文案。\n' +
      '没提到的字段留空字符串 ""，不要瞎编。\n' +
      '请严格只输出合法 JSON（不要 markdown 代码块包裹），字段如下：\n' +
      '{\n' +
      '  "businessName": "店铺或服务名称",\n' +
      '  "category": "推荐分类（如餐饮美食、五金装修、汽车维修、美容美发、生活服务、二手买卖、招聘求职）",\n' +
      '  "phone": "联系电话或 WhatsApp",\n' +
      '  "address": "地址或区域",\n' +
      '  "businessHours": "营业时间",\n' +
      '  "promoTagline": "一句吸睛置顶标语（20字内）",\n' +
      '  "descZh": "中文介绍与卖点",\n' +
      '  "descEn": "English description and highlights",\n' +
      '  "descBm": "Penerangan dan kelebihan dalam Bahasa Melayu"\n' +
      '}';

    const parts = [];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
    }
    parts.push({ text: prompt });

    const endpoint =
      '[https://generativelanguage.googleapis.com](https://generativelanguage.googleapis.com)' +
      '/v1beta/models/gemini-2.5-flash-lite:generateContent';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const apiMsg = data?.error?.message || ('Gemini API HTTP ' + res.status);
      throw new Error(apiMsg);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJsonObject(rawText);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, data: parsed }),
    };
  } catch (err) {
    console.error('parse-ad error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: err.message || 'AI 识别失败，请稍后重试' }),
    };
  }
}

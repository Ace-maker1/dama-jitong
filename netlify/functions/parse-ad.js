export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: '未配置 GEMINI_API_KEY' }) };
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg', extraNotes = '' } = JSON.parse(event.body || '{}');

    if (!imageBase64 && !extraNotes.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: '请上传图片或输入简要说明' }),
      };
    }

    const prompt = `
你是马来西亚本地生活门户平台「大马吉通 (DaMaJitong)」的智能填表与文案助手。
请识别图片中的商家宣传海报、价目表、名片或门店照片（并结合补充说明：${extraNotes}），提取关键信息并撰写符合马来西亚本地习惯的中、英、巫三语推广文案。
没提到的字段留空字符串 ""，不要瞎编。
请严格只输出合法 JSON（不要 markdown 代码块包裹），字段如下：
{
  "businessName": "店铺或服务名称",
  "category": "推荐分类（如餐饮美食、五金装修、汽车维修、美容美发、生活服务、二手买卖、招聘求职）",
  "phone": "联系电话或 WhatsApp",
  "address": "地址或区域",
  "businessHours": "营业时间",
  "promoTagline": "一句吸睛置顶标语（20字内）",
  "descZh": "中文介绍与卖点",
  "descEn": "English description and highlights",
  "descBm": "Penerangan dan kelebihan dalam Bahasa Melayu"
}
`;

    const parts = [];
    if (imageBase64) {
      parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
    }
    parts.push({ text: prompt });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('模型未返回有效内容');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: JSON.parse(rawText) }),
    };
  } catch (err) {
    console.error('parse-ad error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'AI 识别失败，请稍后重试' }),
    };
  }
}

const DEFAULT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function buildResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...DEFAULT_CORS_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function normalizeBase64Image(imageBase64, mimeType) {
  const safeMime =
    typeof mimeType === "string" && mimeType.trim().length > 0
      ? mimeType.trim()
      : "image/jpeg";

  if (typeof imageBase64 !== "string" || imageBase64.trim().length === 0) {
    return null;
  }

  const trimmed = imageBase64.trim();
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  return `data:${safeMime};base64,${trimmed}`;
}

function extractJsonObject(rawText) {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return null;
  }

  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch (_) {
      // 继续尝试直接提取花括号对象
    }
  }

  const braceMatch = rawText.match(/\{[\s\S]*\}/);
  if (braceMatch && braceMatch[0]) {
    try {
      return JSON.parse(braceMatch[0].trim());
    } catch (_) {
      return null;
    }
  }

  return null;
}

function normalizeParsedFields(parsed) {
  const safeObj = parsed && typeof parsed === "object" ? parsed : {};
  const toCleanString = (val) => (typeof val === "string" ? val.trim() : "");

  return {
    businessName: toCleanString(safeObj.businessName),
    phone: toCleanString(safeObj.phone),
    promoTagline: toCleanString(safeObj.promoTagline),
    address: toCleanString(safeObj.address),
    businessHours: toCleanString(safeObj.businessHours),
    category: toCleanString(safeObj.category),
    descZh: toCleanString(safeObj.descZh),
    descEn: toCleanString(safeObj.descEn),
    descBm: toCleanString(safeObj.descBm),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return buildResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return buildResponse(405, {
      error: "Method Not Allowed. Please use POST.",
    });
  }

  const apiKey =
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY ||
    "";

  if (!apiKey.trim()) {
    return buildResponse(500, {
      error: "Missing API key in Netlify environment variables (GROQ_API_KEY).",
    });
  }

  let bodyData = {};
  try {
    bodyData = JSON.parse(event.body || "{}");
  } catch (parseErr) {
    return buildResponse(400, {
      error: "Invalid JSON request body.",
      detail: parseErr.message,
    });
  }

  const dataUrl = normalizeBase64Image(bodyData.imageBase64, bodyData.mimeType);
  if (!dataUrl) {
    return buildResponse(400, {
      error: "Missing or invalid imageBase64 field.",
    });
  }

  const promptText = [
    "请仔细识别这张商家宣传海报、广告图或名片中的关键信息，",
    "并严格只返回纯 JSON 对象（不要输出任何解释性文字或 markdown 标记），字段结构如下：",
    "{",
    '  "businessName": "商家或店铺名称",',
    '  "phone": "联系电话或WhatsApp号码",',
    '  "promoTagline": "促销优惠或主打标语",',
    '  "address": "详细地址",',
    '  "businessHours": "营业时间",',
    '  "category": "行业类别",',
    '  "descZh": "中文简介",',
    '  "descEn": "English description",',
    '  "descBm": "Ringkasan Bahasa Melayu"',
    "}",
    '如果某个字段在图片中没有出现，请填为空字符串 ""。',
  ].join("\n");

  try {
    const apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        temperature: 0.1,
       max_completion_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                },
              },
              {
                type: "text",
                text: promptText,
              },
            ],
          },
        ],
      }),
    });

    const resultJson = await apiResponse.json();

    if (!apiResponse.ok) {
      return buildResponse(apiResponse.status, {
        error:
          resultJson?.error?.message ||
          resultJson?.message ||
          "Groq Vision API request failed.",
      });
    }

    const modelContent =
      resultJson?.choices?.[0]?.message?.content || "";

    const extractedObj = extractJsonObject(modelContent);
    if (!extractedObj) {
      return buildResponse(500, {
        error: "Failed to parse JSON from model output.",
        raw: modelContent,
      });
    }

    const finalData = normalizeParsedFields(extractedObj);
    return buildResponse(200, finalData);
  } catch (err) {
    return buildResponse(500, {
      error: err.message || "Unexpected server error in parse-ad.",
    });
  }
};

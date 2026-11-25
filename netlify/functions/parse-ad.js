const DEFAULT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

// 违禁/高风险关键词黑名单（防恶意广告连坐）
const BANNED_KEYWORDS = [
  "4d下注", "万字下注", "买万字", "包中", "心水字", "稳赢", "稳赚",
  "在线投注", "网上投注", "线上赌场", "真人娱乐", "老虎机", "体育博彩",
  "casino", "betting", "bookmaker", "slot", "judi", "4d online", "toto online",
  "洗黑钱", "洗钱", "跑分", "刷单", "贷款包过", "高利贷", "ah long", "scam"
];

function detectBannedContent(fieldsObj) {
  const combined = Object.values(fieldsObj || {})
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();

  const matched = BANNED_KEYWORDS.filter((kw) => combined.includes(kw.toLowerCase()));
  return {
    blocked: matched.length > 0,
    matchedKeywords: matched,
    reason: matched.length > 0 ? `检测到违禁/敏感词：${matched.join(", ")}` : "",
  };
}

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
    return buildResponse(200, { success: true, ok: true });
  }

  if (event.httpMethod !== "POST") {
    return buildResponse(405, {
      success: false,
      error: "Method Not Allowed. Please use POST.",
    });
  }

  const apiKey =
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY ||
    "";

  if (!apiKey.trim()) {
    return buildResponse(500, {
      success: false,
      error: "Missing API key in Netlify environment variables (GROQ_API_KEY).",
    });
  }

  let bodyData = {};
  try {
    bodyData = JSON.parse(event.body || "{}");
  } catch (parseErr) {
    return buildResponse(400, {
      success: false,
      error: "Invalid JSON request body.",
      detail: parseErr.message,
    });
  }

  const dataUrl = normalizeBase64Image(bodyData.imageBase64, bodyData.mimeType);
  if (!dataUrl) {
    return buildResponse(400, {
      success: false,
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
        success: false,
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
        success: false,
        error: "Failed to parse JSON from model output.",
        raw: modelContent,
      });
    }

    const finalData = normalizeParsedFields(extractedObj);
    const moderation = detectBannedContent(finalData);

    if (moderation.blocked) {
      return buildResponse(422, {
        success: false,
        blocked: true,
        error: moderation.reason,
        matchedKeywords: moderation.matchedKeywords,
        data: finalData,
      });
    }

    return buildResponse(200, {
      success: true,
      blocked: false,
      data: finalData,
    });
  } catch (err) {
    return buildResponse(500, {
      success: false,
      error: err.message || "Unexpected server error in parse-ad.",
    });
  }
};

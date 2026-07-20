const MAX_REQUEST_CHARS = 1_800_000;
const MAX_IMAGE_CHARS = 1_500_000;
const DAILY_LIMIT = 8;

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["canEstimate", "low", "likely", "high", "confidence", "assumptions", "rationale"],
  properties: {
    canEstimate: { type: "boolean" },
    low: { type: ["integer", "null"], minimum: 0 },
    likely: { type: ["integer", "null"], minimum: 0 },
    high: { type: ["integer", "null"], minimum: 0 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    assumptions: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
    rationale: { type: "string" },
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cleanText(value, maximum, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw new Error("Asset details have an invalid format.");
  const text = value.trim();
  if ((required && !text) || text.length > maximum) throw new Error("Asset details are missing or too long.");
  return text || null;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("A JSON request body is required.");
  const source = payload.asset;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Asset details are required.");
  const asset = {
    name: cleanText(source.name, 100, true),
    class: cleanText(source.class, 40, true),
    manufacturer: cleanText(source.manufacturer, 80),
    model: cleanText(source.model, 80),
    note: cleanText(source.note, 600),
  };
  let image = null;
  if (payload.image != null) {
    if (typeof payload.image !== "string" || payload.image.length > MAX_IMAGE_CHARS || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(payload.image)) {
      throw new Error("The evidence image is invalid or too large.");
    }
    image = payload.image;
  }
  return { asset, image };
}

async function enforceRateLimit(context) {
  const store = context.env.VALUATION_RATE_LIMITS;
  if (!store) return { configured: false };
  const address = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = `valuation:${day}:${address}`;
  const used = Number(await store.get(key)) || 0;
  if (used >= DAILY_LIMIT) return { configured: true, allowed: false };
  await store.put(key, String(used + 1), { expirationTtl: 172800 });
  return { configured: true, allowed: true };
}

function extractOutput(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") throw new Error("The model declined to estimate this asset.");
      if (content.type === "output_text") return JSON.parse(content.text);
    }
  }
  throw new Error("The model returned no estimate.");
}

async function handlePost(context) {
  if (!context.env.OPENAI_API_KEY) {
    return json({ code: "NOT_CONFIGURED", error: "AI estimates are not configured yet." }, 503);
  }

  const rateLimit = await enforceRateLimit(context);
  if (!rateLimit.configured) {
    return json({ code: "RATE_LIMIT_NOT_CONFIGURED", error: "AI estimates are not configured yet." }, 503);
  }
  if (!rateLimit.allowed) {
    return json({ code: "RATE_LIMITED", error: "This device has reached today's estimate limit." }, 429);
  }

  let input;
  try {
    const raw = await context.request.text();
    if (!raw || raw.length > MAX_REQUEST_CHARS) throw new Error("The estimate request is empty or too large.");
    input = validatePayload(JSON.parse(raw));
  } catch (error) {
    return json({ code: "INVALID_REQUEST", error: error.message || "The estimate request is invalid." }, 400);
  }

  const assetDescription = JSON.stringify(input.asset);
  const content = [{
    type: "input_text",
    text: `Estimate the current fair-market value in whole US dollars for this physical asset: ${assetDescription}`,
  }];
  if (input.image) content.push({ type: "input_image", image_url: input.image, detail: "low" });

  let openAiResponse;
  try {
    openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: context.env.OPENAI_VALUATION_MODEL || "gpt-5-mini",
        store: false,
        max_output_tokens: 800,
        instructions: "You estimate fair-market value conservatively from user-supplied details and an optional image. You have no live market search, inspection, ownership, title, maintenance, or authenticity verification. Return canEstimate=false when the asset cannot be identified enough to produce a meaningful range. Otherwise use a deliberately broad low/likely/high range, state every material assumption, and lower confidence for missing model, age, condition, location, quantity, configuration, or comparable-sales data. Never describe the result as an appraisal, verified price, collateral value, or guaranteed sale price.",
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "asset_valuation",
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    });
  } catch {
    return json({ code: "UPSTREAM_UNAVAILABLE", error: "The AI estimate service could not be reached." }, 502);
  }

  const upstream = await openAiResponse.json().catch(() => null);
  if (!openAiResponse.ok) {
    console.error("OpenAI valuation request failed", openAiResponse.status, upstream?.error?.code || "unknown");
    return json({ code: "UPSTREAM_ERROR", error: "The AI estimate service is temporarily unavailable." }, 502);
  }

  try {
    const result = extractOutput(upstream);
    if (!result.canEstimate || ![result.low, result.likely, result.high].every(Number.isSafeInteger)) {
      return json({ code: "INSUFFICIENT_DATA", error: result.rationale || "Add more identifying details before requesting an estimate." }, 422);
    }
    if (result.low < 0 || result.low > result.likely || result.likely > result.high) throw new Error("Invalid valuation range");
    const asOf = new Date().toISOString();
    return json({
      valuation: {
        status: "estimated",
        currency: "USD",
        low: result.low,
        likely: result.likely,
        high: result.high,
        confidence: result.confidence,
        assumptions: result.assumptions,
        rationale: result.rationale,
        asOf,
        provider: "openai",
        model: upstream.model || context.env.OPENAI_VALUATION_MODEL || "gpt-5-mini",
        requestId: upstream.id || null,
        basis: "ai_general_knowledge_no_live_comparables",
        disclaimer: "AI estimate only — not an appraisal, verified price, or guarantee of value.",
      },
    });
  } catch {
    return json({ code: "INVALID_UPSTREAM_RESPONSE", error: "The AI estimate service returned an unusable result." }, 502);
  }
}

export async function onRequest(context) {
  const origin = context.request.headers.get("Origin");
  const nativeOrigin = origin === "capacitor://localhost" || origin === "http://localhost";
  if (context.request.method === "OPTIONS") {
    if (!nativeOrigin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  if (context.request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", error: "Method not allowed." }, 405);
  const response = await handlePost(context);
  if (nativeOrigin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

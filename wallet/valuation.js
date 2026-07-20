const MONEY_FIELDS = ["low", "likely", "high"];

export function normalizeValuation(value) {
  if (!value || value.status !== "estimated" || value.currency !== "USD") return null;
  const normalized = { ...value };
  for (const field of MONEY_FIELDS) {
    const amount = Number(value[field]);
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
    normalized[field] = amount;
  }
  if (normalized.low > normalized.likely || normalized.likely > normalized.high) return null;
  if (!['low', 'medium', 'high'].includes(normalized.confidence)) return null;
  return normalized;
}

export function summarizeAnchoredValue(passports) {
  const total = { count: 0, low: 0, likely: 0, high: 0, currency: "USD" };
  for (const passport of passports) {
    if (passport?.status !== "anchored") continue;
    const valuation = normalizeValuation(passport.manifest?.valuation);
    if (!valuation) continue;
    total.count += 1;
    total.low += valuation.low;
    total.likely += valuation.likely;
    total.high += valuation.high;
  }
  return total;
}

export function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export async function requestAiValuation(asset, evidencePhoto, fetchImpl = fetch) {
  const endpoint = location.protocol === "capacitor:" || location.hostname === "localhost"
    ? "https://rwaactivated.com/api/valuation"
    : "/api/valuation";
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset: {
        name: String(asset.name || "").trim(),
        class: String(asset.class || "").trim(),
        manufacturer: String(asset.manufacturer || "").trim() || null,
        model: String(asset.model || "").trim() || null,
        note: String(asset.note || "").trim() || null,
      },
      image: evidencePhoto?.dataUrl || null,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error || "The estimate service is unavailable.");
    error.code = body?.code || "VALUATION_FAILED";
    throw error;
  }

  const valuation = normalizeValuation(body?.valuation);
  if (!valuation) throw new Error("The estimate service returned an invalid result.");
  return valuation;
}

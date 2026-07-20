import test from "node:test";
import assert from "node:assert/strict";
import {
  formatUsd,
  normalizeValuation,
  requestAiValuation,
  summarizeAnchoredValue,
} from "./wallet/valuation.js";
import { preparePassportAnchor } from "./wallet/robinhood.js";
import { onRequest } from "./functions/api/valuation.js";

function estimate(overrides = {}) {
  return {
    status: "estimated",
    currency: "USD",
    low: 800,
    likely: 1000,
    high: 1400,
    confidence: "medium",
    assumptions: ["Used condition"],
    rationale: "Broad general-knowledge range.",
    asOf: "2026-07-20T00:00:00.000Z",
    provider: "openai",
    model: "gpt-5-mini",
    requestId: "resp_test",
    basis: "ai_general_knowledge_no_live_comparables",
    disclaimer: "AI estimate only — not an appraisal, verified price, or guarantee of value.",
    ...overrides,
  };
}

function request(body, origin) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" };
  if (origin) headers.Origin = origin;
  return new Request("https://rwaactivated.com/api/valuation", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function rateStore(initial = 0) {
  let value = initial;
  return {
    async get() { return value ? String(value) : null; },
    async put(_key, next) { value = Number(next); },
    get value() { return value; },
  };
}

test("anchored portfolio includes only valid USD AI estimates", () => {
  const passports = [
    { status: "anchored", manifest: { valuation: estimate() } },
    { status: "local", manifest: { valuation: estimate({ likely: 9000 }) } },
    { status: "revoked", manifest: { valuation: estimate({ likely: 7000 }) } },
    { status: "anchored", manifest: { valuation: estimate({ low: 200, likely: 300, high: 500 }) } },
    { status: "anchored", manifest: { valuation: estimate({ currency: "EUR" }) } },
  ];
  assert.deepEqual(summarizeAnchoredValue(passports), {
    count: 2,
    low: 1000,
    likely: 1300,
    high: 1900,
    currency: "USD",
  });
  assert.equal(formatUsd(1300), "$1,300");
  assert.equal(normalizeValuation(estimate({ low: 2000 })), null);
});

test("manifest hash commits valuation provenance to the chain anchor", async () => {
  const passportId = `0x${"11".repeat(32)}`;
  const physicalClaim = {
    method: "3dpass-grid2d",
    algorithm: "grid2d_v3a",
    implementation: "p3d",
    gridSize: 8,
    sections: 12,
    depth: 10,
    hashes: [`0x${"22".repeat(32)}`],
  };
  const base = { schema: "rwa-object-passport/v1", passportId, asset: { name: "Machine" } };
  const withoutEstimate = await preparePassportAnchor({ passportId, manifest: { ...base, valuation: null }, physicalClaim });
  const withEstimate = await preparePassportAnchor({ passportId, manifest: { ...base, valuation: estimate() }, physicalClaim });
  assert.notEqual(withEstimate.manifestHash, withoutEstimate.manifestHash);
});

test("browser client sends only valuation fields and validates the response", async () => {
  const previousLocation = globalThis.location;
  globalThis.location = { protocol: "https:", hostname: "rwaactivated.com" };
  let sent;
  const valuation = await requestAiValuation({
    name: "Haas VF-2",
    class: "machine",
    manufacturer: "Haas",
    model: "VF-2",
    note: "Operational",
    serialNumber: "private-serial",
    location: "private-location",
  }, null, async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ valuation: estimate() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.location = previousLocation;
  assert.equal(sent.url, "/api/valuation");
  assert.equal(sent.body.asset.serialNumber, undefined);
  assert.equal(sent.body.asset.location, undefined);
  assert.equal(valuation.likely, 1000);
});

test("endpoint stays disabled until both secret and rate-limit store exist", async () => {
  const response = await onRequest({ request: request({ asset: {} }), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "NOT_CONFIGURED");

  const noStore = await onRequest({ request: request({ asset: {} }), env: { OPENAI_API_KEY: "test" } });
  assert.equal(noStore.status, 503);
  assert.equal((await noStore.json()).code, "RATE_LIMIT_NOT_CONFIGURED");
});

test("endpoint returns auditable estimate and permits only the native app origin", async () => {
  const previousFetch = globalThis.fetch;
  let openAiRequest;
  globalThis.fetch = async (_url, options) => {
    openAiRequest = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: "resp_valuation_1",
      model: "gpt-5-mini-2026-06-01",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
        canEstimate: true,
        low: 12000,
        likely: 15000,
        high: 21000,
        confidence: "low",
        assumptions: ["Used working condition", "No live comparable sales"],
        rationale: "Identification is plausible but condition is unverified.",
      }) }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const store = rateStore();
  const response = await onRequest({
    request: request({ asset: { name: "Haas VF-2", class: "machine", manufacturer: "Haas", model: "VF-2", note: null }, image: null }, "capacitor://localhost"),
    env: { OPENAI_API_KEY: "test", VALUATION_RATE_LIMITS: store },
  });
  globalThis.fetch = previousFetch;

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "capacitor://localhost");
  assert.equal(store.value, 1);
  assert.equal(openAiRequest.store, false);
  assert.equal(openAiRequest.input[0].content.some((item) => item.type === "input_image"), false);
  const body = await response.json();
  assert.equal(body.valuation.likely, 15000);
  assert.equal(body.valuation.provider, "openai");
  assert.equal(body.valuation.requestId, "resp_valuation_1");
  assert.match(body.valuation.disclaimer, /not an appraisal/i);
});

test("endpoint blocks exhausted clients before calling OpenAI", async () => {
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not run"); };
  const response = await onRequest({
    request: request({ asset: { name: "Asset", class: "other" }, image: null }),
    env: { OPENAI_API_KEY: "test", VALUATION_RATE_LIMITS: rateStore(8) },
  });
  globalThis.fetch = previousFetch;
  assert.equal(response.status, 429);
  assert.equal(called, false);
});

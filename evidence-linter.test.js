"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const evidence = require("./evidence-linter.js");

const NOW = Date.parse("2026-07-17T01:00:00Z");

function cloneSample() {
  return evidence.sampleManifest();
}

test("the reference passport passes every structural gate", async () => {
  const result = await evidence.lintManifest(cloneSample(), { now: NOW });

  assert.equal(result.valid, true);
  assert.equal(result.status, "ready");
  assert.equal(result.counts.error, 0);
  assert.equal(result.counts.warning, 0);
  assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("canonical fingerprints do not depend on object key insertion order", async () => {
  const sample = cloneSample();
  const reversed = Object.fromEntries(Object.entries(sample).reverse());
  const [first, second] = await Promise.all([
    evidence.lintManifest(sample, { now: NOW }),
    evidence.lintManifest(reversed, { now: NOW }),
  ]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.canonical, second.canonical);
});

test("missing rights terms block preflight", async () => {
  const sample = cloneSample();
  delete sample.rights;
  const result = await evidence.lintManifest(sample, { now: NOW });

  assert.equal(result.valid, false);
  assert.equal(result.status, "blocked");
  assert.ok(result.checks.some((check) => check.id === "rights.current" && check.status === "error"));
});

test("an unsigned evidence record passes with a caution, not a false verification claim", async () => {
  const sample = cloneSample();
  delete sample.evidence[0].proof;
  const result = await evidence.lintManifest(sample, { now: NOW });

  assert.equal(result.valid, true);
  assert.equal(result.status, "ready-with-cautions");
  assert.ok(result.checks.some((check) => check.id === "evidence.0.proof" && check.status === "warning"));
});

test("invalid JSON returns one parse failure and no fingerprint", async () => {
  const result = await evidence.lintManifest("{");

  assert.equal(result.valid, false);
  assert.equal(result.fingerprint, null);
  assert.deepEqual(result.counts, { pass: 0, warning: 0, error: 1 });
  assert.equal(result.checks[0].id, "json.parse");
});

test("future timestamps and broken GTIN check digits are rejected", async () => {
  const sample = cloneSample();
  sample.createdAt = "2026-07-18T01:00:00Z";
  sample.asset.identifiers[0].value = "09506000134353";
  const result = await evidence.lintManifest(sample, { now: NOW });

  assert.equal(result.valid, false);
  assert.ok(result.checks.some((check) => check.id === "manifest.created" && check.status === "error"));
  assert.ok(result.checks.some((check) => check.id === "asset.gtin" && check.status === "error"));
});

test("custody and rights references must resolve inside the passport", async () => {
  const sample = cloneSample();
  sample.custody.evidenceId = sample.evidence[0].id;
  sample.rights.evidenceId = sample.evidence[1].id;
  const result = await evidence.lintManifest(sample, { now: NOW });

  assert.equal(result.valid, false);
  assert.ok(result.checks.some((check) => check.id === "rights.evidence" && check.status === "error"));
});

test("confirmed EVM anchors require a transaction hash", async () => {
  const sample = cloneSample();
  sample.anchors = [{ network: "eip155:4663", status: "confirmed" }];
  const result = await evidence.lintManifest(sample, { now: NOW });

  assert.equal(result.valid, false);
  assert.ok(result.checks.some((check) => check.id === "anchors.shape" && check.status === "error"));
});

test("custom top-level fields must stay behind the extension boundary", async () => {
  const sample = cloneSample();
  sample.vendorData = { internalId: "42" };
  const result = await evidence.lintManifest(sample, { now: NOW });

  assert.equal(result.valid, true);
  assert.equal(result.status, "ready-with-cautions");
  assert.ok(result.checks.some((check) => check.id === "manifest.fields" && check.status === "warning"));
});

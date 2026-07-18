"use strict";

import {
  getReadonlyProvider,
  getRegistry,
  resolvePassport,
} from "../wallet/robinhood.js?v=20260718.1";
import { normalizeBytes32 } from "../wallet/recognition.js?v=20260718.1";
import {
  PROTOCOL_CONTRACTS,
  ROBINHOOD_TESTNET,
} from "../wallet/protocol-config.js?v=20260718.1";

const demo = window.RwaDemo;
const evidenceApi = window.RwaEvidence;
const verifierPanels = [...document.querySelectorAll("[data-verifier-panel]")];
const viewButtons = [...document.querySelectorAll("[data-verifier-view]")];
const verifyForm = document.querySelector("[data-verify-form]");
const queryInput = document.querySelector("#passport-query");
const result = document.querySelector("[data-verification-result]");
const failure = document.querySelector("[data-verification-failure]");
const claimsOutput = document.querySelector("[data-claim-results]");
const factsOutput = document.querySelector("[data-object-facts]");
const timelineOutput = document.querySelector("[data-verifier-timeline]");
const decisionDialog = document.querySelector("[data-decision-dialog]");
const decisionDialogLabel = document.querySelector("[data-decision-dialog-label]");
const decisionDialogContent = document.querySelector("[data-decision-dialog-content]");
const qrDialog = document.querySelector("[data-qr-dialog]");
const toast = document.querySelector("[data-verifier-toast]");
const watchStorageKey = "rwa.verify.watchlist.v1";
const unknownPassportId = `0x${"0".repeat(63)}1`;
const unavailableClaims = Object.freeze([
  { label: "Manifest body", note: "The registry supplies manifestHash, not the manifest JSON." },
  { label: "Physical evidence", note: "physicalId and physicalMethod are commitments; the scan and method record were not supplied." },
  { label: "Issuer signatures", note: "No issuer identity, signature, or signed claim was supplied by the registry read." },
  { label: "Rights & custody", note: "No title, ownership, lien, custody, or control document was supplied." },
  { label: "Source documents", note: "The registry URI is locator metadata and does not establish that offchain sources are available." },
]);

let activeView = "verify";
let activeMode = "search";
let activeIdentity = null;
let activeTitle = null;
let activeRecord = null;
let activeDecisionDetails = {};
let claimFilter = "all";
let lastReport = null;
let requestToken = 0;
let toastTimer = 0;

class PassportNotFoundError extends Error {}

function make(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function select(selector) {
  return document.querySelector(selector);
}

function setText(selector, text) {
  const node = select(selector);
  if (node) node.textContent = text;
}

function setPreviewContext(text) {
  const context = select("[data-preview-context]");
  if (!context) return;
  context.replaceChildren(make("span", "preview-dot"), document.createTextNode(text));
}

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2300);
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat([], { dateStyle: "medium", timeStyle: "long" }).format(date);
}

function shortHex(value, lead = 10, tail = 8) {
  const text = String(value);
  return text.length > lead + tail + 1 ? `${text.slice(0, lead)}…${text.slice(-tail)}` : text;
}

function addressExplorerUrl(address) {
  return `${ROBINHOOD_TESTNET.explorerUrl}/address/${encodeURIComponent(address)}`;
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function replaceUrl(search = "", hash = "") {
  try {
    history.replaceState(null, "", `${location.pathname}${search}${hash}`);
  } catch {
    // A local file preview may not permit History API replacement.
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function readWatchlist() {
  try {
    const stored = JSON.parse(localStorage.getItem(watchStorageKey) || "[]");
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveWatchlist(items) {
  try {
    localStorage.setItem(watchStorageKey, JSON.stringify(items));
    return true;
  } catch {
    showToast("Watchlist storage is unavailable in this browser");
    return false;
  }
}

function updateWatchlistUI() {
  const items = readWatchlist();
  const watched = Boolean(activeIdentity && items.includes(activeIdentity));
  for (const count of document.querySelectorAll("[data-watch-count]")) count.textContent = String(items.length);
  const watchButton = select("[data-watch-passport]");
  if (watchButton) {
    watchButton.disabled = !activeIdentity;
    watchButton.classList.toggle("is-watched", watched);
  }
  setText("[data-watch-label]", watched ? "Watching" : "Add to watchlist");
  setText("[data-watchlist-title]", items.length ? `${items.length} passport${items.length === 1 ? "" : "s"} watched` : "No passports watched");
  setText(
    "[data-watchlist-copy]",
    items.length
      ? "Identifiers are stored only in this browser. Re-resolve them to read current chain state."
      : "Add a resolved passport to remember its identifier in this browser.",
  );
}

function setResultVisibility() {
  for (const panel of verifierPanels) panel.hidden = true;
  result.hidden = false;
  failure.hidden = true;
}

function showView(viewName) {
  activeView = viewName;
  requestToken += 1;
  setSubmitLoading(false);
  result.hidden = true;
  failure.hidden = true;
  for (const panel of verifierPanels) panel.hidden = panel.dataset.verifierPanel !== viewName;
  for (const button of viewButtons) button.classList.toggle("is-active", button.dataset.verifierView === viewName);
  replaceUrl("", viewName === "verify" ? "" : `#${viewName}`);
  if (viewName === "verify") {
    activeMode = "search";
    setPreviewContext("Live registry resolver · Robinhood Testnet");
  }
  scrollToTop();
}

function setSubmitLoading(loading) {
  const submit = verifyForm?.querySelector("button[type=submit]");
  if (!submit) return;
  submit.disabled = loading;
  const arrow = make("span", "", loading ? "" : "→");
  submit.replaceChildren(document.createTextNode(loading ? "Reading registry… " : "Resolve onchain "), arrow);
}

function resetClaimFilter(labels) {
  claimFilter = "all";
  for (const button of document.querySelectorAll("[data-claim-filter]")) {
    button.classList.toggle("is-active", button.dataset.claimFilter === "all");
    if (labels[button.dataset.claimFilter]) button.textContent = labels[button.dataset.claimFilter];
  }
}

function setSummaryTitle(firstLine, secondLine) {
  const heading = select("[data-summary-title]");
  if (!heading) return;
  heading.replaceChildren(document.createTextNode(firstLine), document.createElement("br"), make("em", "", secondLine));
}

function renderDecisionCards(details) {
  activeDecisionDetails = details;
  for (const card of document.querySelectorAll("[data-decision]")) {
    const detail = details[card.dataset.decision];
    if (!detail) continue;
    card.classList.toggle("is-caution", detail.tone === "caution");
    card.classList.toggle("is-pass", detail.tone === "pass");
    const icon = card.querySelector(".decision-icon");
    const state = card.querySelector("h3");
    const summary = card.querySelector("p");
    const button = card.querySelector("button");
    if (icon) icon.textContent = detail.icon;
    if (state) state.textContent = detail.state;
    if (summary) summary.textContent = detail.summary;
    if (button) button.replaceChildren(document.createTextNode(`${detail.action} `), make("i", "", "›"));
  }
}

function liveDecisionDetails(record) {
  const notSupplied = (label, summary, facts, action) => ({
    label,
    state: "Not supplied",
    tone: "caution",
    icon: "—",
    summary,
    action,
    facts,
  });
  return {
    structure: notSupplied(
      "Structural validity",
      "The registry returned a manifest hash, but no manifest body was supplied for parsing, schema validation, or hash comparison.",
      [["Manifest hash", record.manifestHash], ["Manifest body", "Not supplied"], ["Schema result", "Not evaluated"], ["Hash comparison", "Not performed"]],
      "No manifest",
    ),
    identity: notSupplied(
      "Physical identity",
      "physicalId and physicalMethod are onchain commitments. The source capture, method parameters, and recognition result were not supplied.",
      [["Physical ID", record.physicalId], ["Physical method", record.physicalMethod], ["Source capture", "Not supplied"], ["Identity result", "Not evaluated"]],
      "Commitments only",
    ),
    signatures: notSupplied(
      "Accountable signatures",
      "The registry anchor does not include offchain issuer signatures or the claims they may sign.",
      [["Anchored by", record.anchoredBy], ["Controller", record.controller], ["Issuer signatures", "Not supplied"], ["Signature result", "Not evaluated"]],
      "No signatures",
    ),
    rights: notSupplied(
      "Rights and custody",
      "No title, ownership, lien, control, or custody document was supplied. The controller address is protocol control, not legal ownership.",
      [["Protocol controller", record.controller], ["Title record", "Not supplied"], ["Ownership claim", "Not supplied"], ["Custody claim", "Not supplied"]],
      "No claims",
    ),
    sources: notSupplied(
      "Source availability",
      "The URI is registry metadata. This resolver did not retrieve a manifest or any raw evidence from it.",
      [["Registry URI", record.uri || "Empty"], ["Manifest", "Not supplied"], ["Raw evidence", "Not supplied"], ["Availability result", "Not evaluated"]],
      "URI only",
    ),
    anchor: {
      label: "Chain state",
      state: record.revoked ? "Revoked" : "Recorded",
      tone: record.revoked ? "caution" : "pass",
      icon: record.revoked ? "!" : "✓",
      summary: record.revoked
        ? `ObjectPassportRegistry returned version ${record.version}, marked revoked.`
        : `ObjectPassportRegistry returned version ${record.version}, not marked revoked.`,
      action: "Registry fields",
      facts: [["Network", ROBINHOOD_TESTNET.chainName], ["Registry", PROTOCOL_CONTRACTS.registry], ["Version", String(record.version)], ["Anchored at", record.anchoredAt], ["Anchored by", record.anchoredBy], ["Controller", record.controller], ["Revoked", record.revoked ? "Yes" : "No"]],
    },
  };
}

function sampleDecisionDetails(structuralReport) {
  const structureChecks = structuralReport ? `${structuralReport.counts.pass} local checks` : "Sample manifest";
  return {
    structure: { label: "Structural validity", state: "Passed", tone: "pass", icon: "✓", summary: "The bundled sample manifest parses and is checked locally against the prototype evidence rules.", action: structureChecks, facts: [["Data mode", "SAMPLE DATA"], ["Schema", "evidence-passport.schema.json · v0.1.0"], ["Canonicalization", "Deterministic JSON"], ["Runtime", "Local browser preflight"]] },
    identity: { label: "Physical identity", state: "Passed", tone: "pass", icon: "✓", summary: "Sample recognition content links a sample source capture, algorithm, parameters, and version.", action: "99.2% sample", facts: [["Data mode", "SAMPLE DATA"], ["Method", "Grid2d"], ["Adapter", "RWA Scan Adapter v0.4"], ["Confidence", "99.2% sample value"]] },
    signatures: { label: "Accountable signatures", state: "Passed", tone: "pass", icon: "✓", summary: "The Atlas scenario includes sample issuer, custodian, and inspector signatures.", action: "5 sample signatures", facts: [["Data mode", "SAMPLE DATA"], ["Issuer", "Atlas Heavy Systems"], ["Custodian", "Northline Equipment Services"], ["Current", "5 of 5 in sample"]] },
    rights: { label: "Rights and custody", state: "Passed", tone: "pass", icon: "✓", summary: "The sample represents rights and custody as separate attributed claims; it does not establish a legal conclusion.", action: "2 sample claims", facts: [["Data mode", "SAMPLE DATA"], ["Rights source", "Signed equipment schedule"], ["Rights signer", "Red River Equipment Holdings"], ["Custody signer", "Northline Equipment Services"]] },
    sources: { label: "Source availability", state: "Caution", tone: "caution", icon: "!", summary: "The sample scenario marks one time-sensitive insurance document as expiring soon.", action: "1 sample caution", facts: [["Data mode", "SAMPLE DATA"], ["Available", "7 of 7 in sample"], ["Expiring", "Insurance declaration"], ["Expiry", "August 14, 2026"]] },
    anchor: { label: "Chain state", state: "Sample only", tone: "caution", icon: "!", summary: "The Atlas anchor, transaction, block, and confirmation values are illustrative and were not read from Robinhood Testnet.", action: "Not a chain read", facts: [["Data mode", "SAMPLE DATA"], ["Network label", "Robinhood Testnet"], ["Revision", "7 (sample)"], ["Chain lookup", "Not performed"]] },
  };
}

function renderClaimEmpty() {
  const empty = make("aside", "verification-boundary");
  empty.append(make("span", "", "No results in this filter"), make("p", "", activeMode === "live" ? "No offchain claim received a passing status because no offchain claim content was supplied." : "The labeled sample has no claims in this status."));
  claimsOutput.replaceChildren(empty);
}

function renderClaims() {
  if (!claimsOutput) return;
  const claims = activeMode === "sample" && demo ? demo.claims : unavailableClaims;
  const selected = claims.filter((claim) => {
    if (claimFilter === "all") return true;
    if (activeMode === "live") return claimFilter === "warning";
    return claim.status === claimFilter;
  });
  if (!selected.length) {
    renderClaimEmpty();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const claim of selected) {
    const sampleClaim = activeMode === "sample";
    const warning = sampleClaim ? claim.status === "warning" : true;
    const details = make("details", `claim-result${warning ? " is-warning" : ""}`);
    const summary = make("summary");
    const icon = make("span", "claim-result-icon", sampleClaim ? (warning ? "!" : "✓") : "—");
    const copy = make("div");
    copy.append(
      make("small", "", claim.label),
      make("b", "", sampleClaim ? claim.value : "Not supplied"),
      make("p", "", sampleClaim ? claim.source : claim.note),
    );
    const signer = make("div", "claim-result-signer");
    signer.append(
      make("small", "", sampleClaim ? "Sample signer" : "Registry evidence"),
      make("b", "", sampleClaim ? claim.signer : "Hash commitment only"),
    );
    const state = make("span", "claim-result-state", sampleClaim ? (warning ? "Caution · sample" : "Passed · sample") : "Not supplied");
    summary.append(icon, copy, signer, state, make("i", "", "⌄"));

    const body = make("div", "claim-result-body");
    const facts = sampleClaim
      ? [["Data mode", "SAMPLE DATA"], ["Source", claim.source], ["Signer", claim.signer], ["Updated", formatDate(claim.updatedAt)]]
      : [["Chain field", "Commitment only"], ["Manifest body", "Not supplied"], ["Claim check", "Not performed"], ["Status", "No pass/fail assigned"]];
    for (const [label, value] of facts) {
      const fact = make("div");
      fact.append(make("span", "", label), make("b", "", value));
      body.append(fact);
    }
    details.append(summary, body);
    fragment.append(details);
  }
  claimsOutput.replaceChildren(fragment);
}

function createExternalLink(text, href) {
  const link = make("a", "", text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = text;
  return link;
}

function renderFacts(rows) {
  if (!factsOutput) return;
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const wrapper = make("div");
    const term = make("dt", "", row.label);
    const description = make("dd");
    description.title = row.value;
    if (row.href) description.append(createExternalLink(row.value, row.href));
    else description.append(document.createTextNode(row.value));
    if (row.copy) {
      const copy = make("button", "", "Copy");
      copy.type = "button";
      copy.dataset.copyValue = row.value;
      description.append(copy);
    }
    wrapper.append(term, description);
    fragment.append(wrapper);
  }
  factsOutput.replaceChildren(fragment);
}

function renderLiveFacts(record) {
  const uriHref = safeHttpUrl(record.uri);
  renderFacts([
    { label: "Passport ID", value: record.passportId, copy: true },
    { label: "Version", value: String(record.version) },
    { label: "Manifest hash", value: record.manifestHash, copy: true },
    { label: "Physical ID", value: record.physicalId, copy: true },
    { label: "Physical method", value: record.physicalMethod, copy: true },
    { label: "Anchored at", value: `${formatDate(record.anchoredAt)} · ${record.anchoredAt}` },
    ...(record.transactionHash ? [{ label: "Anchor transaction", value: record.transactionHash, href: `${ROBINHOOD_TESTNET.explorerUrl}/tx/${record.transactionHash}`, copy: true }] : []),
    ...(record.blockNumber !== null ? [{ label: "Anchor block", value: String(record.blockNumber), href: `${ROBINHOOD_TESTNET.explorerUrl}/block/${record.blockNumber}` }] : []),
    { label: "Anchored by", value: record.anchoredBy, href: addressExplorerUrl(record.anchoredBy), copy: true },
    { label: "Controller", value: record.controller, href: addressExplorerUrl(record.controller), copy: true },
    { label: "Revoked", value: record.revoked ? "Yes" : "No" },
    { label: "URI", value: record.uri || "Empty", href: uriHref, copy: Boolean(record.uri) },
    { label: "Registry", value: PROTOCOL_CONTRACTS.registry, href: addressExplorerUrl(PROTOCOL_CONTRACTS.registry), copy: true },
    { label: "Network", value: `${ROBINHOOD_TESTNET.chainName} · chain ${ROBINHOOD_TESTNET.chainId}`, href: ROBINHOOD_TESTNET.explorerUrl },
  ]);
}

function renderSampleFacts() {
  renderFacts([
    { label: "Sample object ID", value: demo.asset.objectId, copy: true },
    { label: "Sample fingerprint", value: demo.asset.fingerprint, copy: true },
    { label: "Sample controller", value: demo.asset.controller },
    { label: "Sample custodian", value: demo.asset.custodian },
    { label: "Network label", value: `${demo.anchor.network} · sample only` },
    { label: "Sample transaction", value: `${demo.anchor.transaction} · not an explorer-confirmed transaction` },
  ]);
}

function renderLiveTimeline(record) {
  if (!timelineOutput) return;
  const row = make("div", "revision-event");
  row.append(make("span", "revision-event-icon is-anchor", record.revoked ? "!" : "✓"));
  const copy = make("div");
  copy.append(
    make("b", "", `Version ${record.version} anchor`),
    make("p", "", `${record.revoked ? "Revoked" : "Not revoked"} · anchored by ${shortHex(record.anchoredBy, 8, 6)}${record.blockNumber !== null ? ` · block ${record.blockNumber}` : ""}`),
    make("small", "", formatDate(record.anchoredAt)),
  );
  row.append(copy);
  timelineOutput.replaceChildren(row);
}

function renderSampleTimeline() {
  if (!timelineOutput || !demo) return;
  const fragment = document.createDocumentFragment();
  for (const item of demo.timeline.slice(0, 4)) {
    const row = make("div", "revision-event");
    row.append(make("span", `revision-event-icon is-${item.type}`, item.type === "anchor" ? "!" : item.type === "scan" ? "⌁" : "✎"));
    const copy = make("div");
    copy.append(make("b", "", `${item.title} · SAMPLE`), make("p", "", item.detail), make("small", "", formatDate(item.timestamp)));
    row.append(copy);
    fragment.append(row);
  }
  timelineOutput.replaceChildren(fragment);
}

async function runStructuralPreflight() {
  if (!evidenceApi) return null;
  try {
    return await evidenceApi.lintManifest(JSON.stringify(evidenceApi.sampleManifest()));
  } catch {
    return null;
  }
}

async function resolveChainRecord(query) {
  const passportId = normalizeBytes32(query);
  const provider = getReadonlyProvider();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== ROBINHOOD_TESTNET.chainId) {
    throw new Error(`Unexpected chain ${network.chainId}`);
  }
  const registry = getRegistry(provider);
  const version = await registry.latestVersion(passportId);
  if (version === 0n) throw new PassportNotFoundError(passportId);
  const record = await resolvePassport(passportId, provider);
  if (record.version !== Number(version)) throw new Error("Registry version changed during resolution");
  let anchorEvent = null;
  try {
    const events = await registry.queryFilter(registry.filters.PassportAnchored(passportId, version), 0, "latest");
    anchorEvent = events.at(-1) || null;
  } catch {
    // Event lookup is supplemental; the resolved contract state remains authoritative.
  }
  return Object.freeze({
    ...record,
    transactionHash: anchorEvent?.transactionHash || null,
    blockNumber: anchorEvent?.blockNumber ?? null,
  });
}

function renderLiveResult(record, readAt) {
  activeMode = "live";
  activeIdentity = record.passportId;
  activeTitle = `Passport ${shortHex(record.passportId)}`;
  activeRecord = record;
  setResultVisibility();
  result.dataset.resultMode = "live";
  setPreviewContext("Live registry state · Robinhood Testnet");
  setText("[data-object-mark]", "RWA");
  setText("[data-object-kicker]", "ROBINHOOD TESTNET · LIVE ONCHAIN ANCHOR");
  setText("[data-object-title]", activeTitle);
  setText("[data-object-subtitle]", `${record.passportId} · ${record.revoked ? "revoked" : "not revoked"}`);
  setText("[data-revision-label]", "Latest version");
  setText("[data-revision-value]", String(record.version));
  setText("[data-revision-time]", `Anchored ${formatDate(record.anchoredAt)}`);

  setText("[data-summary-icon]", record.revoked ? "!" : "✓");
  setText("[data-summary-state]", record.revoked ? "CHAIN RECORD RESOLVED · REVOKED" : "CHAIN RECORD RESOLVED");
  setSummaryTitle("Anchor found.", record.revoked ? "Latest version is revoked." : "Offchain claims not supplied.");
  setText("[data-summary-copy]", `ObjectPassportRegistry returned version ${record.version}. The resolver displays that chain state exactly; it did not retrieve or verify a manifest, signatures, source files, title, ownership, custody, or value.`);
  setText("[data-pass-count]", "1");
  setText("[data-pass-label]", "Anchor resolved");
  setText("[data-caution-count]", "0");
  setText("[data-caution-label]", "Claims checked");
  setText("[data-fail-count]", record.revoked ? "Yes" : "No");
  setText("[data-fail-label]", "Revoked");
  setText("[data-verified-time]", formatDate(readAt));
  setText("[data-timestamp-note]", "Live registry state can change after this read.");

  setText("[data-decision-index]", "Chain state vs. offchain evidence");
  setText("[data-decision-title]", "What this resolution establishes");
  setText("[data-decision-copy]", "An onchain commitment and the evidence behind it are separate. Unavailable evidence receives no passing status.");
  renderDecisionCards(liveDecisionDetails(record));

  setText("[data-evidence-index]", "Offchain claim content");
  setText("[data-evidence-title]", "Not supplied by the registry");
  resetClaimFilter({ all: `All ${unavailableClaims.length}`, verified: "Passed 0", warning: `Not supplied ${unavailableClaims.length}` });
  renderClaims();

  setText("[data-facts-index]", "Live contract read");
  setText("[data-facts-title]", "Registry fields");
  renderLiveFacts(record);
  setText("[data-timeline-index]", "Latest known state");
  setText("[data-timeline-title]", "Anchor event");
  renderLiveTimeline(record);
  setText("[data-boundary-label]", "What this chain read does not prove");
  setText("[data-boundary-copy]", "An anchor hash does not prove title, ownership, value, authenticity, current custody, source availability, or the truth of any offchain claim. Raw evidence remains offchain and was not retrieved by this resolver.");
  setText("[data-export-label]", "Export chain read");

  lastReport = {
    generatedAt: readAt.toISOString(),
    mode: "live-registry-read",
    network: { chainId: ROBINHOOD_TESTNET.chainId, name: ROBINHOOD_TESTNET.chainName, rpcUrl: ROBINHOOD_TESTNET.rpcUrls[0] },
    registry: PROTOCOL_CONTRACTS.registry,
    passport: record,
    offchainClaims: { supplied: false, status: "not evaluated" },
    limitations: "An anchor hash does not verify title, ownership, value, custody, authenticity, or offchain claim truth.",
  };
  updateWatchlistUI();
  replaceUrl(`?id=${encodeURIComponent(record.passportId)}`);
  scrollToTop();
}

async function renderSampleResult() {
  if (!demo) {
    showToast("Sample data is unavailable");
    return;
  }
  const token = ++requestToken;
  setSubmitLoading(true);
  const structuralReport = await runStructuralPreflight();
  if (token !== requestToken) return;
  setSubmitLoading(false);
  const readAt = new Date();
  activeMode = "sample";
  activeIdentity = `sample:${demo.asset.objectId}`;
  activeTitle = `${demo.asset.name} · SAMPLE`;
  activeRecord = null;
  setResultVisibility();
  result.dataset.resultMode = "sample";
  setPreviewContext("Interactive prototype · SAMPLE DATA");
  setText("[data-object-mark]", "HX");
  setText("[data-object-kicker]", "SAMPLE DATA · NOT A LIVE REGISTRY READ");
  setText("[data-object-title]", demo.asset.name);
  setText("[data-object-subtitle]", `${demo.asset.serial} · ${demo.asset.location} · illustrative scenario`);
  setText("[data-revision-label]", "Sample revision");
  setText("[data-revision-value]", String(demo.asset.revision));
  setText("[data-revision-time]", "Illustrative anchor timing");

  setText("[data-summary-icon]", "!");
  setText("[data-summary-state]", "SAMPLE DATA · NOT CHAIN CONFIRMED");
  setSummaryTitle("Sample checks complete.", "One sample caution.");
  setText("[data-summary-copy]", "This Atlas scenario demonstrates the full manifest and claim interface using bundled sample content. Its anchor, transaction, block, confirmation, signatures, and claims are not live chain confirmations.");
  setText("[data-pass-count]", "6");
  setText("[data-pass-label]", "Sample passes");
  setText("[data-caution-count]", "1");
  setText("[data-caution-label]", "Sample caution");
  setText("[data-fail-count]", "0");
  setText("[data-fail-label]", "Sample failures");
  setText("[data-verified-time]", formatDate(readAt));
  setText("[data-timestamp-note]", "This is a local prototype result using bundled sample data.");

  setText("[data-decision-index]", "Sample decision view");
  setText("[data-decision-title]", "What the sample interface can show");
  setText("[data-decision-copy]", "Every value below is part of the labeled Atlas sample. It is not evidence about a live passport.");
  renderDecisionCards(sampleDecisionDetails(structuralReport));

  setText("[data-evidence-index]", "SAMPLE ACCOUNTABLE CLAIMS");
  setText("[data-evidence-title]", "Illustrative evidence behind the sample");
  resetClaimFilter({ all: `All ${demo.claims.length} · sample`, verified: `Passed ${demo.claims.filter((claim) => claim.status === "verified").length} · sample`, warning: `Caution ${demo.claims.filter((claim) => claim.status === "warning").length} · sample` });
  renderClaims();

  setText("[data-facts-index]", "SAMPLE OBJECT STATE");
  setText("[data-facts-title]", "Illustrative passport facts");
  renderSampleFacts();
  setText("[data-timeline-index]", "SAMPLE REVISION HISTORY");
  setText("[data-timeline-title]", "Illustrative events");
  renderSampleTimeline();
  setText("[data-boundary-label]", "What this sample result does not prove");
  setText("[data-boundary-copy]", "The Atlas scenario is sample data. It proves nothing about a real object, chain transaction, title, ownership, value, authenticity, custody, or regulatory status.");
  setText("[data-export-label]", "Export sample report");

  lastReport = {
    generatedAt: readAt.toISOString(),
    mode: "sample-data",
    simulation: true,
    object: demo.asset,
    anchor: { ...demo.anchor, liveChainConfirmation: false },
    summary: { passed: 6, caution: 1, failed: 0 },
    structuralPreflight: structuralReport,
    claims: demo.claims,
  };
  updateWatchlistUI();
  replaceUrl("?sample=atlas-hx320");
  scrollToTop();
}

function showFailure(kind, query) {
  for (const panel of verifierPanels) panel.hidden = true;
  result.hidden = true;
  failure.hidden = false;
  const state = select("[data-failure-state]");
  const title = select("[data-failure-title]");
  const message = select("[data-failure-message]");
  const code = make("code", "", query);
  if (kind === "invalid") {
    if (state) state.textContent = "INVALID ID";
    if (title) title.textContent = "A bytes32 passport ID is required.";
    if (message) message.replaceChildren(document.createTextNode("The value "), code, document.createTextNode(" is not 0x followed by exactly 64 hexadecimal characters. No chain claim was made."));
  } else if (kind === "not-found") {
    if (state) state.textContent = "NOT FOUND";
    if (title) title.textContent = "No registry anchor was found.";
    if (message) message.replaceChildren(document.createTextNode("ObjectPassportRegistry.latestVersion returned 0 for "), code, document.createTextNode(" on Robinhood Testnet."));
  } else {
    if (state) state.textContent = "READ FAILED";
    if (title) title.textContent = "Robinhood Testnet could not be read.";
    if (message) message.replaceChildren(document.createTextNode("The resolver could not establish current registry state for "), code, document.createTextNode(". Retry before relying on a result."));
  }
  activeMode = "failure";
  activeIdentity = null;
  activeTitle = null;
  activeRecord = null;
  lastReport = null;
  updateWatchlistUI();
  setPreviewContext("Registry resolution failed · no result claimed");
  replaceUrl(`?id=${encodeURIComponent(query)}`);
  scrollToTop();
}

async function showResult(query) {
  const trimmed = String(query || "").trim();
  const token = ++requestToken;
  setSubmitLoading(true);
  for (const panel of verifierPanels) panel.hidden = true;
  result.hidden = true;
  failure.hidden = true;

  let passportId;
  try {
    passportId = normalizeBytes32(trimmed);
  } catch {
    if (token === requestToken) {
      setSubmitLoading(false);
      showFailure("invalid", trimmed);
    }
    return;
  }

  try {
    const record = await resolveChainRecord(passportId);
    if (token !== requestToken) return;
    setSubmitLoading(false);
    renderLiveResult(record, new Date());
  } catch (error) {
    if (token !== requestToken) return;
    setSubmitLoading(false);
    showFailure(error instanceof PassportNotFoundError ? "not-found" : "network", passportId);
  }
}

function loadDemo() {
  void renderSampleResult();
}

function exportReport() {
  if (!lastReport) {
    showToast("Resolve a passport or open the labeled sample first");
    return;
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  const suffix = activeMode === "live" ? activeIdentity.slice(-12) : "atlas-sample";
  link.href = url;
  link.download = `rwa-resolution-${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast(activeMode === "live" ? "Dated chain read downloaded" : "Labeled sample report downloaded");
}

function openDecision(key) {
  const detail = activeDecisionDetails[key];
  if (!detail || !decisionDialogContent || !decisionDialog) return;
  if (decisionDialogLabel) decisionDialogLabel.textContent = detail.label;
  const header = make("div", `decision-dialog-header ${detail.tone === "caution" ? "is-caution" : "is-pass"}`);
  header.append(make("span", "", detail.icon));
  const copy = make("div");
  copy.append(make("small", "", detail.label), make("h2", "", detail.state), make("p", "", detail.summary));
  header.append(copy);
  const facts = make("dl", "decision-dialog-facts");
  for (const [label, value] of detail.facts) {
    const fact = make("div");
    fact.append(make("dt", "", label), make("dd", "", value));
    facts.append(fact);
  }
  const note = make(
    "p",
    "decision-dialog-note",
    activeMode === "live"
      ? "This is a dated, read-only registry result. Offchain content was not supplied or evaluated."
      : "SAMPLE DATA: this illustrative result is not a live registry or source verification.",
  );
  decisionDialogContent.replaceChildren(header, facts, note);
  decisionDialog.showModal();
}

for (const button of viewButtons) button.addEventListener("click", () => showView(button.dataset.verifierView));

verifyForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!verifyForm.reportValidity()) return;
  void showResult(queryInput.value);
});

for (const button of document.querySelectorAll("[data-load-demo]")) button.addEventListener("click", loadDemo);
select("[data-load-invalid]")?.addEventListener("click", () => {
  showView("verify");
  queryInput.value = unknownPassportId;
  void showResult(unknownPassportId);
});
for (const button of document.querySelectorAll("[data-back-to-search]")) {
  button.addEventListener("click", () => {
    showView("verify");
    window.setTimeout(() => queryInput?.select(), 160);
  });
}

for (const button of document.querySelectorAll("[data-claim-filter]")) {
  button.addEventListener("click", () => {
    claimFilter = button.dataset.claimFilter;
    for (const candidate of document.querySelectorAll("[data-claim-filter]")) candidate.classList.toggle("is-active", candidate === button);
    renderClaims();
  });
}

for (const button of document.querySelectorAll("[data-open-decision]")) button.addEventListener("click", () => openDecision(button.dataset.openDecision));

select("[data-watch-passport]")?.addEventListener("click", () => {
  if (!activeIdentity) return;
  const items = readWatchlist();
  const index = items.indexOf(activeIdentity);
  if (index >= 0) items.splice(index, 1);
  else items.push(activeIdentity);
  if (!saveWatchlist(items)) return;
  updateWatchlistUI();
  showToast(index >= 0 ? "Removed from watchlist" : `${activeTitle || "Passport"} added to watchlist`);
});

for (const button of document.querySelectorAll("[data-export-verification]")) button.addEventListener("click", exportReport);

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-value]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copyValue);
    showToast("Value copied");
  } catch {
    showToast("Copy is unavailable in this browser");
  }
});

select("[data-scan-qr]")?.addEventListener("click", () => qrDialog?.showModal());
select("[data-use-demo-qr]")?.addEventListener("click", () => {
  qrDialog?.close();
  loadDemo();
});
select("[data-network-menu]")?.addEventListener("click", () => showToast(`${ROBINHOOD_TESTNET.chainName} is the read-only resolver network`));
select("[data-view-full-history]")?.addEventListener("click", () => {
  if (activeMode !== "live") {
    showToast("Sample events have no live explorer history");
    return;
  }
  window.open(addressExplorerUrl(PROTOCOL_CONTRACTS.registry), "_blank", "noopener,noreferrer");
});

updateWatchlistUI();

const params = new URLSearchParams(location.search);
const requestedId = params.get("id") || params.get("q");
if (requestedId) {
  queryInput.value = requestedId;
  void showResult(requestedId);
} else if (params.get("sample") === "atlas-hx320") {
  loadDemo();
} else {
  const requestedView = location.hash.slice(1);
  showView(["results", "watchlist", "exports"].includes(requestedView) ? requestedView : "verify");
}

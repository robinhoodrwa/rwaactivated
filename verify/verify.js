"use strict";

(() => {
  const demo = window.RwaDemo;
  const evidenceApi = window.RwaEvidence;
  const verifierPanels = [...document.querySelectorAll("[data-verifier-panel]")];
  const viewButtons = [...document.querySelectorAll("[data-verifier-view]")];
  const verifyForm = document.querySelector("[data-verify-form]");
  const queryInput = document.querySelector("#passport-query");
  const result = document.querySelector("[data-verification-result]");
  const failure = document.querySelector("[data-verification-failure]");
  const failureQuery = document.querySelector("[data-failure-query]");
  const claimsOutput = document.querySelector("[data-claim-results]");
  const timelineOutput = document.querySelector("[data-verifier-timeline]");
  const decisionDialog = document.querySelector("[data-decision-dialog]");
  const decisionDialogLabel = document.querySelector("[data-decision-dialog-label]");
  const decisionDialogContent = document.querySelector("[data-decision-dialog-content]");
  const qrDialog = document.querySelector("[data-qr-dialog]");
  const toast = document.querySelector("[data-verifier-toast]");
  const watchStorageKey = "rwa.verify.watchlist.v1";
  let activeView = "verify";
  let claimFilter = "all";
  let lastReport = null;
  let toastTimer = 0;

  const decisionDetails = {
    structure: {
      label: "Structural validity",
      state: "Passed",
      summary: "The manifest parses, matches the versioned schema, references source digests, and produces a deterministic fingerprint.",
      facts: [["Schema", "evidence-passport.schema.json · v0.1.0"], ["Canonicalization", "Deterministic JSON"], ["Fingerprint", "sha256:79d1…8f21"], ["Runtime", "Local browser preflight"]]
    },
    identity: {
      label: "Physical identity",
      state: "Passed",
      summary: "The recognition result remains linked to the exact source capture, algorithm, parameters, and version that produced it.",
      facts: [["Method", "Grid2d"], ["Adapter", "RWA Scan Adapter v0.4"], ["Confidence", "99.2%"], ["Source", "2.84M-point spatial capture"]]
    },
    signatures: {
      label: "Accountable signatures",
      state: "Passed",
      summary: "Required signatures resolve to their stated claims and remain current at verification time.",
      facts: [["Issuer", "Atlas Heavy Systems"], ["Custodian", "Northline Equipment Services"], ["Inspector", "Independent attester"], ["Current", "5 of 5 required"]]
    },
    rights: {
      label: "Rights and custody",
      state: "Passed",
      summary: "Rights and custody are represented as separate, attributed claims. The result verifies their structure and signatures—not the underlying legal conclusion.",
      facts: [["Rights source", "Signed equipment schedule"], ["Rights signer", "Red River Equipment Holdings"], ["Custody source", "Attestation NLE-2049"], ["Custody signer", "Northline Equipment Services"]]
    },
    sources: {
      label: "Source availability",
      state: "Caution",
      summary: "Every required source resolves, but one time-sensitive document expires soon and should be renewed before relying on it for a later decision.",
      facts: [["Available", "7 of 7 sources"], ["Expiring", "Insurance declaration"], ["Expiry", "August 14, 2026"], ["Action", "Attach renewed policy"]]
    },
    anchor: {
      label: "Chain state",
      state: "Passed",
      summary: "The current manifest fingerprint matches the finalized revision recorded by the public testnet registry.",
      facts: [["Network", "Robinhood Testnet"], ["Revision", "7"], ["Block", "18,492,107"], ["Confirmations", "48"]]
    }
  };

  function make(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showToast(message) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  function watchlist() {
    try {
      const value = JSON.parse(localStorage.getItem(watchStorageKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function updateWatchlistUI() {
    const watched = watchlist().includes(demo.asset.objectId);
    for (const count of document.querySelectorAll("[data-watch-count]")) count.textContent = watched ? "1" : "0";
    const watchButton = document.querySelector("[data-watch-passport]");
    if (watchButton) {
      watchButton.classList.toggle("is-watched", watched);
      watchButton.lastChild.textContent = watched ? " Watching" : " Add to watchlist";
    }
    const title = document.querySelector("[data-watchlist-title]");
    const copy = document.querySelector("[data-watchlist-copy]");
    if (title) title.textContent = watched ? "1 passport watched" : "No passports watched";
    if (copy) copy.textContent = watched ? "Atlas HX-320 is watched for expiry, revision, and revocation changes." : "Add a verified passport to see expiry, revision, and revocation changes here.";
  }

  function showView(viewName) {
    activeView = viewName;
    result.hidden = true;
    failure.hidden = true;
    for (const panel of verifierPanels) panel.hidden = panel.dataset.verifierPanel !== viewName;
    for (const button of viewButtons) button.classList.toggle("is-active", button.dataset.verifierView === viewName);
    history.replaceState(null, "", viewName === "verify" ? location.pathname : `${location.pathname}#${viewName}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  for (const button of viewButtons) button.addEventListener("click", () => showView(button.dataset.verifierView));

  function renderClaims() {
    if (!claimsOutput || !demo) return;
    const selected = demo.claims.filter((claim) => claimFilter === "all" || claim.status === claimFilter);
    const fragment = document.createDocumentFragment();
    for (const claim of selected) {
      const details = make("details", `claim-result is-${claim.status}`);
      const summary = make("summary");
      const icon = make("span", "claim-result-icon", claim.status === "warning" ? "!" : "✓");
      const copy = make("div");
      copy.append(make("small", "", claim.label), make("b", "", claim.value), make("p", "", claim.source));
      const signer = make("div", "claim-result-signer");
      signer.append(make("small", "", "Signed by"), make("b", "", claim.signer));
      const state = make("span", "claim-result-state", claim.status === "warning" ? "Caution" : "Passed");
      summary.append(icon, copy, signer, state, make("i", "", "⌄"));
      const body = make("div", "claim-result-body");
      const facts = [["Source", claim.source], ["Signer", claim.signer], ["Updated", new Intl.DateTimeFormat([], { dateStyle: "medium", timeStyle: "short" }).format(new Date(claim.updatedAt))], ["Status", claim.status === "warning" ? "Current, expiring soon" : "Current and verified"]];
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

  function renderTimeline() {
    if (!timelineOutput || !demo) return;
    const fragment = document.createDocumentFragment();
    for (const item of demo.timeline.slice(0, 4)) {
      const row = make("div", "revision-event");
      row.append(make("span", `revision-event-icon is-${item.type}`, item.type === "anchor" ? "✓" : item.type === "scan" ? "⌁" : "✎"));
      const copy = make("div");
      copy.append(make("b", "", item.title), make("p", "", item.detail), make("small", "", new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.timestamp))));
      row.append(copy);
      fragment.append(row);
    }
    timelineOutput.replaceChildren(fragment);
  }

  function matchesDemo(query) {
    const normalized = query.trim().toLowerCase();
    return normalized.includes("atlas") || normalized.includes("hx320") || normalized.includes("8f21") || normalized === demo.asset.objectId.toLowerCase() || normalized.includes("79d1c4b8");
  }

  async function runStructuralPreflight() {
    if (!evidenceApi) return null;
    try {
      const report = await evidenceApi.lintManifest(JSON.stringify(evidenceApi.sampleManifest()));
      const structureButton = document.querySelector('[data-open-decision="structure"]');
      if (structureButton) structureButton.firstChild.textContent = `${report.counts.pass} checks `;
      return report;
    } catch {
      return null;
    }
  }

  async function showResult(query) {
    for (const panel of verifierPanels) panel.hidden = true;
    failure.hidden = true;
    const submit = verifyForm?.querySelector("button[type=submit]");
    if (submit) {
      submit.disabled = true;
      submit.firstChild.textContent = "Verifying… ";
    }
    await new Promise((resolve) => window.setTimeout(resolve, 460));
    if (submit) {
      submit.disabled = false;
      submit.firstChild.textContent = "Verify passport ";
    }

    if (!matchesDemo(query)) {
      if (failureQuery) failureQuery.textContent = query;
      failure.hidden = false;
      result.hidden = true;
      history.replaceState(null, "", `${location.pathname}?q=${encodeURIComponent(query)}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const structuralReport = await runStructuralPreflight();
    const timestamp = new Date();
    lastReport = {
      generatedAt: timestamp.toISOString(),
      simulation: true,
      object: demo.asset,
      anchor: demo.anchor,
      summary: { passed: 6, caution: 1, failed: 0 },
      structuralPreflight: structuralReport,
      claims: demo.claims
    };
    const verifiedTime = document.querySelector("[data-verified-time]");
    if (verifiedTime) verifiedTime.textContent = new Intl.DateTimeFormat([], { dateStyle: "long", timeStyle: "short" }).format(timestamp);
    renderClaims();
    renderTimeline();
    result.hidden = false;
    failure.hidden = true;
    history.replaceState(null, "", `${location.pathname}?id=${encodeURIComponent(demo.asset.objectId)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  verifyForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!verifyForm.reportValidity()) return;
    showResult(queryInput.value);
  });

  function loadDemo() {
    showView("verify");
    queryInput.value = demo.asset.objectId;
    showResult(queryInput.value);
  }

  for (const button of document.querySelectorAll("[data-load-demo]")) button.addEventListener("click", loadDemo);
  document.querySelector("[data-load-invalid]")?.addEventListener("click", () => {
    showView("verify");
    queryInput.value = "rwa:equipment:unknown:0000";
    showResult(queryInput.value);
  });
  for (const button of document.querySelectorAll("[data-back-to-search]")) button.addEventListener("click", () => {
    showView("verify");
    window.setTimeout(() => queryInput?.select(), 160);
  });

  for (const button of document.querySelectorAll("[data-claim-filter]")) {
    button.addEventListener("click", () => {
      claimFilter = button.dataset.claimFilter;
      for (const candidate of document.querySelectorAll("[data-claim-filter]")) candidate.classList.toggle("is-active", candidate === button);
      renderClaims();
    });
  }

  function openDecision(key) {
    const detail = decisionDetails[key];
    if (!detail || !decisionDialogContent || !decisionDialog) return;
    if (decisionDialogLabel) decisionDialogLabel.textContent = detail.label;
    const header = make("div", `decision-dialog-header ${detail.state === "Caution" ? "is-caution" : "is-pass"}`);
    header.append(make("span", "", detail.state === "Caution" ? "!" : "✓"));
    const copy = make("div");
    copy.append(make("small", "", detail.label), make("h2", "", detail.state), make("p", "", detail.summary));
    header.append(copy);
    const facts = make("dl", "decision-dialog-facts");
    for (const [label, value] of detail.facts) {
      const fact = make("div");
      fact.append(make("dt", "", label), make("dd", "", value));
      facts.append(fact);
    }
    const note = make("p", "decision-dialog-note", "This dated result reflects the available sources, signatures, and chain state at verification time.");
    decisionDialogContent.replaceChildren(header, facts, note);
    decisionDialog.showModal();
  }

  for (const button of document.querySelectorAll("[data-open-decision]")) button.addEventListener("click", () => openDecision(button.dataset.openDecision));

  document.querySelector("[data-watch-passport]")?.addEventListener("click", () => {
    const watched = watchlist();
    const index = watched.indexOf(demo.asset.objectId);
    if (index >= 0) watched.splice(index, 1);
    else watched.push(demo.asset.objectId);
    localStorage.setItem(watchStorageKey, JSON.stringify(watched));
    updateWatchlistUI();
    showToast(index >= 0 ? "Removed from watchlist" : "Passport added to watchlist");
  });

  function exportReport() {
    const report = lastReport || {
      generatedAt: new Date().toISOString(),
      simulation: true,
      object: demo.asset,
      anchor: demo.anchor,
      summary: { passed: 6, caution: 1, failed: 0 },
      claims: demo.claims
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rwa-verification-${demo.asset.objectId.split(":").at(-1)}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Dated verification report downloaded");
  }

  for (const button of document.querySelectorAll("[data-export-verification]")) button.addEventListener("click", exportReport);

  for (const button of document.querySelectorAll("[data-copy-value]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyValue);
        showToast("Value copied");
      } catch {
        showToast("Copy is unavailable in this browser");
      }
    });
  }

  document.querySelector("[data-scan-qr]")?.addEventListener("click", () => qrDialog?.showModal());
  document.querySelector("[data-use-demo-qr]")?.addEventListener("click", () => {
    qrDialog?.close();
    loadDemo();
  });
  document.querySelector("[data-network-menu]")?.addEventListener("click", () => showToast("Robinhood Testnet is the active preview network"));
  document.querySelector("[data-view-full-history]")?.addEventListener("click", () => showToast("Full revision history selected"));

  renderClaims();
  renderTimeline();
  updateWatchlistUI();

  const params = new URLSearchParams(location.search);
  const requested = params.get("id") || params.get("q");
  if (requested) {
    queryInput.value = requested;
    showResult(requested);
  } else {
    const requestedView = location.hash.slice(1);
    showView(["results", "watchlist", "exports"].includes(requestedView) ? requestedView : "verify");
  }
})();

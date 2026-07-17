"use strict";

document.documentElement.classList.add("js");

const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-nav]");
const revealElements = document.querySelectorAll(".reveal");
const navigationLinks = navigation ? [...navigation.querySelectorAll('a[href^="#"]')] : [];
const sections = navigationLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

let scrollFrame = 0;
let pointerFrame = 0;
let pointerX = 80;
let pointerY = 8;

function closeMenu() {
  if (!header || !menuToggle) return;
  header.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
}

function updateHeader() {
  scrollFrame = 0;
  if (header) header.classList.toggle("is-scrolled", window.scrollY > 24);
}

function requestHeaderUpdate() {
  if (scrollFrame) return;
  scrollFrame = window.requestAnimationFrame(updateHeader);
}

if (menuToggle && header) {
  menuToggle.addEventListener("click", () => {
    const isOpen = header.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  navigation?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      menuToggle.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (header.classList.contains("is-open") && !header.contains(event.target)) closeMenu();
  });
}

window.addEventListener("scroll", requestHeaderUpdate, { passive: true });
updateHeader();

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 }
  );

  for (const element of revealElements) revealObserver.observe(element);

  if (sections.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const target = `#${visible.target.id}`;
        for (const link of navigationLinks) {
          if (link.getAttribute("href") === target) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        }
      },
      { rootMargin: "-30% 0px -55%", threshold: [0.01, 0.2, 0.5] }
    );

    for (const section of sections) sectionObserver.observe(section);
  }
} else {
  for (const element of revealElements) element.classList.add("is-visible");
}

for (const year of document.querySelectorAll("[data-year]")) {
  year.textContent = String(new Date().getFullYear());
}

const supportsPointerGlow = window.matchMedia("(pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function paintPointer() {
  pointerFrame = 0;
  document.documentElement.style.setProperty("--pointer-x", `${pointerX}%`);
  document.documentElement.style.setProperty("--pointer-y", `${pointerY}%`);
}

if (supportsPointerGlow) {
  window.addEventListener("pointermove", (event) => {
    pointerX = (event.clientX / window.innerWidth) * 100;
    pointerY = (event.clientY / window.innerHeight) * 100;
    if (!pointerFrame) pointerFrame = window.requestAnimationFrame(paintPointer);
  }, { passive: true });
}

const evidenceLinterForm = document.querySelector("#evidence-linter-form");
const manifestInput = document.querySelector("#manifest-input");
const lintSubmit = document.querySelector("[data-lint-submit]");
const lintExample = document.querySelector("[data-lint-example]");
const lintFormat = document.querySelector("[data-lint-format]");
const lintState = document.querySelector("[data-lint-state]");
const lintSummary = document.querySelector("[data-lint-summary]");
const lintCounts = document.querySelector("[data-lint-counts]");
const lintFingerprint = document.querySelector("[data-lint-fingerprint]");
const lintResults = document.querySelector("[data-lint-results]");
const copyFingerprint = document.querySelector("[data-copy-fingerprint]");
const evidenceApi = window.RwaEvidence;

let lastLintedInput = "";
let currentFingerprint = "";

function setLintState(kind, text) {
  if (!lintState) return;
  lintState.className = `lint-state is-${kind}`;
  lintState.textContent = text;
}

function renderLintChecks(checks) {
  if (!lintResults) return;
  lintResults.replaceChildren();

  for (const check of checks) {
    const item = document.createElement("li");
    item.className = `is-${check.status}`;

    const marker = document.createElement("span");
    marker.textContent = check.status === "pass" ? "P" : check.status === "warning" ? "W" : "E";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    const path = document.createElement("code");
    title.textContent = check.label;
    detail.textContent = check.message;
    path.textContent = check.path;
    copy.append(title, detail, path);
    item.append(marker, copy);
    lintResults.append(item);
  }
}

function renderLintReport(report) {
  const { counts } = report;
  if (report.status === "blocked") {
    setLintState("error", "Blocked");
    lintSummary.textContent = `${counts.error} structural gate${counts.error === 1 ? "" : "s"} failed.`;
  } else if (report.status === "ready-with-cautions") {
    setLintState("warning", "Cautions");
    lintSummary.textContent = "Structural preflight passed with cautions.";
  } else {
    setLintState("ready", "Ready");
    lintSummary.textContent = "Structural preflight passed.";
  }

  lintCounts.textContent = `${counts.pass} passed · ${counts.warning} cautions · ${counts.error} failed`;
  currentFingerprint = report.fingerprint || "";
  lintFingerprint.textContent = currentFingerprint || "Not calculated";
  copyFingerprint.disabled = !currentFingerprint;
  renderLintChecks(report.checks);
}

async function runEvidencePreflight() {
  if (!evidenceApi || !manifestInput || !lintSubmit) return;
  lintSubmit.disabled = true;
  setLintState("running", "Checking");
  lintSummary.textContent = "Canonicalizing and checking the passport…";
  lintCounts.textContent = "Local computation only";

  try {
    const input = manifestInput.value;
    const report = await evidenceApi.lintManifest(input);
    lastLintedInput = input;
    renderLintReport(report);
  } catch (error) {
    renderLintReport({
      status: "blocked",
      fingerprint: null,
      counts: { pass: 0, warning: 0, error: 1 },
      checks: [{
        label: "Preflight runtime",
        status: "error",
        message: error instanceof Error ? error.message : "The linter could not run.",
        path: "$",
      }],
    });
  } finally {
    lintSubmit.disabled = false;
  }
}

if (evidenceLinterForm && manifestInput && evidenceApi) {
  evidenceLinterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runEvidencePreflight();
  });

  lintExample?.addEventListener("click", () => {
    manifestInput.value = JSON.stringify(evidenceApi.sampleManifest(), null, 2);
    runEvidencePreflight();
  });

  lintFormat?.addEventListener("click", () => {
    try {
      manifestInput.value = JSON.stringify(JSON.parse(manifestInput.value), null, 2);
    } catch {
      // The preflight below reports the parse error in context.
    }
    runEvidencePreflight();
  });

  manifestInput.addEventListener("input", () => {
    if (manifestInput.value === lastLintedInput) return;
    setLintState("idle", "Changed");
    lintSummary.textContent = "The input changed. Run the preflight again.";
    lintCounts.textContent = "Previous result is stale";
    copyFingerprint.disabled = true;
  });

  manifestInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runEvidencePreflight();
    }
  });

  copyFingerprint?.addEventListener("click", async () => {
    if (!currentFingerprint) return;
    await navigator.clipboard.writeText(currentFingerprint);
    copyFingerprint.textContent = "Copied";
    window.setTimeout(() => {
      copyFingerprint.textContent = "Copy";
    }, 1600);
  });

  manifestInput.value = JSON.stringify(evidenceApi.sampleManifest(), null, 2);
  runEvidencePreflight();
}

"use strict";

(() => {
  const demo = window.RwaDemo;
  const draftStorageKey = "rwa.studio.drafts.v1";
  const views = [...document.querySelectorAll("[data-studio-view]")];
  const navigationButtons = [...document.querySelectorAll("[data-studio-nav]")];
  const workQueue = document.querySelector("[data-work-queue]");
  const assetTable = document.querySelector("[data-asset-table]");
  const assetCount = document.querySelector("[data-asset-count]");
  const assetSearch = document.querySelector("[data-asset-search]");
  const statusFilter = document.querySelector("[data-status-filter]");
  const assetDialog = document.querySelector("[data-asset-dialog]");
  const assetDetail = document.querySelector("[data-asset-detail]");
  const newPassportDialog = document.querySelector("[data-new-passport-dialog]");
  const newPassportForm = document.querySelector("[data-new-passport-form]");
  const sidebar = document.querySelector("[data-studio-sidebar]");
  const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
  const breadcrumb = document.querySelector("[data-view-breadcrumb]");
  const toast = document.querySelector("[data-studio-toast]");
  const validViews = new Set(views.map((view) => view.dataset.studioView));
  let toastTimer = 0;
  let queueFilter = "all";

  function readDrafts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(draftStorageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.name === "string").slice(0, 25) : [];
    } catch {
      return [];
    }
  }

  let assets = [...readDrafts(), ...(demo?.assets || [])];

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

  function statusClass(value) {
    const normalized = value.toLowerCase();
    if (normalized.includes("fail") || normalized.includes("revoked")) return "is-danger";
    if (normalized.includes("expire") || normalized.includes("due")) return "is-warning";
    if (normalized.includes("anchor") || normalized.includes("ready")) return "is-success";
    return "is-neutral";
  }

  function initials(name) {
    return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }

  function navigate(viewName) {
    if (!validViews.has(viewName)) return;
    for (const view of views) {
      const active = view.dataset.studioView === viewName;
      view.hidden = !active;
      view.classList.toggle("is-active", active);
    }
    for (const button of navigationButtons) button.classList.toggle("is-active", button.dataset.studioNav === viewName);
    if (breadcrumb) breadcrumb.textContent = viewName[0].toUpperCase() + viewName.slice(1);
    history.replaceState(null, "", viewName === "home" ? location.pathname : `${location.pathname}#${viewName}`);
    sidebar?.classList.remove("is-open");
    sidebarToggle?.setAttribute("aria-expanded", "false");
    if (viewName === "assets") renderAssets();
  }

  for (const button of navigationButtons) button.addEventListener("click", () => navigate(button.dataset.studioNav));

  function renderMetrics() {
    if (!demo) return;
    for (const output of document.querySelectorAll("[data-metric]")) {
      const value = demo.metrics[output.dataset.metric];
      output.textContent = typeof value === "number" && Number.isInteger(value) ? value.toLocaleString() : String(value);
    }
  }

  function renderWorkQueue() {
    if (!workQueue || !demo) return;
    const fragment = document.createDocumentFragment();
    const queue = demo.workQueue.filter((item) => queueFilter === "all" || item.priority === queueFilter);
    for (const item of queue) {
      const row = make("button", "table-row work-row");
      row.type = "button";
      row.dataset.assetId = item.id;
      row.setAttribute("role", "row");

      const assetCell = make("span", "table-asset-cell");
      assetCell.setAttribute("role", "cell");
      assetCell.append(make("i", `asset-tile ${item.priority === "danger" ? "is-red" : item.priority === "warning" ? "is-amber" : "is-green"}`, initials(item.asset)));
      const assetCopy = make("span");
      assetCopy.append(make("b", "", item.asset), make("small", "", item.id));
      assetCell.append(assetCopy);

      row.append(assetCell);
      const task = make("span", "", item.task);
      task.setAttribute("role", "cell");
      row.append(task);
      const status = make("span", `table-status is-${item.priority}`, item.status);
      status.setAttribute("role", "cell");
      row.append(status);
      const owner = make("span", "table-owner");
      owner.setAttribute("role", "cell");
      owner.append(make("i", "", initials(item.owner)), make("b", "", item.owner));
      row.append(owner);
      const age = make("span", "", item.age);
      age.setAttribute("role", "cell");
      row.append(age, make("span", "table-chevron", "›"));
      fragment.append(row);
    }
    if (!queue.length) {
      const empty = make("div", "table-empty");
      empty.append(make("span", "", "✓"), make("b", "", "Nothing in this queue"), make("p", "", "Change the filter to see other work."));
      fragment.append(empty);
    }
    workQueue.replaceChildren(fragment);
  }

  function renderAssets() {
    if (!assetTable) return;
    const query = (assetSearch?.value || "").trim().toLowerCase();
    const selectedStatus = statusFilter?.value || "all";
    const filtered = assets.filter((asset) => {
      const matchesStatus = selectedStatus === "all" || asset.status === selectedStatus;
      const haystack = `${asset.id} ${asset.name} ${asset.class} ${asset.location} ${asset.status}`.toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
    const fragment = document.createDocumentFragment();

    for (const asset of filtered) {
      const row = make("button", "table-row asset-row");
      row.type = "button";
      row.dataset.assetId = asset.id;
      row.setAttribute("role", "row");
      const assetCell = make("span", "table-asset-cell");
      assetCell.setAttribute("role", "cell");
      assetCell.append(make("i", `asset-tile ${asset.class === "Vehicle" ? "is-blue" : asset.class === "Machine" ? "is-purple" : "is-amber"}`, initials(asset.name)));
      const copy = make("span");
      copy.append(make("b", "", asset.name), make("small", "", asset.id));
      assetCell.append(copy);
      const assetClass = make("span", "", asset.class);
      assetClass.setAttribute("role", "cell");
      const status = make("span", `registry-status ${statusClass(asset.status)}`, asset.status);
      status.setAttribute("role", "cell");
      const evidence = make("span", "evidence-meter");
      evidence.setAttribute("role", "cell");
      const meter = make("i");
      meter.append(make("b"));
      meter.firstChild.style.width = `${asset.evidence}%`;
      evidence.append(meter, make("em", "", `${asset.evidence}%`));
      const location = make("span", "", asset.location);
      location.setAttribute("role", "cell");
      const updated = make("span", "", asset.updated);
      updated.setAttribute("role", "cell");
      row.append(assetCell, assetClass, status, evidence, location, updated, make("span", "table-chevron", "›"));
      fragment.append(row);
    }

    if (!filtered.length) {
      const empty = make("div", "table-empty");
      empty.append(make("span", "", "⌕"), make("b", "", "No matching assets"), make("p", "", "Try a different object, status, or location."));
      fragment.append(empty);
    }
    assetTable.replaceChildren(fragment);
    if (assetCount) assetCount.textContent = `${filtered.length.toLocaleString()} asset${filtered.length === 1 ? "" : "s"}`;
  }

  function findAsset(assetId) {
    const exact = assets.find((asset) => asset.id === assetId);
    if (exact) return exact;
    if (assetId === "RWA-2048") return demo.assets[0];
    return { id: assetId || "RWA-2048", name: "Atlas HX-320 Excavator", class: "Equipment", status: "Anchored", evidence: 96, updated: "4m", location: "Dallas, TX" };
  }

  function openAsset(assetId) {
    if (!assetDialog || !assetDetail) return;
    const asset = findAsset(assetId);
    const isDemoAsset = asset.id === "RWA-2048";
    const header = make("div", "asset-detail-header");
    header.append(make("span", `asset-detail-mark ${asset.class === "Vehicle" ? "is-blue" : "is-amber"}`, initials(asset.name)));
    const copy = make("div");
    copy.append(make("small", "", `${asset.class.toUpperCase()} · ${asset.id}`), make("h2", "", asset.name), make("p", "", asset.location));
    header.append(copy, make("span", `registry-status ${statusClass(asset.status)}`, asset.status));

    const progress = make("div", "asset-detail-progress");
    const progressCopy = make("div");
    progressCopy.append(make("span", "", "Evidence completeness"), make("b", "", `${asset.evidence}%`));
    const bar = make("i");
    const fill = make("b");
    fill.style.width = `${asset.evidence}%`;
    bar.append(fill);
    progress.append(progressCopy, bar);

    const steps = make("div", "passport-steps");
    const stageNames = ["Object created", "Evidence collected", "Checks passed", isDemoAsset ? "Revision anchored" : "Ready for review"];
    stageNames.forEach((name, index) => {
      const stage = make("div", index < 3 || isDemoAsset ? "is-complete" : "is-current");
      stage.append(make("span", "", index < 3 || isDemoAsset ? "✓" : String(index + 1)), make("b", "", name), make("small", "", index < 3 || isDemoAsset ? "Complete" : "Next action"));
      steps.append(stage);
    });

    const facts = make("dl", "asset-detail-facts");
    const factValues = [
      ["Object ID", isDemoAsset ? demo.asset.objectId : `rwa:draft:${asset.id.toLowerCase()}`],
      ["Controller", isDemoAsset ? demo.asset.controller : "Not assigned"],
      ["Revision", isDemoAsset ? String(demo.asset.revision) : "Draft"],
      ["Network", isDemoAsset ? demo.anchor.network : "Not anchored"]
    ];
    for (const [label, value] of factValues) {
      const fact = make("div");
      fact.append(make("dt", "", label), make("dd", "", value));
      facts.append(fact);
    }

    const actions = make("div", "asset-detail-actions");
    const primary = make("button", "studio-primary-button", isDemoAsset ? "Open evidence" : "Continue setup");
    primary.type = "button";
    primary.addEventListener("click", () => showToast(isDemoAsset ? "Evidence view selected" : "Draft setup selected"));
    const verifier = make("a", "", "Open verifier ↗");
    verifier.href = "../verify/";
    actions.append(primary, verifier);
    assetDetail.replaceChildren(header, progress, steps, facts, actions);
    assetDialog.showModal();
  }

  document.addEventListener("click", (event) => {
    const assetButton = event.target.closest("[data-asset-id]");
    if (assetButton) openAsset(assetButton.dataset.assetId);
  });

  for (const filterButton of document.querySelectorAll("[data-queue-filter]")) {
    filterButton.addEventListener("click", () => {
      queueFilter = filterButton.dataset.queueFilter;
      for (const candidate of document.querySelectorAll("[data-queue-filter]")) candidate.classList.toggle("is-active", candidate === filterButton);
      renderWorkQueue();
    });
  }

  assetSearch?.addEventListener("input", renderAssets);
  statusFilter?.addEventListener("change", renderAssets);

  function openNewPassport() {
    newPassportForm?.reset();
    newPassportDialog?.showModal();
    window.setTimeout(() => newPassportForm?.elements.name?.focus(), 80);
  }

  for (const button of document.querySelectorAll("[data-new-passport]")) button.addEventListener("click", openNewPassport);
  for (const button of document.querySelectorAll("[data-close-new-passport]")) button.addEventListener("click", () => newPassportDialog?.close());

  newPassportForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!newPassportForm.reportValidity()) return;
    const form = new FormData(newPassportForm);
    const nextId = `RWA-${String(2061 + readDrafts().length).padStart(4, "0")}`;
    const draft = {
      id: nextId,
      name: String(form.get("name")).trim(),
      class: String(form.get("class")),
      status: "Draft",
      evidence: 0,
      updated: "now",
      location: String(form.get("location")).trim(),
      serial: String(form.get("serial")).trim()
    };
    const drafts = [draft, ...readDrafts()].slice(0, 25);
    localStorage.setItem(draftStorageKey, JSON.stringify(drafts));
    assets = [draft, ...assets];
    newPassportDialog.close();
    navigate("assets");
    showToast(`${draft.name} draft created`);
    window.setTimeout(() => openAsset(draft.id), 180);
  });

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      simulation: true,
      workspace: "Real World Activated",
      metrics: demo.metrics,
      workQueue: demo.workQueue,
      assets
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rwa-studio-report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Workspace report downloaded");
  }

  for (const button of document.querySelectorAll("[data-export-report]")) button.addEventListener("click", exportReport);

  function renderAuditLog() {
    const output = document.querySelector("[data-audit-list]");
    if (!output || !demo) return;
    const fragment = document.createDocumentFragment();
    for (const item of demo.timeline) {
      const row = make("div", "audit-row");
      row.append(make("span", `audit-symbol is-${item.type}`, item.type === "anchor" ? "✓" : item.type === "scan" ? "⌁" : "✎"));
      const copy = make("div");
      copy.append(make("b", "", item.title), make("p", "", item.detail), make("small", "", new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(item.timestamp))));
      row.append(copy, make("span", "audit-actor", item.type === "anchor" ? "RWA Admin" : item.type === "inspection" ? "Independent Attester" : "System"));
      fragment.append(row);
    }
    output.replaceChildren(fragment);
  }

  sidebarToggle?.addEventListener("click", () => {
    const open = !sidebar?.classList.contains("is-open");
    sidebar?.classList.toggle("is-open", open);
    sidebarToggle.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-studio-action]")?.dataset.studioAction;
    if (!action) return;
    if (action === "search") {
      navigate("assets");
      window.setTimeout(() => assetSearch?.focus(), 80);
      return;
    }
    const messages = {
      notifications: "No unread critical notifications",
      settings: "Workspace settings selected",
      filters: "Advanced filters are shown for product review",
      "health-menu": "Evidence health menu selected",
      "evidence-policy": "Evidence policy selected",
      invite: "Team invitation flow selected"
    };
    showToast(messages[action] || "Control selected");
  });

  renderMetrics();
  renderWorkQueue();
  renderAssets();
  renderAuditLog();
  const initialView = location.hash.slice(1);
  navigate(validViews.has(initialView) ? initialView : "home");
})();

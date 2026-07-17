import {
  buildPhysicalClaim,
  compareRecognition,
  MAX_MODEL_BYTES,
  recognizeModel,
  sha256Bytes,
} from "./recognition.js?v=20260717.3";
import {
  deletePassport,
  exportWalletData,
  getPassport,
  importWalletData,
  listPassports,
  savePassport,
  saveVerification,
} from "./passport-store.js?v=20260717.3";
import {
  anchorPassport,
  connectInjectedWallet,
  connectWalletConnect,
  discoverBrowserProviders,
  formatChainError,
  preparePassportAnchor,
  resolvePassport,
  setPassportRevoked,
} from "./robinhood.js?v=20260717.3";

const appState = {
  passports: [],
  selectedMesh: null,
  recognition: null,
  evidencePhoto: null,
  draftPassport: null,
  preparedAnchor: null,
  connection: null,
  pendingAnchor: false,
  verifyFile: null,
};

const screens = [...document.querySelectorAll("[data-screen]")];
const navButtons = [...document.querySelectorAll("[data-nav]")];
const passportList = document.querySelector("#passport-list");
const emptyPassports = document.querySelector("#empty-passports");
const meshFile = document.querySelector("#mesh-file");
const meshDrop = document.querySelector("#mesh-drop");
const meshFileCard = document.querySelector("#mesh-file-card");
const recognizeButton = document.querySelector("#recognize-mesh");
const recognitionProgress = document.querySelector("#recognition-progress");
const recognitionResult = document.querySelector("#recognition-result");
const recognitionHashes = document.querySelector("#recognition-hashes");
const assetForm = document.querySelector("#asset-form");
const passportDialog = document.querySelector("#passport-dialog");
const walletDialog = document.querySelector("#wallet-dialog");
const walletDialogMessage = document.querySelector("#wallet-dialog-message");
const browserWalletList = document.querySelector("#browser-wallet-list");
const toast = document.querySelector("#toast");
let toastTimer;

function randomBytes32() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let output = "0x";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function shorten(value, left = 8, right = 6) {
  const text = String(value || "");
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function titleCase(value) {
  return String(value || "asset").replace(/(^|[-_\s])\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3_500);
}

function currentScreen() {
  return screens.find((screen) => !screen.hidden)?.dataset.screen || "home";
}

function navigate(screenName, { replace = false } = {}) {
  const target = screens.find((screen) => screen.dataset.screen === screenName) || screens[0];
  for (const screen of screens) {
    const active = screen === target;
    screen.hidden = !active;
    screen.classList.toggle("is-active", active);
  }
  for (const button of navButtons) {
    button.classList.toggle("is-active", button.dataset.nav === target.dataset.screen);
  }

  const hash = `#${target.dataset.screen}`;
  if (location.hash !== hash) {
    history[replace ? "replaceState" : "pushState"](null, "", hash);
  }
  window.scrollTo({ top: 0, behavior: "instant" });

  if (target.dataset.screen === "verify") renderVerifyOptions();
}

function resetScanFlow() {
  appState.selectedMesh = null;
  appState.recognition = null;
  appState.evidencePhoto = null;
  appState.draftPassport = null;
  appState.preparedAnchor = null;
  meshFile.value = "";
  assetForm.reset();
  document.querySelector("#evidence-photo").value = "";
  document.querySelector("#photo-preview").hidden = true;
  meshFileCard.hidden = true;
  recognitionProgress.hidden = true;
  recognitionResult.hidden = true;
  recognitionHashes.hidden = true;
  recognitionHashes.textContent = "";
  recognizeButton.disabled = true;
  recognizeButton.innerHTML = "Run local recognition <b>→</b>";
  showScanStep("mesh");
}

function showScanStep(name) {
  const labels = { mesh: "Step 1 of 3", details: "Step 2 of 3", anchor: "Step 3 of 3" };
  for (const section of document.querySelectorAll("[data-scan-step]")) {
    const active = section.dataset.scanStep === name;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  }
  document.querySelector("#scan-step-count").textContent = labels[name];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setSelectedMesh(file) {
  appState.selectedMesh = file;
  appState.recognition = null;
  recognitionResult.hidden = true;
  recognitionHashes.hidden = true;
  recognitionProgress.hidden = true;

  if (!file) {
    meshFile.value = "";
    meshFileCard.hidden = true;
    recognizeButton.disabled = true;
    return;
  }

  document.querySelector("#mesh-file-name").textContent = file.name;
  document.querySelector("#mesh-file-size").textContent = formatBytes(file.size);
  meshFileCard.hidden = false;
  recognizeButton.disabled = false;
  recognizeButton.innerHTML = "Run local recognition <b>→</b>";
}

async function runRecognition() {
  if (appState.recognition) {
    showScanStep("details");
    return;
  }
  if (!appState.selectedMesh) return;

  recognizeButton.disabled = true;
  recognitionProgress.hidden = false;
  recognitionResult.hidden = true;
  const bar = document.querySelector("#recognition-bar");
  const percent = document.querySelector("#recognition-percent");
  const status = document.querySelector("#recognition-status");
  const detail = document.querySelector("#recognition-detail");
  const stages = [
    [12, "Reading mesh geometry", "Parsing OBJ vertices, normals, and faces locally…"],
    [31, "Orienting object", "Computing the center of mass and principal axes…"],
    [57, "Slicing geometry", "Generating the fixed Grid2d cross-sections…"],
    [78, "Building recognition hashes", "Hashing the ordered geometric contours…"],
  ];
  let stageIndex = 0;

  function showStage() {
    const [value, label, description] = stages[Math.min(stageIndex, stages.length - 1)];
    bar.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    status.textContent = label;
    detail.textContent = description;
    stageIndex += 1;
  }

  showStage();
  const stageTimer = window.setInterval(showStage, 460);

  try {
    const result = await recognizeModel(appState.selectedMesh);
    appState.recognition = result;
    window.clearInterval(stageTimer);
    bar.style.width = "100%";
    percent.textContent = "100%";
    status.textContent = "Recognition complete";
    detail.textContent = `${result.implementation} completed the mesh locally.`;
    document.querySelector("#recognition-hash-count").textContent = result.hashes.length;
    document.querySelector("#recognition-time").textContent = `${result.elapsedMs} ms`;
    recognitionHashes.textContent = result.hashes
      .map((hash, index) => `${String(index + 1).padStart(2, "0")}  ${hash}`)
      .join("\n");
    recognitionResult.hidden = false;
    recognizeButton.disabled = false;
    recognizeButton.innerHTML = "Continue to object details <b>→</b>";
  } catch (error) {
    window.clearInterval(stageTimer);
    recognitionProgress.hidden = true;
    recognizeButton.disabled = false;
    showToast(error.message || "Grid2d recognition failed.", true);
  }
}

async function loadImageBitmap(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected evidence image could not be decoded."));
    });
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

async function processEvidencePhoto(file) {
  if (!file.type.startsWith("image/")) throw new TypeError("Choose an image from Camera or Photos.");
  if (file.size > 20 * 1024 * 1024) throw new RangeError("Evidence photos must be 20 MB or smaller.");

  const originalBytes = await file.arrayBuffer();
  const sourceDigest = await sha256Bytes(originalBytes);
  const image = await loadImageBitmap(file);
  const maximumDimension = 1_280;
  const scale = Math.min(1, maximumDimension / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  let preview = await canvasToBlob(canvas, "image/webp", 0.78);
  if (!preview) preview = await canvasToBlob(canvas, "image/jpeg", 0.8);
  if (!preview) throw new Error("The browser could not compress the evidence photo.");

  return {
    sourceDigest,
    mediaType: preview.type,
    originalName: file.name || "camera-evidence",
    width: canvas.width,
    height: canvas.height,
    dataUrl: await blobToDataUrl(preview),
  };
}

function makeManifest(passportId, values) {
  const now = new Date().toISOString();
  const physicalClaim = buildPhysicalClaim(appState.recognition);
  return {
    schema: "rwa-object-passport/v1",
    passportId,
    createdAt: now,
    updatedAt: now,
    asset: {
      name: values.assetName.trim(),
      class: values.assetClass,
      manufacturer: values.manufacturer.trim() || null,
      model: values.model.trim() || null,
      serialNumber: values.serialNumber.trim() || null,
      location: values.location.trim() || null,
      note: values.note.trim() || null,
    },
    physicalClaim,
    evidence: appState.evidencePhoto
      ? [
          {
            type: "photo",
            sourceDigest: appState.evidencePhoto.sourceDigest,
            mediaType: appState.evidencePhoto.mediaType,
            width: appState.evidencePhoto.width,
            height: appState.evidencePhoto.height,
            capturedAt: now,
          },
        ]
      : [],
    declarations: {
      reviewedByOperator: true,
      limitations:
        "Geometry recognition does not establish legal ownership, title, custody, condition, authenticity, valuation, liens, or transfer rights.",
    },
  };
}

async function createLocalPassport(event) {
  event.preventDefault();
  const message = document.querySelector("#asset-form-message");
  message.textContent = "";
  if (!appState.recognition) {
    showScanStep("mesh");
    showToast("Run Grid2d recognition before creating the passport.", true);
    return;
  }
  if (!assetForm.reportValidity()) return;

  const values = Object.fromEntries(new FormData(assetForm));
  const passportId = randomBytes32();
  const manifest = makeManifest(passportId, values);
  const passport = {
    passportId,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    status: "local",
    manifest,
    recognition: structuredClone(appState.recognition),
    evidencePhoto: appState.evidencePhoto ? structuredClone(appState.evidencePhoto) : null,
    anchor: null,
    lastVerifiedAt: null,
  };

  try {
    await savePassport(passport);
    appState.passports = await listPassports();
    appState.draftPassport = passport;
    appState.preparedAnchor = await preparePassportAnchor({
      passportId,
      manifest,
      physicalClaim: manifest.physicalClaim,
    });
    populateAnchorReview(passport);
    renderPassports();
    showScanStep("anchor");
  } catch (error) {
    message.textContent = error.message || "The passport could not be saved locally.";
  }
}

function populateAnchorReview(passport) {
  document.querySelector("#review-class").textContent = titleCase(passport.manifest.asset.class);
  document.querySelector("#review-name").textContent = passport.manifest.asset.name;
  document.querySelector("#review-passport-id").textContent = shorten(passport.passportId, 10, 8);
  document.querySelector("#review-source-digest").textContent = shorten(
    passport.recognition.sourceDigest,
    10,
    8,
  );
  document.querySelector("#review-hash-count").textContent = `${passport.recognition.hashes.length} hashes`;
  document.querySelector("#review-state").textContent = passport.status === "anchored" ? "Anchored" : "Local draft";
  document.querySelector("#anchor-status").hidden = true;
  document.querySelector("#anchor-passport").disabled = false;
  updateAnchorButton();
}

function updateAnchorButton() {
  const button = document.querySelector("#anchor-passport");
  button.innerHTML = appState.connection
    ? "Approve testnet anchor <b>→</b>"
    : "Connect Robinhood Wallet <b>→</b>";
}

async function performAnchor() {
  if (!appState.draftPassport || !appState.preparedAnchor) return;
  if (!appState.connection) {
    appState.pendingAnchor = true;
    walletDialog.showModal();
    return;
  }

  const button = document.querySelector("#anchor-passport");
  const status = document.querySelector("#anchor-status");
  button.disabled = true;
  status.hidden = false;

  try {
    let receipt;
    let onchain;
    status.textContent = "Checking Robinhood testnet for an existing anchor…";
    try {
      const existing = await resolvePassport(
        appState.draftPassport.passportId,
        appState.connection.browserProvider,
      );
      const prepared = appState.preparedAnchor;
      const matchesPrepared = ["manifestHash", "physicalId", "physicalMethod"].every(
        (field) => existing[field].toLowerCase() === prepared[field].toLowerCase(),
      );
      if (matchesPrepared) onchain = existing;
    } catch {
      // A missing record is the normal first-anchor path.
    }

    if (!onchain) {
      status.textContent = "Waiting for approval in Robinhood Wallet…";
      receipt = await anchorPassport(appState.connection, appState.preparedAnchor);
      status.textContent = "Transaction confirmed. Resolving the onchain passport…";
      onchain = await resolvePassport(
        appState.draftPassport.passportId,
        appState.connection.browserProvider,
      );
    } else {
      status.textContent = "Matching onchain anchor found. Recovering local state…";
    }

    const updated = {
      ...appState.draftPassport,
      status: onchain.revoked ? "revoked" : "anchored",
      updatedAt: new Date().toISOString(),
      anchor: {
        ...appState.preparedAnchor,
        ...(receipt || {}),
        ...onchain,
      },
    };
    await savePassport(updated);
    appState.draftPassport = updated;
    appState.passports = await listPassports();
    renderPassports();
    document.querySelector("#review-state").textContent = onchain.revoked ? "Revoked" : "Anchored";
    const transactionLink = receipt?.explorerUrl
      ? ` <a href="${escapeHtml(receipt.explorerUrl)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>`
      : "";
    status.innerHTML = `Anchored as version ${onchain.version}.${transactionLink}`;
    button.textContent = onchain.revoked ? "Anchor is revoked" : "Anchored on Robinhood testnet";
    showToast("Passport anchored on Robinhood Chain testnet.");
  } catch (error) {
    status.textContent = formatChainError(error);
    button.disabled = false;
  }
}

function renderPassports() {
  passportList.replaceChildren();
  emptyPassports.hidden = appState.passports.length > 0;
  passportList.hidden = appState.passports.length === 0;

  for (const passport of appState.passports) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "passport-card";
    button.dataset.passportId = passport.passportId;
    const status = passport.status === "anchored" ? "Anchored" : passport.status === "revoked" ? "Revoked" : "Local only";
    button.innerHTML = `
      <div class="passport-card-top">
        <span class="passport-class-badge">${escapeHtml(titleCase(passport.manifest.asset.class))}</span>
        <span class="status ${passport.status === "anchored" ? "is-anchored" : ""}">${status}</span>
      </div>
      <h3>${escapeHtml(passport.manifest.asset.name)}</h3>
      <p>${escapeHtml([passport.manifest.asset.manufacturer, passport.manifest.asset.model].filter(Boolean).join(" · ") || "Object passport")}</p>
      <code>${escapeHtml(shorten(passport.passportId, 12, 9))}</code>`;
    button.addEventListener("click", () => openPassportDetails(passport.passportId));
    passportList.append(button);
  }
}

async function openPassportDetails(passportId) {
  const passport = await getPassport(passportId);
  if (!passport) return;
  const content = document.querySelector("#passport-dialog-content");
  const asset = passport.manifest.asset;
  const anchor = passport.anchor;
  content.innerHTML = `
    <div class="detail-hero">
      <span class="passport-class-badge">${escapeHtml(titleCase(asset.class))}</span>
      <h2>${escapeHtml(asset.name)}</h2>
      <p>${passport.status === "anchored" ? `Robinhood testnet · version ${anchor?.version ?? 1}` : "Private local passport"}</p>
    </div>
    <section class="detail-section">
      <h3>Object record</h3>
      <dl class="detail-list">
        <div><dt>Passport ID</dt><dd>${escapeHtml(passport.passportId)}</dd></div>
        <div><dt>Manufacturer</dt><dd>${escapeHtml(asset.manufacturer || "Not claimed")}</dd></div>
        <div><dt>Model</dt><dd>${escapeHtml(asset.model || "Not claimed")}</dd></div>
        <div><dt>Serial</dt><dd>${escapeHtml(asset.serialNumber || "Not claimed")}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml(asset.location || "Not claimed")}</dd></div>
        <div><dt>Grid2d hashes</dt><dd>${passport.recognition.hashes.length}</dd></div>
        <div><dt>Source digest</dt><dd>${escapeHtml(passport.recognition.sourceDigest)}</dd></div>
        ${anchor ? `<div><dt>Manifest hash</dt><dd>${escapeHtml(anchor.manifestHash)}</dd></div><div><dt>Controller</dt><dd>${escapeHtml(anchor.controller || anchor.anchoredBy)}</dd></div><div><dt>Transaction</dt><dd><a href="${escapeHtml(anchor.explorerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shorten(anchor.transactionHash, 12, 10))} ↗</a></dd></div>` : ""}
      </dl>
    </section>
    <div class="detail-actions">
      <button class="secondary-button" type="button" data-detail-action="verify" data-passport-id="${escapeHtml(passport.passportId)}">Verify rescan</button>
      ${passport.status === "local" ? `<button class="primary-button" type="button" data-detail-action="anchor" data-passport-id="${escapeHtml(passport.passportId)}">Anchor passport <b>→</b></button>` : ""}
      ${passport.status === "anchored" ? `<button class="secondary-button" type="button" data-detail-action="share" data-passport-id="${escapeHtml(passport.passportId)}">Share resolver</button>` : ""}
      ${passport.status === "anchored" && appState.connection?.account?.toLowerCase() === String(anchor?.controller).toLowerCase() ? `<button class="secondary-button" type="button" data-detail-action="revoke" data-passport-id="${escapeHtml(passport.passportId)}">Revoke version</button>` : ""}
      <button class="secondary-button" type="button" data-detail-action="delete" data-passport-id="${escapeHtml(passport.passportId)}">Delete local copy</button>
    </div>`;
  passportDialog.showModal();
}

async function handleDetailAction(event) {
  const button = event.target.closest("[data-detail-action]");
  if (!button) return;
  const passport = await getPassport(button.dataset.passportId);
  if (!passport) return;

  if (button.dataset.detailAction === "verify") {
    passportDialog.close();
    navigate("verify");
    document.querySelector("#verify-passport").value = passport.passportId;
    updateReferenceSummary();
  }

  if (button.dataset.detailAction === "anchor") {
    passportDialog.close();
    appState.draftPassport = passport;
    appState.preparedAnchor = await preparePassportAnchor({
      passportId: passport.passportId,
      manifest: passport.manifest,
      physicalClaim: passport.manifest.physicalClaim,
    });
    populateAnchorReview(passport);
    navigate("scan");
    showScanStep("anchor");
  }

  if (button.dataset.detailAction === "share") {
    const url = passport.anchor?.uri;
    if (navigator.share) await navigator.share({ title: passport.manifest.asset.name, url });
    else {
      await navigator.clipboard.writeText(url);
      showToast("Resolver URL copied.");
    }
  }

  if (button.dataset.detailAction === "revoke") {
    if (!appState.connection) {
      passportDialog.close();
      walletDialog.showModal();
      return;
    }
    button.disabled = true;
    try {
      const result = await setPassportRevoked(
        appState.connection,
        passport.passportId,
        passport.anchor.version,
        true,
      );
      const updated = {
        ...passport,
        status: "revoked",
        updatedAt: new Date().toISOString(),
        anchor: { ...passport.anchor, revoked: true, revocationTransaction: result.transactionHash },
      };
      await savePassport(updated);
      appState.passports = await listPassports();
      renderPassports();
      passportDialog.close();
      showToast("Passport version revoked on Robinhood testnet.");
    } catch (error) {
      button.disabled = false;
      showToast(formatChainError(error), true);
    }
  }

  if (button.dataset.detailAction === "delete") {
    if (!window.confirm("Delete this passport from this browser? An onchain anchor, if any, cannot be deleted.")) return;
    await deletePassport(passport.passportId);
    appState.passports = await listPassports();
    renderPassports();
    passportDialog.close();
    showToast("Local passport copy deleted.");
  }
}

function renderVerifyOptions() {
  const select = document.querySelector("#verify-passport");
  const selected = select.value;
  select.replaceChildren(new Option("Choose a passport", ""));
  for (const passport of appState.passports) {
    select.add(new Option(passport.manifest.asset.name, passport.passportId));
  }
  if (appState.passports.some((passport) => passport.passportId === selected)) select.value = selected;
  updateVerificationButton();
}

async function updateReferenceSummary() {
  const passportId = document.querySelector("#verify-passport").value;
  const summary = document.querySelector("#reference-summary");
  if (!passportId) {
    summary.hidden = true;
    updateVerificationButton();
    return;
  }
  const passport = await getPassport(passportId);
  summary.innerHTML = `<b>${escapeHtml(passport.manifest.asset.name)}</b><br>${passport.recognition.hashes.length} reference hashes · ${escapeHtml(passport.recognition.implementation)}`;
  summary.hidden = false;
  updateVerificationButton();
}

function updateVerificationButton() {
  document.querySelector("#run-verification").disabled = !(
    document.querySelector("#verify-passport").value && appState.verifyFile
  );
}

async function runVerification() {
  const passport = await getPassport(document.querySelector("#verify-passport").value);
  if (!passport || !appState.verifyFile) return;
  const button = document.querySelector("#run-verification");
  const outcome = document.querySelector("#verification-outcome");
  button.disabled = true;
  button.textContent = "Running Grid2d locally…";
  outcome.hidden = true;

  try {
    const candidate = await recognizeModel(appState.verifyFile);
    const comparison = compareRecognition(passport.recognition.hashes, candidate.hashes);
    const verification = {
      verificationId: randomBytes32(),
      passportId: passport.passportId,
      verifiedAt: new Date().toISOString(),
      recognized: comparison.recognized,
      matches: comparison.matches,
      sourceDigest: candidate.sourceDigest,
      implementation: candidate.implementation,
      profile: candidate.profile,
    };
    await saveVerification(verification);
    await savePassport({
      ...passport,
      updatedAt: verification.verifiedAt,
      lastVerifiedAt: verification.verifiedAt,
    });
    appState.passports = await listPassports();
    renderPassports();

    outcome.className = `verification-outcome ${comparison.recognized ? "is-match" : "is-no-match"}`;
    outcome.innerHTML = comparison.recognized
      ? `<h2>Geometry recognized</h2><p>The rescan shares ${comparison.matches.length} Grid2d ${comparison.matches.length === 1 ? "hash" : "hashes"} with the reference. This authenticates a geometry match under the same profile; it does not establish title, condition, or ownership.</p>`
      : `<h2>No geometry match</h2><p>The rescan shares no Grid2d hashes with the reference. This can mean a different object, incomplete coverage, mesh damage, or materially different scan settings. Re-scan before making a decision.</p>`;
    outcome.innerHTML += `<dl><div><dt>Reference</dt><dd>${comparison.referenceCount}</dd></div><div><dt>Candidate</dt><dd>${comparison.candidateCount}</dd></div><div><dt>Matches</dt><dd>${comparison.matches.length}</dd></div></dl>`;
    outcome.hidden = false;
  } catch (error) {
    showToast(error.message || "The rescan could not be recognized.", true);
  } finally {
    button.innerHTML = "Compare Grid2d hashes <b>→</b>";
    updateVerificationButton();
  }
}

function updateWalletUi() {
  const buttons = [
    document.querySelector("#connect-wallet"),
    document.querySelector("#settings-connect-wallet"),
  ];
  const connected = Boolean(appState.connection);
  buttons[0].classList.toggle("is-connected", connected);
  buttons[0].querySelector(".wallet-button-label").textContent = connected
    ? shorten(appState.connection.account, 6, 4)
    : "Connect wallet";
  buttons[1].textContent = connected ? "Disconnect wallet" : "Connect a wallet";
  document.querySelector("#settings-wallet-state").textContent = connected
    ? `${appState.connection.walletName} ${appState.connection.account} is connected on Robinhood Chain Testnet.`
    : "Not connected. Every transaction requires explicit approval in your wallet.";
  updateAnchorButton();
}

function bindConnectionLifecycle(connection) {
  connection.eip1193.on?.("disconnect", () => {
    if (appState.connection !== connection) return;
    appState.connection = null;
    updateWalletUi();
    showToast("Wallet disconnected.", true);
  });
  connection.eip1193.on?.("accountsChanged", (accounts) => {
    if (appState.connection !== connection) return;
    if (String(accounts?.[0] || "").toLowerCase() === connection.account.toLowerCase()) return;
    appState.connection = null;
    updateWalletUi();
    showToast("Wallet account changed. Reconnect before publishing.", true);
  });
}

async function disconnectCurrentWallet() {
  const connection = appState.connection;
  if (!connection) return;
  appState.connection = null;
  updateWalletUi();
  walletDialog.close();
  try {
    await connection.eip1193.disconnect?.();
    showToast("Wallet disconnected.");
  } catch (error) {
    showToast(formatChainError(error), true);
  }
}

async function connectWallet(connector, sourceButton, busyMessage, closeForExternalModal = false) {
  const buttons = [...document.querySelectorAll("[data-wallet-connector]")];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  walletDialogMessage.textContent = busyMessage;
  if (closeForExternalModal) walletDialog.close();

  try {
    const connection = await connector();
    appState.connection = connection;
    bindConnectionLifecycle(connection);
    updateWalletUi();
    walletDialogMessage.textContent = "";
    walletDialog.close();
    showToast(`${connection.walletName || "Wallet"} connected.`);
    if (appState.pendingAnchor) {
      appState.pendingAnchor = false;
      await performAnchor();
    }
  } catch (error) {
    if (closeForExternalModal && !walletDialog.open) walletDialog.showModal();
    walletDialogMessage.textContent = formatChainError(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    sourceButton?.blur();
  }
}

function connectMobileWallet(event) {
  return connectWallet(
    connectWalletConnect,
    event.currentTarget,
    "Opening the secure wallet chooser…",
    true,
  );
}

function connectBrowserWallet(providerDetail, button) {
  return connectWallet(
    () => connectInjectedWallet(providerDetail),
    button,
    `Connecting ${providerDetail.info.name}…`,
  );
}

async function renderBrowserWalletOptions() {
  browserWalletList.replaceChildren();
  const status = document.createElement("p");
  status.className = "wallet-provider-empty";
  status.textContent = "Looking for browser wallets…";
  browserWalletList.append(status);

  const providers = await discoverBrowserProviders();
  browserWalletList.replaceChildren();
  if (!providers.length) {
    status.textContent = "No browser wallet detected. Use WalletConnect, or open this page inside your wallet's browser.";
    browserWalletList.append(status);
    return;
  }

  for (const providerDetail of providers) {
    const button = document.createElement("button");
    button.className = "secondary-button full-button wallet-provider-button";
    button.type = "button";
    button.dataset.walletConnector = "";
    button.textContent = `Use ${providerDetail.info.name}`;
    button.addEventListener("click", () => connectBrowserWallet(providerDetail, button));
    browserWalletList.append(button);
  }
}

function openWalletDialog() {
  walletDialogMessage.textContent = "";
  if (!walletDialog.open) walletDialog.showModal();
  renderBrowserWalletOptions().catch((error) => {
    browserWalletList.textContent = error.message || "Browser wallet discovery failed.";
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveBackupKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function createEncryptedBackup() {
  const passphrase = window.prompt("Create a backup passphrase (12+ characters). It cannot be recovered by RWA Passport.");
  if (passphrase === null) return;
  if (passphrase.length < 12) throw new Error("Use at least 12 characters for the backup passphrase.");
  const confirmation = window.prompt("Re-enter the backup passphrase.");
  if (confirmation !== passphrase) throw new Error("Backup passphrases did not match.");

  const payload = await exportWalletData();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 310_000;
  const key = await deriveBackupKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const backup = {
    format: "rwa-passport-wallet-backup/v1",
    cipher: "AES-256-GCM",
    kdf: { name: "PBKDF2-SHA256", iterations, salt: bytesToBase64(salt) },
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `rwa-passport-wallet-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  showToast("Encrypted wallet backup downloaded.");
}

async function restoreEncryptedBackup(file) {
  const backup = JSON.parse(await file.text());
  if (backup?.format !== "rwa-passport-wallet-backup/v1") {
    throw new TypeError("Choose an encrypted RWA Passport Wallet backup.");
  }
  const passphrase = window.prompt("Enter this backup's passphrase.");
  if (passphrase === null) return;
  const salt = base64ToBytes(backup.kdf.salt);
  const iv = base64ToBytes(backup.iv);
  const key = await deriveBackupKey(passphrase, salt, backup.kdf.iterations);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      base64ToBytes(backup.ciphertext),
    );
  } catch {
    throw new Error("The backup passphrase is wrong or the file was modified.");
  }
  await importWalletData(JSON.parse(new TextDecoder().decode(plaintext)));
  appState.passports = await listPassports();
  renderPassports();
  renderVerifyOptions();
  showToast("Encrypted wallet backup restored.");
}

function installEventHandlers() {
  document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) {
      const destination = go.dataset.go;
      if (destination === "scan" && currentScreen() !== "scan") resetScanFlow();
      navigate(destination);
    }
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      if (nav.dataset.nav === "scan" && currentScreen() !== "scan") resetScanFlow();
      navigate(nav.dataset.nav);
    }
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "home", { replace: true }));

  meshFile.addEventListener("change", () => setSelectedMesh(meshFile.files[0] || null));
  document.querySelector("#remove-mesh").addEventListener("click", () => setSelectedMesh(null));
  recognizeButton.addEventListener("click", runRecognition);
  document.querySelector("#show-hashes").addEventListener("click", () => {
    recognitionHashes.hidden = !recognitionHashes.hidden;
    document.querySelector("#show-hashes").textContent = recognitionHashes.hidden ? "Inspect" : "Hide";
  });
  for (const eventName of ["dragenter", "dragover"]) {
    meshDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      meshDrop.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    meshDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      meshDrop.classList.remove("is-dragging");
    });
  }
  meshDrop.addEventListener("drop", (event) => setSelectedMesh(event.dataTransfer.files[0] || null));

  assetForm.addEventListener("submit", createLocalPassport);
  document.querySelector("[data-scan-back='mesh']").addEventListener("click", () => showScanStep("mesh"));
  document.querySelector("#evidence-photo").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      appState.evidencePhoto = await processEvidencePhoto(file);
      document.querySelector("#photo-image").src = appState.evidencePhoto.dataUrl;
      document.querySelector("#photo-preview").hidden = false;
    } catch (error) {
      event.target.value = "";
      showToast(error.message, true);
    }
  });
  document.querySelector("#remove-photo").addEventListener("click", () => {
    appState.evidencePhoto = null;
    document.querySelector("#evidence-photo").value = "";
    document.querySelector("#photo-preview").hidden = true;
  });
  document.querySelector("#finish-locally").addEventListener("click", () => {
    showToast("Passport saved privately on this device.");
    resetScanFlow();
    navigate("home");
  });
  document.querySelector("#anchor-passport").addEventListener("click", performAnchor);

  document.querySelector("#verify-passport").addEventListener("change", updateReferenceSummary);
  document.querySelector("#verify-file").addEventListener("change", (event) => {
    appState.verifyFile = event.target.files[0] || null;
    document.querySelector("#verify-file-name").textContent = appState.verifyFile?.name || "No file selected";
    document.querySelector("#verification-outcome").hidden = true;
    updateVerificationButton();
  });
  document.querySelector("#run-verification").addEventListener("click", runVerification);

  document.querySelector("#connect-wallet").addEventListener("click", openWalletDialog);
  document.querySelector("#settings-connect-wallet").addEventListener("click", () => {
    if (appState.connection) disconnectCurrentWallet();
    else openWalletDialog();
  });
  document.querySelector("#connect-walletconnect").addEventListener("click", connectMobileWallet);
  document.querySelector("#refresh-browser-wallets").addEventListener("click", () => {
    renderBrowserWalletOptions().catch((error) => {
      browserWalletList.textContent = error.message || "Browser wallet discovery failed.";
    });
  });
  document.querySelector("#passport-dialog-content").addEventListener("click", handleDetailAction);

  document.querySelector("#export-wallet").addEventListener("click", async () => {
    try {
      await createEncryptedBackup();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  document.querySelector("#import-wallet").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      await restoreEncryptedBackup(file);
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

async function initialize() {
  installEventHandlers();
  appState.passports = await listPassports();
  renderPassports();
  renderVerifyOptions();
  updateWalletUi();
  navigate(location.hash.slice(1) || "home", { replace: true });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("../sw.js", { scope: "/" }).catch(() => {});
  }
}

initialize().catch((error) => showToast(error.message || "Wallet initialization failed.", true));

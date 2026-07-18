// Proof-to-Capital — RWA ProofGate console.
// Every value shown in the console is read from Robinhood Chain testnet at
// request time. The planner is the only local surface, and says so.

import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  Network,
  formatUnits,
  getAddress,
  id as keccakText,
  isAddress,
  isHexString,
  parseUnits,
} from "../wallet/vendor/ethers.min.js?v=20260717.3";

import {
  CLAIM_TYPE_LABELS,
  CONTRACTS,
  DEMO_PASSPORT,
  DRAW_REASONS,
  ERC20_ABI,
  FACILITY_STATES,
  NETWORK,
  PROOFGATE_ABI,
  REGISTRY_ABI,
  SETTLEMENT,
} from "./config.js?v=20260718.1";

/* ── DOM helpers ─────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const net = (key) => $(`[data-net="${key}"]`);
const fac = (key) => $(`[data-fac="${key}"]`);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

let toastTimer;
function toast(message) {
  const host = $("[data-toast]");
  if (!host) return;
  host.replaceChildren(el("span", { text: message }));
  host.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove("is-visible"), 4200);
}

/* ── Formatting ──────────────────────────────────────────── */

const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const shortHash = (hex) => `${hex.slice(0, 10)}…${hex.slice(-8)}`;

function fmtUsdg(value) {
  const [whole, frac = ""] = formatUnits(value, SETTLEMENT.decimals).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const cents = frac.replace(/0+$/, "");
  return cents ? `${grouped}.${cents}` : grouped;
}

function fmtWhen(seconds) {
  return new Date(Number(seconds) * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtAge(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const addrUrl = (addr) => `${NETWORK.explorerUrl}/address/${addr}`;
const txUrl = (hash) => `${NETWORK.explorerUrl}/tx/${hash}`;

function addrLink(addr, label = short(addr)) {
  return el("a", { class: "addr-link", href: addrUrl(addr), target: "_blank", rel: "noopener", text: label });
}

const claimLabelByHash = new Map(
  CLAIM_TYPE_LABELS.map((entry) => [keccakText(entry.label), entry]),
);

function describeClaimType(claimType) {
  const known = claimLabelByHash.get(claimType.toLowerCase());
  if (known) return { title: known.title, label: known.label };
  return { title: "Custom claim", label: claimType };
}

function chainErrorText(error) {
  if (error?.code === "ACTION_REJECTED" || error?.code === 4001 || error?.info?.error?.code === 4001) {
    return "Request rejected in wallet.";
  }
  const revert = error?.revert;
  if (revert?.name) {
    const args = revert.args?.length ? `(${revert.args.map(String).join(", ")})` : "";
    return `Reverted: ${revert.name}${args}`;
  }
  if (error?.reason) return `Reverted: ${error.reason}`;
  if (error?.shortMessage) return error.shortMessage;
  return error?.message?.slice(0, 200) || "Unknown error.";
}

/* ── Providers & contracts ───────────────────────────────── */

const readNetwork = Network.from(NETWORK.chainId);
const rpc = new JsonRpcProvider(NETWORK.rpcUrls[0], readNetwork, { staticNetwork: readNetwork });

const registryRead = new Contract(CONTRACTS.registry, REGISTRY_ABI, rpc);
const tokenRead = new Contract(CONTRACTS.settlementToken, ERC20_ABI, rpc);
const gateRead = CONTRACTS.proofGate
  ? new Contract(CONTRACTS.proofGate, PROOFGATE_ABI, rpc)
  : null;

const wallet = { provider: null, signer: null, address: null };
const current = { snapshot: null };

/* ── Network desk ────────────────────────────────────────── */

function setNet(key, node) {
  const host = net(key);
  if (host) host.replaceChildren(node);
}

function toneSpan(tone, text) {
  return el("span", { class: tone, text });
}

async function loadNetworkDesk() {
  const chip = $("[data-network-chip]");
  const chipLabel = $("[data-network-chip-label]");
  try {
    const [chainHex, block, feeData] = await Promise.all([
      rpc.send("eth_chainId", []),
      rpc.getBlock("latest"),
      rpc.getFeeData(),
    ]);
    const chainId = parseInt(chainHex, 16);
    const chainOk = chainId === NETWORK.chainId;
    setNet("status", toneSpan("ok", "connected"));
    setNet("chainId", chainOk
      ? toneSpan("ok", `${chainId} ✓`)
      : toneSpan("bad", `${chainId} — expected ${NETWORK.chainId}`));
    if (block) {
      setNet("block", el("span", { text: `#${block.number.toLocaleString("en-US")}` }));
      const age = Math.max(0, Math.floor(Date.now() / 1000) - block.timestamp);
      setNet("blockAge", el("span", { text: fmtAge(age) }));
    }
    const gas = feeData.gasPrice ?? feeData.maxFeePerGas;
    setNet("gasPrice", el("span", { text: gas != null ? `${formatUnits(gas, "gwei")} gwei` : "unavailable" }));
    if (chip) chip.dataset.tone = chainOk ? "ok" : "bad";
    if (chipLabel) chipLabel.textContent = chainOk ? NETWORK.chainName : "Wrong chain reported";
  } catch {
    setNet("status", toneSpan("bad", "unreachable"));
    for (const key of ["chainId", "block", "blockAge", "gasPrice"]) {
      setNet(key, el("span", { class: "pending-dash", text: "—" }));
    }
    if (chip) chip.dataset.tone = "bad";
    if (chipLabel) chipLabel.textContent = "RPC unreachable";
  }

  // Registry + settlement token metadata (independent of ProofGate deployment).
  try {
    const [registryCode, symbol, name, decimals, totalSupply] = await Promise.all([
      rpc.getCode(CONTRACTS.registry),
      tokenRead.symbol(),
      tokenRead.name(),
      tokenRead.decimals(),
      tokenRead.totalSupply(),
    ]);
    setNet("registry", registryCode !== "0x"
      ? el("span", {}, [toneSpan("ok", "live "), addrLink(CONTRACTS.registry)])
      : toneSpan("bad", "no code at address"));
    const decOk = Number(decimals) === SETTLEMENT.decimals;
    setNet("token", el("span", {}, [
      el("span", { text: `${name} (${symbol}, ${decimals}d) ` }),
      decOk ? null : toneSpan("warn", `expected ${SETTLEMENT.decimals}d `),
      addrLink(CONTRACTS.settlementToken),
    ]));
    setNet("tokenSupply", el("span", { text: `${fmtUsdg(totalSupply)} ${symbol}` }));
  } catch {
    setNet("registry", toneSpan("bad", "read failed"));
    setNet("token", toneSpan("bad", "read failed"));
    setNet("tokenSupply", el("span", { class: "pending-dash", text: "—" }));
  }

  // ProofGate deployment status — honest about absence.
  if (!CONTRACTS.proofGate) {
    setNet("proofgate", toneSpan("warn", "not deployed — pending release"));
    setNet("facilityCount", toneSpan("warn", "unavailable"));
  } else {
    try {
      const [code, nextId, wiredRegistry, wiredToken] = await Promise.all([
        rpc.getCode(CONTRACTS.proofGate),
        gateRead.nextFacilityId(),
        gateRead.passportRegistry(),
        gateRead.settlementToken(),
      ]);
      if (code === "0x") {
        setNet("proofgate", toneSpan("bad", "address configured but no code onchain"));
        setNet("facilityCount", toneSpan("bad", "unavailable"));
      } else {
        const wired =
          wiredRegistry.toLowerCase() === CONTRACTS.registry.toLowerCase() &&
          wiredToken.toLowerCase() === CONTRACTS.settlementToken.toLowerCase();
        setNet("proofgate", el("span", {}, [
          toneSpan(wired ? "ok" : "warn", wired ? "live, wiring verified " : "live, wiring mismatch "),
          addrLink(CONTRACTS.proofGate),
        ]));
        setNet("facilityCount", el("span", { text: (nextId - 1n).toString() }));
      }
    } catch {
      setNet("proofgate", toneSpan("bad", "read failed"));
      setNet("facilityCount", toneSpan("bad", "unavailable"));
    }
  }

  const updated = net("updated");
  if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

/* ── Wallet ──────────────────────────────────────────────── */

async function ensureChain(provider) {
  const chainHex = await provider.request({ method: "eth_chainId" });
  if (parseInt(chainHex, 16) === NETWORK.chainId) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NETWORK.chainHex }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: NETWORK.chainHex,
        chainName: NETWORK.chainName,
        nativeCurrency: { ...NETWORK.nativeCurrency },
        rpcUrls: [...NETWORK.rpcUrls],
        blockExplorerUrls: [NETWORK.explorerUrl],
      }],
    });
  }
}

function renderWalletButton() {
  const button = $("#connect-wallet");
  if (!button) return;
  if (wallet.address) {
    button.textContent = short(wallet.address);
    button.classList.add("is-connected");
    button.setAttribute("aria-label", `Connected as ${wallet.address}. Click to disconnect.`);
  } else {
    button.textContent = "Connect wallet";
    button.classList.remove("is-connected");
    button.removeAttribute("aria-label");
  }
}

async function connectWallet() {
  const injected = window.ethereum;
  if (!injected) {
    toast("No injected wallet found. Install a browser wallet that supports custom EVM networks.");
    return;
  }
  try {
    const accounts = await injected.request({ method: "eth_requestAccounts" });
    if (!accounts?.length) return;
    await ensureChain(injected);
    wallet.provider = new BrowserProvider(injected);
    wallet.signer = await wallet.provider.getSigner();
    wallet.address = getAddress(accounts[0]);
    renderWalletButton();
    refreshRoleViews();
    toast(`Connected ${short(wallet.address)} on ${NETWORK.chainName}.`);
  } catch (error) {
    toast(chainErrorText(error));
  }
}

function disconnectWallet() {
  wallet.provider = null;
  wallet.signer = null;
  wallet.address = null;
  renderWalletButton();
  refreshRoleViews();
}

// Re-render everything role-dependent (parties "you" chips + action cards).
function refreshRoleViews() {
  if (current.snapshot) renderFacility();
  else renderActions();
}

function watchInjected() {
  const injected = window.ethereum;
  if (!injected?.on) return;
  injected.on("accountsChanged", (accounts) => {
    if (!wallet.address) return; // never auto-connect before the user asks
    if (!accounts?.length) { disconnectWallet(); return; }
    wallet.address = getAddress(accounts[0]);
    wallet.provider = new BrowserProvider(injected);
    wallet.provider.getSigner().then((signer) => { wallet.signer = signer; });
    renderWalletButton();
    refreshRoleViews();
  });
  injected.on("chainChanged", () => {
    // BrowserProvider caches the network; rebuild on chain switches.
    if (wallet.address) {
      wallet.provider = new BrowserProvider(injected);
      wallet.provider.getSigner().then((signer) => { wallet.signer = signer; });
    }
    refreshRoleViews();
  });
}

/* ── Facility lookup & rendering ─────────────────────────── */

function lookupStatus(text, tone = "") {
  const host = $("[data-lookup-status]");
  if (!host) return;
  host.textContent = text;
  host.className = `inline-status${tone ? ` is-${tone}` : ""}`;
}

async function loadFacility(facilityId) {
  if (!gateRead) {
    lookupStatus("The ProofGate contract is not deployed yet. Facility reads are unavailable until the deployment address is configured — nothing is simulated.", "error");
    return;
  }
  lookupStatus("Reading facility from chain…");
  const view = $("[data-facility-view]");
  try {
    const [facility, accepted, reqCount, drawCheck, block] = await Promise.all([
      gateRead.facilities(facilityId),
      gateRead.deliveryAccepted(facilityId),
      gateRead.requirementCount(facilityId).catch(() => 0n),
      gateRead.canDraw(facilityId),
      rpc.getBlock("latest"),
    ]);

    if (Number(facility.state) === 0) {
      view.hidden = true;
      current.snapshot = null;
      lookupStatus(`No facility exists with ID ${facilityId}.`, "error");
      return;
    }

    const requirements = await Promise.all(
      Array.from({ length: Number(reqCount) }, (_, i) => gateRead.getRequirement(facilityId, i)),
    );
    const claims = await Promise.all(
      requirements.map((req) => gateRead.getClaim(facilityId, req.claimType)),
    );

    let passport = { version: 0n, anchor: null, controller: null };
    try {
      const version = await registryRead.latestVersion(facility.passportId);
      if (version > 0n) {
        const [anchor, controller] = await Promise.all([
          registryRead.getAnchor(facility.passportId, version),
          registryRead.controllerOf(facility.passportId),
        ]);
        passport = { version, anchor, controller };
      }
    } catch { /* registry read failure renders as not-found below */ }

    current.snapshot = {
      facilityId: BigInt(facilityId),
      facility,
      accepted,
      requirements,
      claims,
      drawCheck,
      passport,
      chainTime: BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000)),
    };
    renderFacility();
    view.hidden = false;
    lookupStatus(`Loaded from chain at block #${block?.number?.toLocaleString("en-US") ?? "—"}.`, "ok");
  } catch (error) {
    view.hidden = true;
    current.snapshot = null;
    lookupStatus(`Chain read failed: ${chainErrorText(error)}`, "error");
  }
}

function claimStatus(req, claim, chainTime) {
  if (claim.digest === "0x" + "0".repeat(64)) return { key: "missing", text: "Missing" };
  if (claim.revoked) return { key: "bad", text: "Revoked" };
  if (claim.expiresAt <= chainTime) return { key: "bad", text: "Expired" };
  if (claim.issuer.toLowerCase() !== req.issuer.toLowerCase()) return { key: "bad", text: "Wrong issuer" };
  return { key: "live", text: "In force" };
}

function renderFacility() {
  const snap = current.snapshot;
  if (!snap) return;
  const { facility, accepted, requirements, claims, drawCheck, passport, chainTime } = snap;
  const stateName = FACILITY_STATES[Number(facility.state)] ?? `Unknown (${facility.state})`;

  fac("id").textContent = `#${snap.facilityId}`;
  const badge = fac("stateBadge");
  badge.textContent = stateName;
  badge.dataset.state = stateName;

  // Verdict.
  const verdict = fac("verdict");
  const ready = drawCheck.ready;
  const reasonIndex = Number(drawCheck.reason);
  const reason = DRAW_REASONS[reasonIndex] ?? { code: "Unknown", text: "Unrecognized reason code." };
  let tone = "warn"; let title; let text;
  if (stateName === "Drawn") {
    tone = "ok"; title = "Capital drawn";
    text = `Principal was paid to the payee. Outstanding repayment: ${fmtUsdg(facility.principal - facility.repaid)} ${SETTLEMENT.symbol}.`;
  } else if (stateName === "Closed") {
    tone = "ok"; title = "Facility closed";
    text = facility.repaid === facility.principal
      ? "Fully repaid and closed."
      : `Closed by lender release with ${fmtUsdg(facility.principal - facility.repaid)} ${SETTLEMENT.symbol} unpaid in-protocol.`;
  } else if (stateName === "Cancelled") {
    tone = "bad"; title = "Facility cancelled";
    text = "The lender cancelled before drawdown; any escrowed funds were refunded.";
  } else if (ready) {
    tone = "ok"; title = "Gate open — draw is ready";
    text = reason.text;
  } else {
    tone = reasonIndex >= 6 ? "bad" : "warn";
    title = `Blocked: ${reason.code.replace(/([a-z])([A-Z])/g, "$1 $2")}`;
    text = reason.text;
    if (reason.code === "MissingClaims") {
      const missing = requirements
        .filter((_, i) => (drawCheck.missingClaimsBitmap >> BigInt(i)) & 1n)
        .map((req) => describeClaimType(req.claimType).title);
      if (missing.length) text += ` Unsatisfied: ${missing.join(", ")}.`;
    }
  }
  verdict.dataset.tone = tone;
  fac("verdictMark").textContent = tone === "ok" ? "●" : tone === "bad" ? "✕" : "◐";
  fac("verdictTitle").textContent = title;
  fac("verdictText").textContent = text;

  // Ledger.
  const sym = ` ${SETTLEMENT.symbol}`;
  fac("principal").textContent = fmtUsdg(facility.principal) + sym;
  fac("funded").textContent = fmtUsdg(facility.funded) + sym;
  fac("drawn").textContent = fmtUsdg(facility.drawn) + sym;
  fac("repaid").textContent = fmtUsdg(facility.repaid) + sym;
  const outstanding = stateName === "Drawn" ? facility.principal - facility.repaid
    : stateName === "Closed" || stateName === "Cancelled" ? 0n
    : facility.principal - facility.funded;
  fac("outstanding").textContent = fmtUsdg(outstanding) + sym;
  $(".ledger-outstanding dt").textContent =
    stateName === "Drawn" ? "Repayment outstanding"
    : stateName === "Closed" || stateName === "Cancelled" ? "Outstanding"
    : "Escrow remaining to fund";

  const drawnLike = stateName === "Drawn" || stateName === "Closed";
  const num = drawnLike ? facility.repaid : facility.funded;
  const pct = facility.principal > 0n ? Number((num * 1000n) / facility.principal) / 10 : 0;
  fac("meterFill").style.width = `${Math.min(100, pct)}%`;
  const meterText = drawnLike
    ? `${pct}% of principal repaid`
    : `${pct}% of principal escrowed`;
  fac("meterCaption").textContent = meterText;
  fac("meterLabelWrap").setAttribute("aria-label", meterText);

  // Checklist mirroring canDraw.
  const anchor = passport.anchor;
  const zero32 = "0x" + "0".repeat(64);
  const checks = [
    {
      pass: stateName === "Funded" || drawnLike,
      warn: stateName === "Created",
      label: "Facility funded state",
      detail: stateName === "Created"
        ? `Waiting on lender escrow — ${fmtUsdg(facility.principal - facility.funded)}${sym} remaining.`
        : `State: ${stateName}.`,
    },
    {
      pass: facility.funded === facility.principal,
      label: "Escrow holds full principal",
      detail: `${fmtUsdg(facility.funded)} of ${fmtUsdg(facility.principal)}${sym} escrowed.`,
    },
    {
      pass: accepted,
      label: "Delivery accepted by borrower",
      detail: accepted
        ? "Borrower confirmed delivery against the live passport."
        : "The borrower has not accepted delivery yet.",
    },
    {
      pass: passport.version > 0n,
      label: "Passport anchored in registry",
      detail: passport.version > 0n
        ? `Version ${passport.version} is the latest anchor.`
        : "No anchored version found for this passport ID.",
    },
    {
      pass: anchor ? !anchor.revoked : false,
      label: "Latest anchor not revoked",
      detail: anchor ? (anchor.revoked ? "The latest anchor is revoked." : "Anchor is live.") : "Unknown until the passport resolves.",
    },
    {
      pass: anchor ? anchor.physicalId === facility.physicalId : false,
      label: "Physical ID matches facility",
      detail: anchor
        ? (anchor.physicalId === facility.physicalId
          ? "Registry and facility agree on the object's physical fingerprint."
          : "The passport now carries a different physical ID than this facility was written against.")
        : "Unknown until the passport resolves.",
    },
    {
      pass: passport.controller
        ? passport.controller.toLowerCase() === facility.borrower.toLowerCase()
        : false,
      label: "Borrower controls the passport",
      detail: passport.controller
        ? (passport.controller.toLowerCase() === facility.borrower.toLowerCase()
          ? "Registry controller equals the facility borrower."
          : `Controller is ${short(passport.controller)}, not the borrower.`)
        : "Unknown until the passport resolves.",
    },
    ...requirements.map((req, i) => {
      const status = claimStatus(req, claims[i], chainTime);
      const info = describeClaimType(req.claimType);
      return {
        pass: status.key === "live",
        warn: status.key === "missing",
        label: `Claim: ${info.title}`,
        detail: status.key === "live"
          ? `In force until ${fmtWhen(claims[i].expiresAt)}.`
          : `${status.text} — issuer ${short(req.issuer)} must publish a valid digest.`,
      };
    }),
  ];
  fac("checklist").replaceChildren(...checks.map((check) => el("li", {
    class: check.pass ? "is-pass" : check.warn ? "is-warn" : "is-fail",
  }, [
    el("span", { class: "check-icon", "aria-hidden": "true", text: check.pass ? "✓" : check.warn ? "…" : "✕" }),
    el("div", { class: "check-body" }, [
      el("b", {}, [
        el("span", { class: "visually-hidden", text: check.pass ? "Satisfied: " : check.warn ? "Pending: " : "Failed: " }),
        check.label,
      ]),
      el("p", { text: check.detail }),
    ]),
  ])));
  const passCount = checks.filter((c) => c.pass).length;
  const tag = fac("checklistTag");
  tag.textContent = ready ? "Ready to draw" : `${passCount}/${checks.length} gates`;
  tag.className = `panel-tag ${ready ? "is-ready" : "is-blocked"}`;

  // Claims table.
  fac("claimRows").replaceChildren(...requirements.map((req, i) => {
    const claim = claims[i];
    const status = claimStatus(req, claim, chainTime);
    const info = describeClaimType(req.claimType);
    const hasClaim = claim.digest !== zero32;
    return el("tr", {}, [
      el("td", { class: "claim-name" }, [
        el("b", { text: info.title }),
        el("code", { text: info.label }),
      ]),
      el("td", {}, [addrLink(req.issuer)]),
      el("td", {}, [hasClaim ? el("code", { text: shortHash(claim.digest), title: claim.digest }) : el("span", { class: "pending-dash", text: "—" })]),
      el("td", {}, [hasClaim ? el("span", { text: fmtWhen(claim.expiresAt) }) : el("span", { class: "pending-dash", text: "—" })]),
      el("td", {}, [el("span", { class: `claim-status is-${status.key}`, text: status.text })]),
    ]);
  }));

  // Parties.
  const me = wallet.address?.toLowerCase();
  const parties = [
    ["Lender", facility.lender, "Escrows principal; can cancel before draw or release after."],
    ["Borrower", facility.borrower, "Accepts delivery and repays; must control the passport."],
    ["Payee", facility.payee, "Equipment vendor — sole destination of the drawdown."],
  ];
  fac("parties").replaceChildren(...parties.map(([role, addr, note]) => el("li", {}, [
    el("span", { class: "party-role" }, [
      role,
      me === addr.toLowerCase() ? el("span", { class: "you-chip", text: "you" }) : null,
    ]),
    addrLink(addr, addr),
    el("p", { class: "check-body", text: note, style: "margin:2px 0 0;color:var(--muted);font-size:11.5px;font-family:var(--sans);" }),
  ])));

  // Passport panel.
  const passRows = [
    ["Passport ID", el("code", { text: facility.passportId })],
    ["Facility physical ID", el("code", { text: facility.physicalId })],
    ["Latest version", passport.version > 0n
      ? el("span", { text: `v${passport.version}` })
      : el("span", { class: "bad", text: "not found" })],
  ];
  if (anchor) {
    passRows.push(
      ["Anchored at", el("span", { text: fmtWhen(anchor.anchoredAt) })],
      ["Anchor status", anchor.revoked
        ? el("span", { class: "bad", text: "revoked" })
        : el("span", { class: "ok", text: "live" })],
      ["Registry physical ID", el("span", {}, [
        el("code", { text: anchor.physicalId }),
        el("span", {
          class: anchor.physicalId === facility.physicalId ? "ok" : "bad",
          text: anchor.physicalId === facility.physicalId ? " (match)" : " (mismatch)",
        }),
      ])],
    );
  }
  if (passport.controller) {
    passRows.push(["Controller", addrLink(passport.controller, passport.controller)]);
  }
  passRows.push(["Registry", addrLink(CONTRACTS.registry, short(CONTRACTS.registry))]);
  fac("passport").replaceChildren(...passRows.map(([label, value]) => el("div", {}, [
    el("dt", { text: label }),
    el("dd", {}, [value]),
  ])));

  renderActions();
}

/* ── Role-gated actions ──────────────────────────────────── */

function txLogEntry(label) {
  const log = $("[data-tx-log]");
  const item = el("li", { class: "is-pending" }, [
    el("b", { text: label }),
    el("span", { text: "Confirm in wallet…" }),
  ]);
  log.prepend(item);
  return {
    hash(hash) {
      item.replaceChildren(
        el("b", { text: label }),
        el("span", { text: "Pending on chain: " }),
        el("a", { href: txUrl(hash), target: "_blank", rel: "noopener", text: shortHash(hash) }),
      );
    },
    ok(hash) {
      item.className = "is-ok";
      item.replaceChildren(
        el("b", { text: `${label} — confirmed` }),
        el("a", { href: txUrl(hash), target: "_blank", rel: "noopener", text: shortHash(hash) }),
      );
    },
    fail(message) {
      item.className = "is-fail";
      item.replaceChildren(
        el("b", { text: `${label} — failed` }),
        el("span", { class: "tx-err", text: message }),
      );
    },
  };
}

async function runTx(label, sendFn, { refresh = true } = {}) {
  const entry = txLogEntry(label);
  try {
    const tx = await sendFn();
    entry.hash(tx.hash);
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      entry.fail("Transaction reverted onchain.");
      return null;
    }
    entry.ok(receipt.hash);
    if (refresh && current.snapshot) await loadFacility(current.snapshot.facilityId.toString());
    loadNetworkDesk();
    return receipt;
  } catch (error) {
    entry.fail(chainErrorText(error));
    return null;
  }
}

function gateWrite() {
  return new Contract(CONTRACTS.proofGate, PROOFGATE_ABI, wallet.signer);
}
function tokenWrite() {
  return new Contract(CONTRACTS.settlementToken, ERC20_ABI, wallet.signer);
}

async function approveIfNeeded(amount, label) {
  const allowance = await tokenRead.allowance(wallet.address, CONTRACTS.proofGate);
  if (allowance >= amount) return true;
  const receipt = await runTx(
    `Approve ${fmtUsdg(amount)} ${SETTLEMENT.symbol} for ${label}`,
    () => tokenWrite().approve(CONTRACTS.proofGate, amount),
    { refresh: false },
  );
  return receipt !== null;
}

function amountField(name, labelText, defaultValue) {
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }),
    el("input", { name, type: "text", inputmode: "decimal", autocomplete: "off", value: defaultValue }),
  ]);
}

function parseUsdgInput(raw) {
  const cleaned = raw.replaceAll(",", "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;
  const value = parseUnits(cleaned, SETTLEMENT.decimals);
  return value > 0n ? value : null;
}

function actionCard(title, note, children) {
  return el("div", { class: "action-card" }, [
    el("h4", { text: title }),
    note ? el("p", { text: note }) : null,
    ...children,
  ]);
}

function renderActions() {
  const stack = $("[data-action-stack]");
  const noteHost = $("[data-actions-note]");
  if (!stack || !noteHost) return;
  stack.replaceChildren();

  const snap = current.snapshot;
  if (!snap) { noteHost.textContent = "Load a facility to see its available actions."; return; }
  if (!wallet.address) {
    noteHost.textContent = "Connect a wallet to see the actions available to your address on this facility.";
    return;
  }
  if (!CONTRACTS.proofGate) {
    noteHost.textContent = "ProofGate is not deployed yet — actions are unavailable.";
    return;
  }

  const { facility, accepted, requirements, claims, drawCheck, chainTime } = snap;
  const me = wallet.address.toLowerCase();
  const stateName = FACILITY_STATES[Number(facility.state)];
  const isLender = me === facility.lender.toLowerCase();
  const isBorrower = me === facility.borrower.toLowerCase();
  const myRequirements = requirements
    .map((req, i) => ({ req, claim: claims[i], index: i }))
    .filter(({ req }) => req.issuer.toLowerCase() === me);
  const sym = ` ${SETTLEMENT.symbol}`;
  const cards = [];

  // Lender: fund escrow.
  if (isLender && stateName === "Created") {
    const remaining = facility.principal - facility.funded;
    const input = amountField("fundAmount", `Amount (${fmtUsdg(remaining)}${sym} remaining)`, fmtUsdg(remaining));
    const button = el("button", { class: "action-button", type: "button", text: `Approve & fund escrow` });
    button.addEventListener("click", async () => {
      const amount = parseUsdgInput(input.querySelector("input").value);
      if (amount == null) { toast("Enter a positive USDG amount (up to 6 decimals)."); return; }
      if (amount > remaining) { toast(`Amount exceeds the ${fmtUsdg(remaining)}${sym} still unfunded.`); return; }
      button.disabled = true;
      try {
        if (await approveIfNeeded(amount, "escrow funding")) {
          await runTx(`Fund facility #${snap.facilityId} with ${fmtUsdg(amount)}${sym}`,
            () => gateWrite().fundFacility(snap.facilityId, amount));
        }
      } finally { button.disabled = false; }
    });
    cards.push(actionCard("Fund escrow", "Moves test USDG from your wallet into the facility escrow. Requires a token approval first if allowance is insufficient.", [input, el("div", { class: "action-row" }, [button])]));
  }

  // Borrower: accept delivery.
  if (isBorrower && (stateName === "Created" || stateName === "Funded") && !accepted) {
    const button = el("button", { class: "action-button", type: "button", text: "Accept delivery" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await runTx(`Accept delivery on facility #${snap.facilityId}`,
          () => gateWrite().acceptDelivery(snap.facilityId));
      } finally { button.disabled = false; }
    });
    cards.push(actionCard("Accept delivery", "Confirms the machine arrived. The contract verifies the passport is live, unrevoked, matches the physical ID, and that you control it.", [el("div", { class: "action-row" }, [button])]));
  }

  // Issuer: publish / revoke claims.
  if (myRequirements.length && (stateName === "Created" || stateName === "Funded")) {
    const select = el("select", { "aria-label": "Claim to publish" });
    for (const { req } of myRequirements) {
      const info = describeClaimType(req.claimType);
      select.append(el("option", { value: req.claimType, text: info.title }));
    }
    const digestInput = el("input", { type: "text", placeholder: "0x digest, or any text to hash locally", autocomplete: "off", spellcheck: "false" });
    const digestNote = el("p", { class: "req-hash", text: "Paste a bytes32 digest of your signed statement, or type text and it is keccak-hashed in this browser." });
    const expiryInput = el("input", { type: "datetime-local", "aria-label": "Claim expiry" });
    const inAWeek = new Date(Date.now() + 7 * 86400_000);
    inAWeek.setMinutes(inAWeek.getMinutes() - inAWeek.getTimezoneOffset());
    expiryInput.value = inAWeek.toISOString().slice(0, 16);
    const publish = el("button", { class: "action-button", type: "button", text: "Publish claim" });
    publish.addEventListener("click", async () => {
      const raw = digestInput.value.trim();
      if (!raw) { toast("Provide a digest or statement text."); return; }
      const digest = isHexString(raw, 32) ? raw : keccakText(raw);
      const expiry = Math.floor(new Date(expiryInput.value).getTime() / 1000);
      if (!Number.isFinite(expiry) || BigInt(expiry) <= snap.chainTime) {
        toast("Expiry must be a valid future date."); return;
      }
      const claimType = select.value;
      publish.disabled = true;
      try {
        await runTx(`Publish ${describeClaimType(claimType).title} claim`,
          () => gateWrite().publishClaim(snap.facilityId, claimType, digest, BigInt(expiry)));
      } finally { publish.disabled = false; }
    });
    const children = [
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Claim" }), select]),
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Evidence digest" }), digestInput]),
      digestNote,
      el("label", { class: "field" }, [el("span", { class: "field-label", text: "Expires" }), expiryInput]),
      el("div", { class: "action-row" }, [publish]),
    ];
    const zero32 = "0x" + "0".repeat(64);
    const revocable = myRequirements.filter(({ claim }) => claim.digest !== zero32 && !claim.revoked);
    if (revocable.length) {
      const revoke = el("button", { class: "action-button is-danger", type: "button", text: "Revoke selected claim" });
      revoke.addEventListener("click", async () => {
        const claimType = select.value;
        const target = myRequirements.find(({ req }) => req.claimType === claimType);
        if (!target || target.claim.digest === zero32 || target.claim.revoked) {
          toast("That claim has nothing to revoke."); return;
        }
        revoke.disabled = true;
        try {
          await runTx(`Revoke ${describeClaimType(claimType).title} claim`,
            () => gateWrite().revokeClaim(snap.facilityId, claimType));
        } finally { revoke.disabled = false; }
      });
      children.at(-1).append(revoke);
    }
    cards.push(actionCard("Issuer desk", `You are the approved issuer for ${myRequirements.length} claim${myRequirements.length > 1 ? "s" : ""} on this facility. Only your address can publish them.`, children));
  }

  // Draw — anyone may execute once the gate is open; funds go only to the payee.
  if (stateName === "Funded" && drawCheck.ready) {
    const button = el("button", { class: "action-button", type: "button", text: `Execute drawdown — ${fmtUsdg(facility.principal)}${sym} to payee` });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await runTx(`Draw facility #${snap.facilityId}`, () => gateWrite().draw(snap.facilityId));
      } finally { button.disabled = false; }
    });
    cards.push(actionCard("Execute drawdown", `Every gate re-checks onchain inside the same transaction. Principal moves to the pre-approved payee ${short(facility.payee)} only.`, [el("div", { class: "action-row" }, [button])]));
  }

  // Repay — open to any payer; flows to the lender.
  if (stateName === "Drawn") {
    const outstanding = facility.principal - facility.repaid;
    const input = amountField("repayAmount", `Amount (${fmtUsdg(outstanding)}${sym} outstanding)`, fmtUsdg(outstanding));
    const button = el("button", { class: "action-button", type: "button", text: "Approve & repay" });
    button.addEventListener("click", async () => {
      const amount = parseUsdgInput(input.querySelector("input").value);
      if (amount == null) { toast("Enter a positive USDG amount (up to 6 decimals)."); return; }
      if (amount > outstanding) { toast(`Amount exceeds the ${fmtUsdg(outstanding)}${sym} outstanding.`); return; }
      button.disabled = true;
      try {
        if (await approveIfNeeded(amount, "repayment")) {
          await runTx(`Repay ${fmtUsdg(amount)}${sym} on facility #${snap.facilityId}`,
            () => gateWrite().repay(snap.facilityId, amount));
        }
      } finally { button.disabled = false; }
    });
    cards.push(actionCard("Repay", "Repayment moves test USDG from your wallet directly to the lender. Full repayment closes the facility.", [input, el("div", { class: "action-row" }, [button])]));
  }

  // Lender: cancel or release.
  if (isLender && (stateName === "Created" || stateName === "Funded")) {
    const button = el("button", { class: "action-button is-danger", type: "button", text: "Cancel facility" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await runTx(`Cancel facility #${snap.facilityId}`, () => gateWrite().cancelFacility(snap.facilityId));
      } finally { button.disabled = false; }
    });
    cards.push(actionCard("Cancel facility", `Refunds the ${fmtUsdg(facility.funded)}${sym} currently escrowed back to you and closes the facility before any draw.`, [el("div", { class: "action-row" }, [button])]));
  }
  if (isLender && stateName === "Drawn") {
    const unpaid = facility.principal - facility.repaid;
    const button = el("button", { class: "action-button is-danger", type: "button", text: "Release & close" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await runTx(`Release facility #${snap.facilityId}`, () => gateWrite().releaseFacility(snap.facilityId));
      } finally { button.disabled = false; }
    });
    cards.push(actionCard("Release & close", `Waives the remaining ${fmtUsdg(unpaid)}${sym} inside this protocol and closes the facility. No seizure or asset transfer occurs — legal recourse stays offchain.`, [el("div", { class: "action-row" }, [button])]));
  }

  if (!cards.length) {
    noteHost.textContent = `Connected as ${short(wallet.address)} — this address has no available actions on facility #${snap.facilityId} in its current ${stateName} state.`;
  } else {
    noteHost.textContent = `Connected as ${short(wallet.address)}. Actions below match your role on this facility.`;
    stack.append(...cards);
  }
}

/* ── Planner ─────────────────────────────────────────────── */

const planner = {
  form: null,
  rowsHost: null,
  rowSeq: 0,
  lastArgs: null,
};

function requirementRow(seedLabel = "") {
  const rowId = `req-${planner.rowSeq++}`;
  const select = el("select", { name: `${rowId}-type`, "aria-label": "Claim type" });
  for (const entry of CLAIM_TYPE_LABELS) {
    select.append(el("option", { value: entry.label, text: entry.title, selected: entry.label === seedLabel ? "" : null }));
  }
  select.append(el("option", { value: "__custom__", text: "Custom label…" }));
  const customInput = el("input", { type: "text", placeholder: "my.custom.claim.label", autocomplete: "off", spellcheck: "false", hidden: "" });
  const issuerInput = el("input", { type: "text", placeholder: "Approved issuer 0x…", autocomplete: "off", spellcheck: "false" });
  const hashLine = el("p", { class: "req-hash" });
  const remove = el("button", { class: "ghost-button remove-req", type: "button", text: "Remove", "aria-label": "Remove requirement" });
  const row = el("div", { class: "requirement-row" }, [
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Claim type" }), select, customInput]),
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Approved issuer" }), issuerInput]),
    remove,
    hashLine,
  ]);
  const updateHash = () => {
    const label = select.value === "__custom__" ? customInput.value.trim() : select.value;
    if (!label) { hashLine.textContent = ""; return; }
    hashLine.replaceChildren("claimType = keccak256(", el("code", { text: JSON.stringify(label) }), ") = ", el("code", { text: keccakText(label) }));
  };
  select.addEventListener("change", () => {
    customInput.hidden = select.value !== "__custom__";
    updateHash();
    updatePlannerPreview();
  });
  for (const input of [customInput, issuerInput]) {
    input.addEventListener("input", () => { updateHash(); updatePlannerPreview(); });
  }
  remove.addEventListener("click", () => { row.remove(); updatePlannerPreview(); });
  updateHash();
  return row;
}

function collectRequirements() {
  const rows = $$(".requirement-row", planner.rowsHost);
  const claimTypes = [];
  const issuers = [];
  const labels = [];
  const problems = [];
  rows.forEach((row, i) => {
    const select = row.querySelector("select");
    const custom = row.querySelector("input[placeholder^='my.custom']");
    const issuer = row.querySelector("input[placeholder^='Approved issuer']").value.trim();
    const label = select.value === "__custom__" ? custom.value.trim() : select.value;
    if (!label) { problems.push(`Requirement ${i + 1}: claim label is empty.`); return; }
    const hash = keccakText(label);
    if (claimTypes.includes(hash)) { problems.push(`Requirement ${i + 1}: duplicate claim type "${label}".`); return; }
    if (!isAddress(issuer)) { problems.push(`Requirement ${i + 1}: issuer is not a valid address.`); return; }
    claimTypes.push(hash);
    issuers.push(getAddress(issuer));
    labels.push(label);
  });
  if (!rows.length) problems.push("At least one required claim is needed.");
  return { claimTypes, issuers, labels, problems };
}

function updatePlannerPreview() {
  const form = planner.form;
  if (!form) return;
  const data = new FormData(form);
  const problems = [];

  const borrower = String(data.get("borrower") ?? "").trim();
  const payee = String(data.get("payee") ?? "").trim();
  const passportId = String(data.get("passportId") ?? "").trim();
  const physicalId = String(data.get("physicalId") ?? "").trim();
  const principalRaw = String(data.get("principal") ?? "").trim();
  const policyText = String(data.get("policyText") ?? "");

  if (borrower && !isAddress(borrower)) problems.push("Borrower is not a valid address.");
  if (payee && !isAddress(payee)) problems.push("Payee is not a valid address.");
  if (passportId && !isHexString(passportId, 32)) problems.push("Passport ID must be 0x + 64 hex characters.");
  if (physicalId && !isHexString(physicalId, 32)) problems.push("Physical ID must be 0x + 64 hex characters.");

  let principal = null;
  if (principalRaw) {
    principal = parseUsdgInput(principalRaw);
    if (principal == null) problems.push("Principal must be a positive USDG amount with at most 6 decimals.");
  }

  const policyHash = policyText.trim() ? keccakText(policyText) : null;
  const policyHost = $('[data-plan="policyHash"]');
  if (policyHost) policyHost.textContent = policyHash ?? "—";

  const reqs = collectRequirements();
  problems.push(...reqs.problems);

  const missing = [];
  if (!borrower) missing.push("borrower");
  if (!payee) missing.push("payee");
  if (!passportId) missing.push("passport ID");
  if (!physicalId) missing.push("physical ID");
  if (!principalRaw) missing.push("principal");
  if (!policyText.trim()) missing.push("policy terms");

  const preview = $('[data-plan="preview"]');
  if (missing.length || problems.length) {
    planner.lastArgs = null;
    preview.textContent = [
      missing.length ? `Missing: ${missing.join(", ")}.` : null,
      ...problems,
    ].filter(Boolean).join("\n");
    return;
  }

  planner.lastArgs = {
    borrower: getAddress(borrower),
    payee: getAddress(payee),
    passportId,
    physicalId,
    principal,
    policyHash,
    claimTypes: reqs.claimTypes,
    issuers: reqs.issuers,
    labels: reqs.labels,
  };
  const a = planner.lastArgs;
  preview.textContent = [
    "createFacility(",
    `  borrower:   ${a.borrower},`,
    `  payee:      ${a.payee},`,
    `  passportId: ${a.passportId},`,
    `  physicalId: ${a.physicalId},`,
    `  principal:  ${a.principal} // ${fmtUsdg(a.principal)} ${SETTLEMENT.symbol} in base units,`,
    `  policyHash: ${a.policyHash},`,
    "  claimTypes: [",
    ...a.claimTypes.map((hash, i) => `    ${hash} // ${a.labels[i]}`),
    "  ],",
    "  issuers: [",
    ...a.issuers.map((addr) => `    ${addr}`),
    "  ]",
    ")",
  ].join("\n");
}

function plannerStatus(text, tone = "") {
  const host = $("[data-planner-status]");
  if (!host) return;
  host.textContent = text;
  host.className = `inline-status${tone ? ` is-${tone}` : ""}`;
}

async function checkPassport() {
  const statusHost = $("[data-passport-check-status]");
  const form = planner.form;
  const passportId = String(new FormData(form).get("passportId") ?? "").trim();
  const setStatus = (text, tone = "") => {
    statusHost.textContent = text;
    statusHost.className = `inline-status${tone ? ` is-${tone}` : ""}`;
  };
  if (!isHexString(passportId, 32)) {
    setStatus("Enter a valid bytes32 passport ID first.", "error");
    return;
  }
  setStatus("Reading passport from the live registry…");
  try {
    const version = await registryRead.latestVersion(passportId);
    if (version === 0n) {
      setStatus("No anchored version exists for this passport ID in the registry.", "error");
      return;
    }
    const [anchor, controller] = await Promise.all([
      registryRead.getAnchor(passportId, version),
      registryRead.controllerOf(passportId),
    ]);
    form.elements.physicalId.value = anchor.physicalId;
    let activeNote = "";
    if (gateRead) {
      try {
        const activeId = await gateRead.activeFacilityByPhysicalId(anchor.physicalId);
        if (activeId > 0n) {
          activeNote = ` Warning: this object already backs active facility #${activeId} — another facility cannot activate its protocol-only physical claim until that one closes.`;
        }
      } catch { /* exclusivity check is advisory */ }
    }
    const revokedNote = anchor.revoked ? " Warning: this anchor is REVOKED — the gate will never open on it." : "";
    setStatus(
      `Live anchor v${version}, anchored ${fmtWhen(anchor.anchoredAt)}, controller ${short(controller)}. Physical ID autofilled from the registry.${revokedNote}${activeNote}`,
      anchor.revoked || activeNote ? "error" : "ok",
    );
    updatePlannerPreview();
  } catch (error) {
    setStatus(`Registry read failed: ${chainErrorText(error)}`, "error");
  }
}

async function submitCreate(event) {
  event.preventDefault();
  updatePlannerPreview();
  if (!planner.lastArgs) {
    plannerStatus("Resolve the issues in the preview panel before submitting.", "error");
    return;
  }
  if (!CONTRACTS.proofGate) {
    plannerStatus("The ProofGate contract is not deployed yet, so createFacility cannot be submitted. Your drafted arguments above remain local.", "error");
    return;
  }
  if (!wallet.signer) {
    plannerStatus("Connect a wallet first — the connected address becomes the lender.", "error");
    return;
  }
  const a = planner.lastArgs;
  const submitButton = $("[data-create-submit]");
  submitButton.disabled = true;
  plannerStatus("Submitting createFacility…");
  try {
    const receipt = await runTx(
      `Create facility (${fmtUsdg(a.principal)} ${SETTLEMENT.symbol})`,
      () => gateWrite().createFacility(
        a.borrower, a.payee, a.passportId, a.physicalId,
        a.principal, a.policyHash, a.claimTypes, a.issuers,
      ),
      { refresh: false },
    );
    if (!receipt) { plannerStatus("Transaction did not confirm — see the transaction log in the console panel.", "error"); return; }
    let createdId = null;
    for (const entry of receipt.logs) {
      try {
        const parsed = gateRead.interface.parseLog(entry);
        if (parsed?.name === "FacilityCreated") { createdId = parsed.args.facilityId; break; }
      } catch { /* other contracts' logs */ }
    }
    if (createdId != null) {
      plannerStatus(`Facility #${createdId} created onchain.`, "ok");
      toast(`Facility #${createdId} is live. Loading it in the console.`);
      const lookupInput = $("[data-lookup-form] input[name='facilityId']");
      if (lookupInput) lookupInput.value = createdId.toString();
      await loadFacility(createdId.toString());
      $("#facility-console")?.scrollIntoView({ behavior: "smooth" });
    } else {
      plannerStatus("Transaction confirmed, but no FacilityCreated event was found in the receipt.", "error");
    }
  } finally {
    submitButton.disabled = false;
  }
}

function setupPlanner() {
  planner.form = $("[data-planner-form]");
  planner.rowsHost = $("[data-requirement-rows]");
  if (!planner.form || !planner.rowsHost) return;

  for (const entry of CLAIM_TYPE_LABELS) {
    planner.rowsHost.append(requirementRow(entry.label));
  }
  planner.form.elements.passportId.value = DEMO_PASSPORT.passportId;

  planner.form.addEventListener("input", updatePlannerPreview);
  planner.form.addEventListener("submit", submitCreate);
  $("[data-add-requirement]")?.addEventListener("click", () => {
    planner.rowsHost.append(requirementRow());
    updatePlannerPreview();
  });
  $("[data-check-passport]")?.addEventListener("click", checkPassport);
  $("[data-copy-args]")?.addEventListener("click", async () => {
    updatePlannerPreview();
    if (!planner.lastArgs) { toast("Complete the form before copying arguments."); return; }
    const a = planner.lastArgs;
    const payload = JSON.stringify({
      borrower: a.borrower,
      payee: a.payee,
      passportId: a.passportId,
      physicalId: a.physicalId,
      principal: a.principal.toString(),
      policyHash: a.policyHash,
      claimTypes: a.claimTypes,
      issuers: a.issuers,
    }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      toast("createFacility arguments copied as JSON.");
    } catch {
      toast("Clipboard unavailable — select the preview text instead.");
    }
  });
  updatePlannerPreview();
}

/* ── Footer & explainer ──────────────────────────────────── */

function setupFooter() {
  const registryLink = $('[data-explorer="registry"]');
  if (registryLink) {
    registryLink.href = addrUrl(CONTRACTS.registry);
    registryLink.querySelector("code").textContent = short(CONTRACTS.registry);
  }
  const tokenLink = $('[data-explorer="token"]');
  if (tokenLink) {
    tokenLink.href = addrUrl(CONTRACTS.settlementToken);
    tokenLink.querySelector("code").textContent = short(CONTRACTS.settlementToken);
  }
  const gateHost = $("[data-footer-proofgate]");
  if (gateHost) {
    if (CONTRACTS.proofGate) {
      gateHost.replaceChildren("ProofGate ", el("a", { href: addrUrl(CONTRACTS.proofGate), target: "_blank", rel: "noopener" }, [el("code", { text: short(CONTRACTS.proofGate) })]));
    } else {
      gateHost.replaceChildren("ProofGate ", el("code", { text: "not deployed — pending release" }));
    }
  }
}

function setupExplainer() {
  const dialog = $("[data-explainer]");
  if (!dialog?.showModal) return;
  const KEY = "proofgate.explainer.v1";
  $("[data-open-explainer]")?.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => {
    try { localStorage.setItem(KEY, "seen"); } catch { /* private mode */ }
  });
  let seen = null;
  try { seen = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (!seen) dialog.showModal();
}

/* ── Boot ────────────────────────────────────────────────── */

function boot() {
  setupFooter();
  setupExplainer();
  setupPlanner();
  renderWalletButton();
  watchInjected();

  $("#connect-wallet")?.addEventListener("click", () => {
    if (wallet.address) disconnectWallet();
    else connectWallet();
  });
  $("[data-refresh-network]")?.addEventListener("click", loadNetworkDesk);
  $("[data-lookup-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = new FormData(event.target).get("facilityId");
    const value = String(raw ?? "").trim();
    if (!/^\d+$/.test(value) || BigInt(value) < 1n) {
      lookupStatus("Facility IDs are positive integers starting at 1.", "error");
      return;
    }
    loadFacility(value);
  });

  loadNetworkDesk();
  loadFacility("1");
  setInterval(() => {
    if (document.visibilityState === "visible") loadNetworkDesk();
  }, 60_000);
}

boot();

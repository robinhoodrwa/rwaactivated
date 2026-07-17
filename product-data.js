"use strict";

(() => {
  const demo = {
    simulation: true,
    generatedAt: "2026-07-16T18:42:00Z",
    asset: {
      objectId: "rwa:equipment:atlas-hx320:8f21",
      name: "Atlas HX-320 Excavator",
      class: "Tracked excavator",
      manufacturer: "Atlas Heavy Systems",
      model: "HX-320",
      serial: "HX320-24-008F21",
      year: 2024,
      location: "Dallas, Texas",
      status: "Anchored",
      revision: 7,
      verifiedAt: "2026-07-16T18:42:00Z",
      matchConfidence: 99.2,
      scanCoverage: 98.4,
      sourcePoints: 2841926,
      fingerprint: "sha256:79d1c4b803a2f0e7e98a2d48b9d9c6f3a8e7082dc89c9d3fd5ec5ad4ad0c8f21",
      controller: "0x71C2…09A4",
      custodian: "Northline Equipment Services",
      inspectionDue: "2026-10-14",
      imageTone: "amber"
    },
    anchor: {
      network: "Robinhood Testnet",
      state: "Finalized",
      block: "18,492,107",
      transaction: "0x9c41…d882",
      timestamp: "2026-07-16T18:42:12Z",
      confirmations: 48
    },
    claims: [
      {
        id: "physical-identity",
        label: "Physical identity",
        value: "Grid2d match · 99.2%",
        source: "2.84M-point spatial capture",
        signer: "RWA Scan Adapter v0.4",
        status: "verified",
        updatedAt: "2026-07-16T18:36:08Z"
      },
      {
        id: "serial",
        label: "Manufacturer serial",
        value: "HX320-24-008F21",
        source: "Plate capture + operator record",
        signer: "Atlas Heavy Systems",
        status: "verified",
        updatedAt: "2026-07-16T18:34:40Z"
      },
      {
        id: "title",
        label: "Rights record",
        value: "Owner record attached",
        source: "Signed equipment schedule",
        signer: "Red River Equipment Holdings",
        status: "verified",
        updatedAt: "2026-07-16T17:52:21Z"
      },
      {
        id: "custody",
        label: "Custody",
        value: "Northline Equipment Services",
        source: "Custody attestation #NLE-2049",
        signer: "Northline Equipment Services",
        status: "verified",
        updatedAt: "2026-07-16T17:50:02Z"
      },
      {
        id: "inspection",
        label: "Condition inspection",
        value: "Passed · 92 / 100",
        source: "Field inspection report",
        signer: "Independent attester · Certified inspector",
        status: "verified",
        updatedAt: "2026-07-15T20:14:37Z"
      },
      {
        id: "insurance",
        label: "Insurance evidence",
        value: "Expires in 29 days",
        source: "Policy declaration",
        signer: "Prairie Mutual",
        status: "warning",
        updatedAt: "2026-07-01T14:11:09Z"
      },
      {
        id: "provenance",
        label: "Service provenance",
        value: "14 records linked",
        source: "Maintenance ledger",
        signer: "3 accountable operators",
        status: "verified",
        updatedAt: "2026-07-12T10:45:54Z"
      }
    ],
    timeline: [
      {
        type: "anchor",
        title: "Revision 7 anchored",
        detail: "Manifest fingerprint finalized on Robinhood Testnet",
        timestamp: "2026-07-16T18:42:12Z"
      },
      {
        type: "scan",
        title: "Physical identity reverified",
        detail: "99.2% match confidence · 98.4% surface coverage",
        timestamp: "2026-07-16T18:36:08Z"
      },
      {
        type: "signature",
        title: "Custody claim signed",
        detail: "Northline Equipment Services",
        timestamp: "2026-07-16T17:50:02Z"
      },
      {
        type: "inspection",
        title: "Condition inspection passed",
        detail: "Score 92 / 100 · next inspection Oct 14",
        timestamp: "2026-07-15T20:14:37Z"
      }
    ],
    workQueue: [
      { id: "RWA-2048", asset: "HX-320 Excavator", task: "Renew insurance evidence", status: "Due soon", priority: "warning", owner: "RWA Ops", age: "29 days left" },
      { id: "RWA-2051", asset: "Kenworth T680", task: "Inspector signature", status: "Waiting", priority: "neutral", owner: "External attester", age: "2h" },
      { id: "RWA-2057", asset: "Haas VF-4 Mill", task: "Resolve source mismatch", status: "Failed check", priority: "danger", owner: "RWA Ops", age: "18m" },
      { id: "RWA-2060", asset: "Atlas Copco XAS 188", task: "Review and anchor", status: "Ready", priority: "success", owner: "Asset operator", age: "6m" }
    ],
    assets: [
      { id: "RWA-2048", name: "Atlas HX-320 Excavator", class: "Equipment", status: "Anchored", evidence: 96, updated: "4m", location: "Dallas, TX" },
      { id: "RWA-2051", name: "Kenworth T680", class: "Vehicle", status: "Needs signature", evidence: 88, updated: "2h", location: "Fort Worth, TX" },
      { id: "RWA-2057", name: "Haas VF-4 Mill", class: "Machine", status: "Failed verification", evidence: 64, updated: "18m", location: "Austin, TX" },
      { id: "RWA-2060", name: "Atlas Copco XAS 188", class: "Equipment", status: "Ready to anchor", evidence: 100, updated: "6m", location: "Houston, TX" },
      { id: "RWA-2039", name: "Caterpillar D6 XE", class: "Equipment", status: "Anchored", evidence: 94, updated: "1d", location: "Midland, TX" },
      { id: "RWA-2032", name: "John Deere 8R 410", class: "Agriculture", status: "Expired", evidence: 72, updated: "3d", location: "Lubbock, TX" }
    ],
    metrics: {
      activePassports: 1284,
      anchoredThisWeek: 47,
      needsAttention: 12,
      verificationRate: 98.7
    }
  };

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
  }

  window.RwaDemo = deepFreeze(demo);
})();

"use strict";

(function exposeEvidenceLinter(root, factory) {
  const api = factory(root);
  if (root?.document) root.RwaEvidence = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEvidenceLinter(root) {
  const SCHEMA_URL = "https://rwaactivated.com/evidence-passport.schema.json";
  const SCHEMA_VERSION = "0.1.0";
  const TOP_LEVEL_FIELDS = new Set([
    "$schema",
    "schemaVersion",
    "id",
    "version",
    "createdAt",
    "asset",
    "issuer",
    "evidence",
    "custody",
    "rights",
    "targetNetworks",
    "anchors",
    "extensions",
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function isIdentifier(value) {
    return isText(value) && /^(?:https:\/\/|urn:|did:)/i.test(value);
  }

  function isEvidenceUri(value) {
    return isText(value) && /^(?:https:\/\/|ipfs:\/\/|ar:\/)/i.test(value);
  }

  function isTimestamp(value) {
    return isText(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  }

  function isCurrentTimestamp(value, now) {
    return isTimestamp(value) && Date.parse(value) <= now + 5 * 60 * 1000;
  }

  function isSha256(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  }

  function hasUnpairedSurrogate(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true;
      }
    }
    return false;
  }

  function canonicalize(value) {
    const active = new WeakSet();

    function visit(current) {
      if (current === null || typeof current === "boolean") return JSON.stringify(current);
      if (typeof current === "string") {
        if (hasUnpairedSurrogate(current)) throw new TypeError("Strings must not contain unpaired Unicode surrogates.");
        return JSON.stringify(current);
      }
      if (typeof current === "number") {
        if (!Number.isFinite(current)) throw new TypeError("Numbers must be finite JSON numbers.");
        return JSON.stringify(current);
      }
      if (typeof current !== "object") throw new TypeError("Only JSON values can be canonicalized.");
      if (active.has(current)) throw new TypeError("Circular data cannot be canonicalized.");

      active.add(current);
      let result;
      if (Array.isArray(current)) {
        result = `[${current.map(visit).join(",")}]`;
      } else {
        const entries = Object.keys(current)
          .sort()
          .map((key) => {
            if (hasUnpairedSurrogate(key)) throw new TypeError("Object keys must not contain unpaired Unicode surrogates.");
            return `${JSON.stringify(key)}:${visit(current[key])}`;
          });
        result = `{${entries.join(",")}}`;
      }
      active.delete(current);
      return result;
    }

    return visit(value);
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    if (typeof require === "function") {
      return require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    }
    throw new Error("SHA-256 is not available in this browser.");
  }

  function validGtin(value) {
    if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(value)) return false;
    const digits = [...value].map(Number);
    const supplied = digits.pop();
    const sum = digits.reverse().reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0
    );
    return (10 - (sum % 10)) % 10 === supplied;
  }

  function validateManifest(manifest, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const checks = [];

    function add(id, label, status, message, path) {
      checks.push({ id, label, status, message, path });
    }

    function gate(id, label, condition, passMessage, failMessage, path, severity = "error") {
      add(id, label, condition ? "pass" : severity, condition ? passMessage : failMessage, path);
    }

    if (!isRecord(manifest)) {
      add("manifest.object", "JSON object", "error", "The passport must be a top-level JSON object.", "$");
      return checks;
    }

    gate(
      "manifest.schema",
      "Known schema",
      manifest.$schema === SCHEMA_URL && manifest.schemaVersion === SCHEMA_VERSION,
      `Schema ${SCHEMA_VERSION} is declared.`,
      `Use $schema "${SCHEMA_URL}" and schemaVersion "${SCHEMA_VERSION}".`,
      "$schema"
    );

    gate(
      "manifest.identity",
      "Passport identity",
      isIdentifier(manifest.id) && Number.isInteger(manifest.version) && manifest.version > 0,
      "The passport has a stable identifier and positive integer version.",
      "Add a URI, URN, or DID-based id and a positive integer version.",
      "id"
    );

    gate(
      "manifest.created",
      "Creation timestamp",
      isCurrentTimestamp(manifest.createdAt, now),
      "The creation timestamp is valid and not in the future.",
      "createdAt must be an ISO 8601 timestamp that is not in the future.",
      "createdAt"
    );

    const unknownFields = Object.keys(manifest).filter((key) => !TOP_LEVEL_FIELDS.has(key));
    gate(
      "manifest.fields",
      "Extension boundary",
      unknownFields.length === 0,
      "Top-level fields use the defined profile.",
      `Move custom top-level fields into extensions: ${unknownFields.join(", ")}.`,
      "$",
      "warning"
    );

    const asset = manifest.asset;
    gate(
      "asset.core",
      "Asset description",
      isRecord(asset) && isText(asset.name) && isText(asset.type),
      "The physical asset has a name and class.",
      "asset.name and asset.type are required.",
      "asset"
    );

    const identifiers = Array.isArray(asset?.identifiers) ? asset.identifiers : [];
    const identifierShapeValid = identifiers.length > 0 && identifiers.every(
      (identifier) => isRecord(identifier) && isText(identifier.scheme) && isText(identifier.value)
    );
    gate(
      "asset.identifiers",
      "Stable asset identifiers",
      identifierShapeValid,
      `${identifiers.length} namespaced asset identifier${identifiers.length === 1 ? "" : "s"} declared.`,
      "Add at least one identifier with scheme and value.",
      "asset.identifiers"
    );

    if (identifierShapeValid) {
      const keys = identifiers.map((identifier) => `${identifier.scheme.toLowerCase()}:${identifier.value}`);
      gate(
        "asset.identifier-uniqueness",
        "Identifier uniqueness",
        new Set(keys).size === keys.length,
        "Asset identifiers are unique.",
        "Duplicate asset identifiers create ambiguous identity.",
        "asset.identifiers"
      );

      const gtins = identifiers.filter((identifier) => identifier.scheme.toLowerCase() === "gtin");
      if (gtins.length) {
        gate(
          "asset.gtin",
          "GS1 identifier checksum",
          gtins.every((identifier) => validGtin(identifier.value)),
          "GTIN check digits are valid.",
          "One or more GTIN values have an invalid length or check digit.",
          "asset.identifiers"
        );
      } else {
        add(
          "asset.identifier-portability",
          "Portable identifier",
          "warning",
          "No GTIN is present. Confirm the selected identifier can survive a vendor or platform change.",
          "asset.identifiers"
        );
      }
    }

    const issuer = manifest.issuer;
    gate(
      "issuer.identity",
      "Accountable passport issuer",
      isRecord(issuer) && isIdentifier(issuer.id) && isText(issuer.name),
      "The passport issuer is named and addressable.",
      "issuer.id and issuer.name are required; issuer.id must be a URI, URN, or DID.",
      "issuer"
    );

    const evidence = Array.isArray(manifest.evidence) ? manifest.evidence : [];
    gate(
      "evidence.collection",
      "Evidence collection",
      evidence.length > 0,
      `${evidence.length} evidence record${evidence.length === 1 ? "" : "s"} supplied.`,
      "At least one evidence record is required.",
      "evidence"
    );

    if (evidence.length === 1) {
      add(
        "evidence.depth",
        "Evidence depth",
        "warning",
        "A single document rarely establishes identity, rights, custody, and condition independently.",
        "evidence"
      );
    }

    const evidenceIds = new Set();
    const evidenceDigests = new Set();
    evidence.forEach((item, index) => {
      const base = `evidence[${index}]`;
      const digest = item?.digest?.value;
      const digestValid = isRecord(item?.digest) && item.digest.algorithm === "sha-256" && isSha256(digest);
      const idMatchesDigest = digestValid && item.id === `urn:sha256:${digest.toLowerCase()}`;
      gate(
        `evidence.${index}.integrity`,
        `Evidence ${index + 1}: content integrity`,
        digestValid && idMatchesDigest,
        "The evidence id is bound to a SHA-256 content digest.",
        "Use digest.algorithm sha-256, a 64-character hexadecimal value, and id urn:sha256:<digest>.",
        `${base}.digest`
      );

      const sourceValid = isRecord(item) && isText(item.type) && isEvidenceUri(item.uri) &&
        isCurrentTimestamp(item.issuedAt, now) && isIdentifier(item.issuer) &&
        Array.isArray(item.claims) && item.claims.length > 0 && item.claims.every(isText);
      gate(
        `evidence.${index}.source`,
        `Evidence ${index + 1}: accountable source`,
        sourceValid,
        "Type, source URI, timestamp, issuer, and scoped claims are present.",
        "Each evidence record needs type, HTTPS/IPFS/Arweave URI, issuedAt, issuer, and non-empty claims.",
        base
      );

      const proof = item?.proof;
      if (!isRecord(proof)) {
        add(
          `evidence.${index}.proof`,
          `Evidence ${index + 1}: signature envelope`,
          "warning",
          "No proof envelope is present. The source claim is not cryptographically attributable.",
          `${base}.proof`
        );
      } else {
        gate(
          `evidence.${index}.proof`,
          `Evidence ${index + 1}: signature envelope`,
          isText(proof.type) && isIdentifier(proof.verificationMethod) && isText(proof.proofValue),
          "A proof envelope is present. This preflight checks its shape, not the signature.",
          "proof.type, proof.verificationMethod, and proof.proofValue are required.",
          `${base}.proof`
        );
      }

      if (isText(item?.id)) {
        if (evidenceIds.has(item.id)) {
          add(`evidence.${index}.duplicate-id`, `Evidence ${index + 1}: unique id`, "error", "Evidence ids must be unique.", `${base}.id`);
        }
        evidenceIds.add(item.id);
      }
      if (isSha256(digest)) {
        const normalized = digest.toLowerCase();
        if (evidenceDigests.has(normalized)) {
          add(`evidence.${index}.duplicate-digest`, `Evidence ${index + 1}: unique content`, "warning", "The same content digest appears more than once.", `${base}.digest.value`);
        }
        evidenceDigests.add(normalized);
        if (/^([a-f0-9])\1{63}$/i.test(normalized)) {
          add(`evidence.${index}.placeholder-digest`, `Evidence ${index + 1}: plausible digest`, "warning", "The digest looks like placeholder data.", `${base}.digest.value`);
        }
      }
    });

    const custody = manifest.custody;
    const custodyCoreValid = isRecord(custody) && isIdentifier(custody.holder) &&
      isText(custody.status) && isCurrentTimestamp(custody.asOf, now) && isText(custody.evidenceId);
    gate(
      "custody.current",
      "Current custody snapshot",
      custodyCoreValid,
      "A dated holder and possession state are declared.",
      "custody needs holder, status, asOf, and evidenceId.",
      "custody"
    );
    if (custodyCoreValid) {
      gate(
        "custody.evidence",
        "Custody evidence reference",
        evidenceIds.has(custody.evidenceId),
        "The custody snapshot references evidence in this passport.",
        "custody.evidenceId must reference an evidence item in this passport.",
        "custody.evidenceId"
      );
    }

    const rights = manifest.rights;
    const rightsCoreValid = isRecord(rights) && isEvidenceUri(rights.instrumentUri) &&
      isText(rights.governingLaw) && isText(rights.transferPolicy) && isText(rights.evidenceId);
    gate(
      "rights.current",
      "Rights and transfer terms",
      rightsCoreValid,
      "The governing instrument, law, and transfer policy are explicit.",
      "rights needs instrumentUri, governingLaw, transferPolicy, and evidenceId.",
      "rights"
    );
    if (rightsCoreValid) {
      const referenced = evidence.find((item) => item?.id === rights.evidenceId);
      gate(
        "rights.evidence",
        "Rights evidence reference",
        Boolean(referenced) && referenced.uri === rights.instrumentUri,
        "The rights instrument URI is bound to its evidence digest.",
        "rights.evidenceId must reference an evidence item with the same instrumentUri.",
        "rights.evidenceId"
      );
    }

    const targetNetworks = manifest.targetNetworks;
    if (targetNetworks === undefined) {
      add("networks.portable", "Chain portability", "pass", "No target chain is required for the evidence core.", "targetNetworks");
    } else {
      const networksValid = Array.isArray(targetNetworks) && targetNetworks.length > 0 &&
        targetNetworks.every((network) => typeof network === "string" && /^[a-z0-9-]+:[A-Za-z0-9-]+$/.test(network));
      const robinhoodTargeted = networksValid && targetNetworks.includes("eip155:4663");
      gate(
        "networks.targets",
        "CAIP-2 network targets",
        networksValid,
        robinhoodTargeted
          ? "Robinhood Chain is declared as a target; no deployment or transaction is implied."
          : "Target networks use CAIP-2 identifiers.",
        "targetNetworks must be a non-empty list of CAIP-2 identifiers such as eip155:4663.",
        "targetNetworks"
      );
    }

    const anchors = manifest.anchors;
    if (anchors !== undefined) {
      const anchorListValid = Array.isArray(anchors) && anchors.every((anchor) => {
        if (!isRecord(anchor) || !isText(anchor.network) || !["planned", "confirmed"].includes(anchor.status)) return false;
        if (anchor.status === "confirmed") return /^0x[a-f0-9]{64}$/i.test(anchor.transactionHash || "");
        return !anchor.transactionHash;
      });
      gate(
        "anchors.shape",
        "Onchain anchor claims",
        anchorListValid,
        "Anchor status is explicit; confirmed anchors include a transaction hash.",
        "Anchors must declare network and planned/confirmed status; confirmed EVM anchors need a transaction hash.",
        "anchors"
      );
    }

    return checks;
  }

  async function lintManifest(input, options = {}) {
    let manifest;
    try {
      manifest = typeof input === "string" ? JSON.parse(input) : input;
    } catch (error) {
      return {
        valid: false,
        status: "blocked",
        fingerprint: null,
        canonical: null,
        manifest: null,
        checks: [{
          id: "json.parse",
          label: "Valid JSON",
          status: "error",
          message: error instanceof Error ? error.message : "The input is not valid JSON.",
          path: "$",
        }],
        counts: { pass: 0, warning: 0, error: 1 },
      };
    }

    let canonical;
    let fingerprint;
    try {
      canonical = canonicalize(manifest);
      fingerprint = `sha256:${await sha256Hex(canonical)}`;
    } catch (error) {
      return {
        valid: false,
        status: "blocked",
        fingerprint: null,
        canonical: null,
        manifest,
        checks: [{
          id: "json.canonical",
          label: "Canonical JSON",
          status: "error",
          message: error instanceof Error ? error.message : "The input cannot be canonicalized.",
          path: "$",
        }],
        counts: { pass: 0, warning: 0, error: 1 },
      };
    }

    const checks = validateManifest(manifest, options);
    const counts = checks.reduce(
      (totals, check) => ({ ...totals, [check.status]: totals[check.status] + 1 }),
      { pass: 0, warning: 0, error: 0 }
    );
    const valid = counts.error === 0;

    return {
      valid,
      status: valid ? (counts.warning ? "ready-with-cautions" : "ready") : "blocked",
      fingerprint,
      canonical,
      manifest,
      checks,
      counts,
    };
  }

  const EXAMPLE = {
    $schema: SCHEMA_URL,
    schemaVersion: SCHEMA_VERSION,
    id: "urn:rwaactivated:passport:industrial-equipment:tx-2048",
    version: 1,
    createdAt: "2026-07-16T12:00:00Z",
    asset: {
      name: "TX-2048 Centrifugal Pump",
      type: "industrial-equipment",
      identifiers: [
        {
          scheme: "gtin",
          value: "09506000134352",
          uri: "https://id.gs1.org/01/09506000134352/21/TX2048",
        },
        {
          scheme: "serial",
          value: "TX-2048",
        },
      ],
    },
    issuer: {
      id: "did:web:registry.example.com",
      name: "Example Equipment Registry",
    },
    evidence: [
      {
        id: "urn:sha256:edd786498fafa99315b08c587e5735f03853c7b3ffa98619dee2b4b1ab788756",
        type: "rights",
        uri: "https://evidence.example.com/tx-2048/rights-instrument.pdf",
        digest: {
          algorithm: "sha-256",
          value: "edd786498fafa99315b08c587e5735f03853c7b3ffa98619dee2b4b1ab788756",
        },
        issuedAt: "2026-07-15T14:00:00Z",
        issuer: "did:web:registry.example.com",
        claims: ["asset.identity", "rights.instrument.current"],
        proof: {
          type: "DataIntegrityProof",
          verificationMethod: "did:web:registry.example.com#key-1",
          proofValue: "zExampleRightsProofEnvelope",
        },
      },
      {
        id: "urn:sha256:9027ae49cf3517738181146ad3746e1c0fbd67a3b3570ed5729d28fbecab824b",
        type: "custody",
        uri: "https://evidence.example.com/tx-2048/custody-receipt.json",
        digest: {
          algorithm: "sha-256",
          value: "9027ae49cf3517738181146ad3746e1c0fbd67a3b3570ed5729d28fbecab824b",
        },
        issuedAt: "2026-07-15T15:00:00Z",
        issuer: "did:web:custodian.example.com",
        claims: ["custody.holder", "custody.status"],
        proof: {
          type: "DataIntegrityProof",
          verificationMethod: "did:web:custodian.example.com#key-1",
          proofValue: "zExampleCustodyProofEnvelope",
        },
      },
      {
        id: "urn:sha256:3c29502167bc9dd9ba91eaa09ea9325cf846591d6ee837c6f2acc568b2d17021",
        type: "inspection",
        uri: "https://evidence.example.com/tx-2048/inspection-report.pdf",
        digest: {
          algorithm: "sha-256",
          value: "3c29502167bc9dd9ba91eaa09ea9325cf846591d6ee837c6f2acc568b2d17021",
        },
        issuedAt: "2026-07-15T16:00:00Z",
        issuer: "did:web:inspector.example.com",
        claims: ["condition.operational", "serial.observed"],
        proof: {
          type: "DataIntegrityProof",
          verificationMethod: "did:web:inspector.example.com#key-1",
          proofValue: "zExampleInspectionProofEnvelope",
        },
      },
    ],
    custody: {
      holder: "did:web:custodian.example.com",
      status: "held",
      asOf: "2026-07-15T15:00:00Z",
      evidenceId: "urn:sha256:9027ae49cf3517738181146ad3746e1c0fbd67a3b3570ed5729d28fbecab824b",
    },
    rights: {
      instrumentUri: "https://evidence.example.com/tx-2048/rights-instrument.pdf",
      governingLaw: "US-TX",
      transferPolicy: "issuer-review",
      evidenceId: "urn:sha256:edd786498fafa99315b08c587e5735f03853c7b3ffa98619dee2b4b1ab788756",
    },
    targetNetworks: ["eip155:4663"],
  };

  function sampleManifest() {
    return JSON.parse(JSON.stringify(EXAMPLE));
  }

  return Object.freeze({
    SCHEMA_URL,
    SCHEMA_VERSION,
    canonicalize,
    lintManifest,
    sampleManifest,
    sha256Hex,
    validGtin,
    validateManifest,
  });
});

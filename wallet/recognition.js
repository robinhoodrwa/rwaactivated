export const GRID2D_PROFILE = Object.freeze({
  algorithm: "grid2d_v3a",
  gridSize: 8,
  sections: 12,
  depth: 10,
  implementation: "p3d@5eed819",
});

export const SUPPORTED_MODEL_EXTENSIONS = Object.freeze(["obj"]);
export const MAX_MODEL_BYTES = 24 * 1024 * 1024;

let worker;
let nextRequestId = 1;
const pendingRequests = new Map();

function getWorker() {
  if (worker) return worker;

  worker = new Worker("./grid2d-worker.js?v=20260717.3", { type: "module" });
  worker.addEventListener("message", (event) => {
    const { id, ok, ...payload } = event.data ?? {};
    const pending = pendingRequests.get(id);
    if (!pending) return;

    pendingRequests.delete(id);
    window.clearTimeout(pending.timeoutId);
    if (ok) pending.resolve(payload);
    else pending.reject(new Error(payload.error || "Grid2d recognition failed."));
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Grid2d worker stopped unexpectedly.");
    for (const pending of pendingRequests.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    pendingRequests.clear();
    worker.terminate();
    worker = undefined;
  });

  return worker;
}

function extensionOf(name) {
  return String(name).toLowerCase().split(".").pop() ?? "";
}

function bytesToHex(bytes) {
  let output = "0x";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function normalizeBytes32(hash) {
  const normalized = String(hash).trim().toLowerCase();
  const prefixed = normalized.startsWith("0x") ? normalized : `0x${normalized}`;
  if (!/^0x[0-9a-f]{64}$/.test(prefixed)) {
    throw new TypeError(`Invalid bytes32 value: ${hash}`);
  }
  return prefixed;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256Json(value) {
  return sha256Bytes(new TextEncoder().encode(stableStringify(value)));
}

export async function recognizeModel(file, { timeoutMs = 120_000 } = {}) {
  if (!(file instanceof File)) throw new TypeError("Choose a local OBJ file first.");

  const extension = extensionOf(file.name);
  if (!SUPPORTED_MODEL_EXTENSIONS.includes(extension)) {
    throw new TypeError("This release accepts OBJ meshes only.");
  }
  if (file.size === 0) throw new TypeError("The selected OBJ file is empty.");
  if (file.size > MAX_MODEL_BYTES) {
    throw new RangeError(`OBJ files must be ${MAX_MODEL_BYTES / 1024 / 1024} MB or smaller.`);
  }

  const bytes = await file.arrayBuffer();
  const sourceDigest = await sha256Bytes(bytes);
  const id = nextRequestId++;
  const recognitionWorker = getWorker();

  const result = await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Grid2d recognition timed out."));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timeoutId });
    recognitionWorker.postMessage({ id, bytes, profile: GRID2D_PROFILE }, [bytes]);
  });

  const hashes = [...new Set(result.hashes.map(normalizeBytes32))];
  if (hashes.length === 0) throw new Error("Grid2d returned no recognition hashes.");

  return Object.freeze({
    fileName: file.name,
    fileSize: file.size,
    sourceDigest,
    hashes: Object.freeze(hashes),
    profile: GRID2D_PROFILE,
    implementation: result.implementation,
    elapsedMs: result.elapsedMs,
    recognizedAt: new Date().toISOString(),
  });
}

export function compareRecognition(referenceHashes, candidateHashes) {
  const reference = new Set(referenceHashes.map(normalizeBytes32));
  const matches = [...new Set(candidateHashes.map(normalizeBytes32))].filter((hash) =>
    reference.has(hash),
  );

  return Object.freeze({
    recognized: matches.length > 0,
    matches: Object.freeze(matches),
    referenceCount: reference.size,
    candidateCount: new Set(candidateHashes).size,
  });
}

export function buildPhysicalClaim(recognition) {
  return Object.freeze({
    method: "3dpass-grid2d",
    algorithm: recognition.profile.algorithm,
    implementation: recognition.implementation,
    gridSize: recognition.profile.gridSize,
    sections: recognition.profile.sections,
    depth: recognition.profile.depth,
    sourceDigest: recognition.sourceDigest,
    hashes: recognition.hashes,
    capturedAt: recognition.recognizedAt,
  });
}

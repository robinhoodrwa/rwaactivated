"use strict";

const DEFAULT_CHUNK_BYTES = 64 * 1024;

export async function fileFromNativeScan(
  scanner,
  result,
  { maxBytes, chunkBytes = DEFAULT_CHUNK_BYTES } = {},
) {
  const scanId = String(result?.scanId || "");
  const fileName = String(result?.fileName || "native-lidar-scan.obj");
  const byteCount = Number(result?.byteCount);
  if (!scanId || !Number.isSafeInteger(byteCount) || byteCount <= 0) {
    throw new Error("The scanner did not return a readable OBJ file.");
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new RangeError("The native scan chunk size is invalid.");
  }

  try {
    if (Number.isFinite(maxBytes) && byteCount > maxBytes) {
      throw new RangeError(`The captured mesh is ${byteCount.toLocaleString()} bytes. Scan a smaller area or import a smaller OBJ.`);
    }

    const parts = [];
    let offset = 0;
    while (offset < byteCount) {
      const response = await scanner.readScanChunk({
        scanId,
        offset,
        length: Math.min(chunkBytes, byteCount - offset),
      });
      const chunk = response?.chunk;
      const nextOffset = Number(response?.nextOffset);
      if (typeof chunk !== "string" || !Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > byteCount) {
        throw new Error("The scanner returned an invalid OBJ chunk.");
      }
      parts.push(chunk);
      offset = nextOffset;
    }

    return new File(parts, fileName, { type: "model/obj" });
  } finally {
    await scanner.discardScan?.({ scanId }).catch(() => {});
  }
}

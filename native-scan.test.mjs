import assert from "node:assert/strict";
import test from "node:test";

import { fileFromNativeScan } from "./wallet/native-scan.js";

function chunkedScanner(source) {
  const reads = [];
  const discarded = [];
  return {
    reads,
    discarded,
    async readScanChunk({ scanId, offset, length }) {
      reads.push({ scanId, offset, length });
      const nextOffset = Math.min(offset + length, source.length);
      return { chunk: source.slice(offset, nextOffset), nextOffset, done: nextOffset === source.length };
    },
    async discardScan({ scanId }) {
      discarded.push(scanId);
    },
  };
}

test("a multi-megabyte native OBJ is reconstructed through bounded bridge chunks", async () => {
  const obj = `# large native scan\n${"v 1.25 2.5 3.75\n".repeat(450_000)}`;
  const scanner = chunkedScanner(obj);

  const file = await fileFromNativeScan(scanner, {
    scanId: "scan-large",
    fileName: "large.obj",
    byteCount: obj.length,
  }, { maxBytes: obj.length + 1, chunkBytes: 64 * 1024 });

  assert.equal(file.name, "large.obj");
  assert.equal(file.size, obj.length);
  assert.ok(scanner.reads.length > 100);
  assert.ok(scanner.reads.every(({ length }) => length <= 64 * 1024));
  assert.deepEqual(scanner.discarded, ["scan-large"]);
  assert.equal((await file.text()).endsWith("v 1.25 2.5 3.75\n"), true);
});

test("oversized native scans are discarded before bridge transfer", async () => {
  const scanner = chunkedScanner("v 0 0 0\n");

  await assert.rejects(
    fileFromNativeScan(scanner, {
      scanId: "scan-too-large",
      fileName: "large.obj",
      byteCount: 25_000_000,
    }, { maxBytes: 24_000_000 }),
    /Scan a smaller area/,
  );
  assert.equal(scanner.reads.length, 0);
  assert.deepEqual(scanner.discarded, ["scan-too-large"]);
});

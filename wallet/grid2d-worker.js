import initGrid2d, {
  recognize_obj as recognizeObj,
  recognition_version as recognitionVersion,
} from "./grid2d/rwa_grid2d_wasm.js?v=20260717.3";

const grid2dReady = initGrid2d(
  new URL("./grid2d/rwa_grid2d_wasm_bg.wasm?v=20260717.3", import.meta.url),
);

self.addEventListener("message", async (event) => {
  const { id, bytes, profile } = event.data ?? {};

  try {
    await grid2dReady;

    if (!(bytes instanceof ArrayBuffer)) {
      throw new TypeError("Grid2d worker requires an ArrayBuffer input.");
    }

    const startedAt = performance.now();
    const output = recognizeObj(
      new Uint8Array(bytes),
      profile.algorithm,
      profile.gridSize,
      profile.sections,
      profile.depth,
    );
    const hashes = output
      .split("\n")
      .map((hash) => hash.trim().toLowerCase())
      .filter(Boolean);

    self.postMessage({
      id,
      ok: true,
      hashes,
      implementation: recognitionVersion(),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error:
        typeof error === "string"
          ? error
          : error?.message || "Grid2d recognition failed.",
    });
  }
});

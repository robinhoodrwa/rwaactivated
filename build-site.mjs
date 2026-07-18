import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "dist");
const iosOutput = join(root, "dist-ios");
const entries = [
  "_headers",
  "404.html",
  ".well-known",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "favicon.svg",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "index.html",
  "styles.css",
  "app.js",
  "product-data.js",
  "scan-scene.js",
  "evidence-passport.schema.json",
  "evidence-linter.js",
  "sw.js",
  "proofgate",
  "social",
  "studio",
  "verify",
  "wallet",
];
const excluded = new Set(["wallet/walletconnect-entry.js"]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of entries) {
  const source = join(root, entry);
  const destination = join(output, entry);
  await cp(source, destination, {
    recursive: true,
    filter(candidate) {
      const path = relative(root, candidate).split(sep).join("/");
      return !excluded.has(path);
    },
  });
}

console.log(`Prepared curated static site in ${output}`);

await rm(iosOutput, { recursive: true, force: true });
await cp(output, iosOutput, { recursive: true });
await writeFile(
  join(iosOutput, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#07110b">
  <meta http-equiv="refresh" content="0;url=wallet/">
  <title>RWA Passport</title>
</head>
<body>
  <p><a href="wallet/">Open RWA Passport</a></p>
</body>
</html>
`,
  "utf8",
);
console.log(`Prepared native iOS web assets in ${iosOutput}`);

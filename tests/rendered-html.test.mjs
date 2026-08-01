import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds a self-contained DermWatch application shell", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.match(html, /<title>DermWatch/);
  assert.equal(scriptPaths.length, 1);

  const script = await readFile(
    new URL(`../dist${scriptPaths[0]}`, import.meta.url),
    "utf8",
  );
  assert.match(script, /DermWatch/);
  assert.match(script, /PRIVATE SKIN JOURNAL/);
  assert.match(script, /Photos never leave this computer/i);
  assert.doesNotMatch(script, /codex-preview|SkeletonPreview/);
});

test("keeps the local privacy and storage contract explicit", async () => {
  const [page, analysis, storageClient, server, readme, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/storage-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(storageClient, /127\.0\.0\.1:8788/);
  assert.match(page, /Photos never leave this computer/i);
  assert.match(page, /Not a diagnosis/);
  assert.match(page, /SINGLE-PHOTO SCREEN/);
  assert.match(analysis, /export function assessSingleImage/);
  assert.match(analysis, /This does not mean cancer/);
  assert.match(analysis, /shapeDistance/);
  assert.match(analysis, /identity: "same" \| "uncertain" \| "different"/);
  assert.match(page, /Move latest photo to a separate record/);
  assert.match(page, /factorMeterColor\(factor\.value\)/);
  assert.match(server, /splitObservationMatch/);
  assert.match(packageJson, /@fontsource\/manrope/);
  assert.match(packageJson, /@fontsource\/fraunces/);
  assert.match(server, /server\.listen\(port, host/);
  assert.match(server, /const defaultHost = "127\.0\.0\.1"/);
  assert.match(readme, /%APPDATA%\\DermWatch\\data/);
  assert.match(storageClient, /resolveApiUrl/);
  assert.match(storageClient, /Directory\.Data/);
  assert.match(server, /DERMWATCH_DATA_DIR/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

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
  assert.match(script, /MOLE CHANGE TRACKER/);
  assert.match(script, /Track changes in moles/);
  assert.match(script, /does not detect cancer or precancerous conditions/);
  assert.match(script, /Photos never leave this computer/i);
  assert.doesNotMatch(script, /codex-preview|SkeletonPreview/);
});

test("keeps the local privacy and storage contract explicit", async () => {
  const [page, analysis, storageClient, server, readme, overview, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/storage-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/screenshots/overview.html", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(storageClient, /127\.0\.0\.1:8788/);
  assert.match(page, /Photos never leave this computer/i);
  assert.match(page, /Not a diagnosis/);
  assert.match(page, /DermWatch does not detect skin cancer/);
  assert.match(page, /cannot rule out melanoma/);
  assert.match(page, /PHOTO-ONLY MEASUREMENTS/);
  assert.match(page, /Same-day photos are not evolution/);
  assert.match(page, /Evolution <strong>not measured/);
  assert.match(page, /Capture match/);
  assert.match(page, /avoid phone or body shadows/);
  assert.match(analysis, /export function assessSingleImage/);
  assert.match(analysis, /capture variation, not biological change/);
  assert.match(analysis, /sensitive to light, focus and camera angle/);
  assert.doesNotMatch(analysis, /Book a dermatologist appointment/);
  assert.match(analysis, /shapeDistance/);
  assert.match(analysis, /identity: "same" \| "uncertain" \| "different"/);
  assert.match(page, /Move latest photo to a separate record/);
  assert.match(page, /record-delete-button/);
  assert.match(page, /aria-label={`Delete \${lesion\.name}`}/);
  assert.match(page, /factorMeterColor\(\s*factor\.value/);
  assert.doesNotMatch(page, /See what changed\.|Remember what didn’t\./);
  assert.match(server, /splitObservationMatch/);
  assert.match(packageJson, /@fontsource\/manrope/);
  assert.doesNotMatch(packageJson, /@fontsource\/fraunces/);
  assert.doesNotMatch(page, /Fraunces|Georgia|Times New Roman/);
  assert.match(server, /server\.listen\(port, host/);
  assert.match(server, /const defaultHost = "127\.0\.0\.1"/);
  assert.match(readme, /%APPDATA%\\DermWatch\\data/);
  assert.match(readme, /does not detect or rule out skin cancer or melanoma/i);
  assert.match(readme, /^# Track changes in moles with DermWatch/m);
  assert.match(overview, /Track changes in moles/);
  assert.match(overview, /Keep a photo history/);
  assert.doesNotMatch(overview, /Was it always like that|Build a record you can compare/);
  assert.match(storageClient, /resolveApiUrl/);
  assert.match(storageClient, /Directory\.Data/);
  assert.match(storageClient, /format: "dermwatch-backup"/);
  assert.match(storageClient, /for \(const id of createdIds\.reverse\(\)\)/);
  assert.match(storageClient, /Share\.share/);
  assert.match(page, /Export private backup/);
  assert.match(page, /Restore from backup/);
  assert.match(server, /DERMWATCH_DATA_DIR/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

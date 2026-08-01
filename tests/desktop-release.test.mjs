import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [builderConfig, workflow, packageJson] = await Promise.all([
  readFile(new URL("../electron-builder.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("builds a universal macOS DMG and a Windows x64 installer", () => {
  assert.match(builderConfig, /artifactName: DermWatch-\$\{version\}-\$\{os\}-\$\{arch\}/);
  assert.match(builderConfig, /mac:\s+[\s\S]*target: dmg[\s\S]*- universal/);
  assert.match(builderConfig, /win:\s+[\s\S]*target: nsis[\s\S]*- x64/);
  assert.equal(
    packageJson.scripts["desktop:build:mac"],
    "npm run build && electron-builder --mac dmg --universal --publish never",
  );
});

test("publishes both platform artifacts from GitHub Actions", () => {
  assert.match(workflow, /runs-on: macos-latest/);
  assert.match(workflow, /path: release\/DermWatch-\*\.dmg/);
  assert.match(workflow, /path: release\/DermWatch-\*\.exe/);
  assert.match(workflow, /needs: \[windows, macos, android\]/);
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /npm run desktop:smoke:packaged/);
  assert.match(workflow, /npm run release:verify-version/);
  assert.equal(
    packageJson.scripts["desktop:smoke:packaged"],
    "node scripts/smoke-packaged.mjs",
  );
});

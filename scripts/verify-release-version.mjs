import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const androidBuild = await readFile("android/app/build.gradle", "utf8");
const version = packageJson.version;

assert.match(version, /^\d+\.\d+\.\d+$/);
assert.match(androidBuild, new RegExp(`versionName "${version.replaceAll(".", "\\.")}"`));
await access(`docs/launch/RELEASE_NOTES_v${version}.md`);

if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`);
}

console.log(`Release version contract passed for v${version}`);

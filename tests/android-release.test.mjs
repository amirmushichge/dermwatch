import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [manifest, capacitorConfig, workflow, packageJson] = await Promise.all([
  readFile(
    new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../capacitor.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("Android keeps health photos private and requests no media permissions", () => {
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(manifest, /READ_MEDIA_IMAGES|CAMERA/);
  assert.match(capacitorConfig, /appId:\s*"com\.dermwatch\.local"/);
});

test("Android release APK is signed and reproducibly built in CI", () => {
  assert.equal(
    packageJson.scripts["android:apk:release"],
    "npm run android:sync && node scripts/build-android.mjs release",
  );
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /secrets\.ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow, /secrets\.ANDROID_KEYSTORE_PASSWORD/);
  assert.match(workflow, /npm run android:apk:release/);
  assert.match(workflow, /apksigner" verify --verbose --print-certs/);
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/release\/app-release\.apk/);
});

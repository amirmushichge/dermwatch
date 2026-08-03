import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [manifest, capacitorConfig, workflow, packageJson, androidBuild] = await Promise.all([
  readFile(
    new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../capacitor.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
]);

test("Android keeps health photos private and requests no media permissions", () => {
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(manifest, /READ_MEDIA_IMAGES|CAMERA/);
  assert.match(capacitorConfig, /appId:\s*"com\.dermwatch\.local"/);
  assert.equal(packageJson.dependencies["@capacitor/share"], "^8.0.1");
  assert.equal(packageJson.version, "0.2.4");
  assert.match(androidBuild, /versionCode 6/);
  assert.match(androidBuild, /versionName "0\.2\.4"/);
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

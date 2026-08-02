import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const executableOverride = process.env.DERMWATCH_PACKAGED_EXECUTABLE;
const candidates =
  process.platform === "win32"
    ? [
        executableOverride,
        path.join(projectRoot, "release", "win-unpacked", "DermWatch.exe"),
      ].filter(Boolean)
    : [
        executableOverride,
        path.join(
          projectRoot,
          "release",
          "mac-universal",
          "DermWatch.app",
          "Contents",
          "MacOS",
          "DermWatch",
        ),
        path.join(
          projectRoot,
          "release",
          "mac",
          "DermWatch.app",
          "Contents",
          "MacOS",
          "DermWatch",
        ),
      ].filter(Boolean);

async function firstExisting(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next electron-builder output directory.
    }
  }
  throw new Error(`Packaged DermWatch executable was not found: ${paths.join(", ")}`);
}

function run(executable, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--smoke-test"], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Packaged smoke test exited with code ${code}`)),
    );
  });
}

const executable = await firstExisting(candidates);
const temporary = await mkdtemp(path.join(os.tmpdir(), "dermwatch-packaged-smoke-"));
const dataDir = path.join(temporary, "user-data");

try {
  const firstReport = path.join(temporary, "first.json");
  const screenshot = path.join(temporary, "first.png");
  await run(executable, {
    DERMWATCH_SMOKE_CREATE_RECORD: "1",
    DERMWATCH_SMOKE_DATA_DIR: dataDir,
    DERMWATCH_SMOKE_REPORT: firstReport,
    DERMWATCH_SMOKE_SCREENSHOT: screenshot,
  });
  const first = JSON.parse(await readFile(firstReport, "utf8"));
  assert.equal(first.ok, true);
  assert.equal(first.recordCount, 1);
  assert.ok((await stat(screenshot)).size > 1000);

  const secondReport = path.join(temporary, "second.json");
  await run(executable, {
    DERMWATCH_SMOKE_DATA_DIR: dataDir,
    DERMWATCH_SMOKE_REPORT: secondReport,
  });
  const second = JSON.parse(await readFile(secondReport, "utf8"));
  assert.equal(second.ok, true);
  assert.equal(second.recordCount, 1);
  console.log(`Packaged smoke test passed: ${executable}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

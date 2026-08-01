import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("storage service starts on a free loopback port with an empty private store", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dermwatch-test-"));
  process.env.DERMWATCH_DATA_DIR = temporary;
  const moduleUrl = new URL(`../server.mjs?test=${Date.now()}`, import.meta.url);
  const { startStorageServer } = await import(moduleUrl.href);
  const { server, url } = await startStorageServer({ port: 0 });

  try {
    const health = await fetch(`${url}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const initial = await fetch(`${url}/api/records`).then((response) => response.json());
    assert.deepEqual(initial, { version: 1, lesions: [] });

    const createdResponse = await fetch(`${url}/api/lesions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test spot",
        location: "Forearm",
        reminderDays: 30,
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.name, "Test spot");

    const disk = JSON.parse(await readFile(path.join(temporary, "index.json"), "utf8"));
    assert.equal(disk.lesions.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
    delete process.env.DERMWATCH_DATA_DIR;
  }
});

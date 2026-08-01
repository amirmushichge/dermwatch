import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DERMWATCH_DATA_DIR
  ? path.resolve(process.env.DERMWATCH_DATA_DIR)
  : path.join(root, "data");
const imagesDir = path.join(dataDir, "images");
const indexPath = path.join(dataDir, "index.json");
const defaultHost = "127.0.0.1";
const defaultPort = 8788;
const configuredOrigin = process.env.DERMWATCH_ALLOWED_ORIGIN || "";
const maxBodyBytes = 45 * 1024 * 1024;

const contentTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function corsHeaders(origin = "") {
  const allowed = configuredOrigin
    ? origin === configuredOrigin
    : origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000";
  return {
    "Access-Control-Allow-Origin": allowed
      ? origin
      : configuredOrigin || "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function sendJson(response, status, payload, origin = "") {
  response.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function ensureStore() {
  await fs.mkdir(imagesDir, { recursive: true });
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(
      indexPath,
      JSON.stringify({ version: 1, lesions: [] }, null, 2),
      "utf8",
    );
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(indexPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    version: 1,
    lesions: Array.isArray(parsed.lesions) ? parsed.lesions : [],
  };
}

async function writeStore(store) {
  const temporary = `${indexPath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temporary, indexPath);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error("Payload is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function extensionForDataUrl(dataUrl) {
  if (dataUrl.startsWith("data:image/png;")) return ".png";
  if (dataUrl.startsWith("data:image/webp;")) return ".webp";
  return ".jpg";
}

function decodeImage(dataUrl) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
    String(dataUrl || ""),
  );
  if (!match) throw new Error("Unsupported image data");
  return Buffer.from(match[1], "base64");
}

async function serveMedia(response, pathname, origin) {
  const relative = decodeURIComponent(pathname.replace(/^\/media\//, ""));
  const resolved = path.resolve(imagesDir, relative);
  const safeRoot = `${path.resolve(imagesDir)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) {
    sendJson(response, 403, { error: "Forbidden" }, origin);
    return;
  }
  try {
    const bytes = await fs.readFile(resolved);
    response.writeHead(200, {
      ...corsHeaders(origin),
      "Content-Type": contentTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
  } catch {
    sendJson(response, 404, { error: "Image not found" }, origin);
  }
}

async function handle(request, response) {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || `${defaultHost}:${defaultPort}`}`,
  );
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(
      response,
      200,
      { ok: true, storage: dataDir, service: "DermWatch Local Store" },
      origin,
    );
    return;
  }

  if (request.method === "GET" && pathname === "/api/records") {
    sendJson(response, 200, await readStore(), origin);
    return;
  }

  if (request.method === "GET" && pathname.startsWith("/media/")) {
    await serveMedia(response, pathname, origin);
    return;
  }

  if (request.method === "POST" && pathname === "/api/lesions") {
    const body = await readBody(request);
    const name = cleanText(body.name, 80);
    const location = cleanText(body.location, 100);
    if (!name || !location) {
      sendJson(
        response,
        400,
        { error: "Name and location are required" },
        origin,
      );
      return;
    }
    const lesion = {
      id: crypto.randomUUID(),
      name,
      location,
      notes: cleanText(body.notes, 600),
      reminderDays: Math.min(365, Math.max(7, Number(body.reminderDays) || 30)),
      createdAt: new Date().toISOString(),
      observations: [],
    };
    const store = await readStore();
    store.lesions.unshift(lesion);
    await writeStore(store);
    sendJson(response, 201, lesion, origin);
    return;
  }

  const observationMatch = pathname.match(
    /^\/api\/lesions\/([0-9a-f-]+)\/observations$/,
  );
  if (request.method === "POST" && observationMatch) {
    const lesionId = observationMatch[1];
    const body = await readBody(request);
    const store = await readStore();
    const lesion = store.lesions.find((item) => item.id === lesionId);
    if (!lesion) {
      sendJson(response, 404, { error: "Lesion not found" }, origin);
      return;
    }
    const image = decodeImage(body.dataUrl);
    if (image.length > 30 * 1024 * 1024) {
      sendJson(response, 413, { error: "Image is too large" }, origin);
      return;
    }
    const observationId = crypto.randomUUID();
    const extension = extensionForDataUrl(body.dataUrl);
    const lesionDirectory = path.join(imagesDir, lesionId);
    await fs.mkdir(lesionDirectory, { recursive: true });
    const fileName = `${observationId}${extension}`;
    await fs.writeFile(path.join(lesionDirectory, fileName), image);

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))
      ? String(body.date)
      : new Date().toISOString().slice(0, 10);
    const numericSize = Number(body.sizeMm);
    const observation = {
      id: observationId,
      date,
      createdAt: new Date().toISOString(),
      imageUrl: `/media/${lesionId}/${fileName}`,
      originalName: cleanText(body.fileName, 180),
      ...(Number.isFinite(numericSize) && numericSize > 0
        ? { sizeMm: Math.min(100, numericSize) }
        : {}),
      analysis: body.analysis,
    };
    lesion.observations.push(observation);
    lesion.observations.sort((a, b) => a.date.localeCompare(b.date));
    await writeStore(store);
    sendJson(response, 201, observation, origin);
    return;
  }

  const observationAnalysisMatch = pathname.match(
    /^\/api\/lesions\/([0-9a-f-]+)\/observations\/([0-9a-f-]+)\/analysis$/,
  );
  if (request.method === "PATCH" && observationAnalysisMatch) {
    const [, lesionId, observationId] = observationAnalysisMatch;
    const body = await readBody(request);
    const store = await readStore();
    const lesion = store.lesions.find((item) => item.id === lesionId);
    const observation = lesion?.observations.find(
      (item) => item.id === observationId,
    );
    if (!observation) {
      sendJson(response, 404, { error: "Observation not found" }, origin);
      return;
    }
    if (
      !body.analysis ||
      body.analysis.version !== 2 ||
      !body.analysis.appearance?.shapeGrid
    ) {
      sendJson(response, 400, { error: "Invalid analysis" }, origin);
      return;
    }
    observation.analysis = body.analysis;
    await writeStore(store);
    sendJson(response, 200, observation, origin);
    return;
  }

  const splitObservationMatch = pathname.match(
    /^\/api\/lesions\/([0-9a-f-]+)\/observations\/([0-9a-f-]+)\/split$/,
  );
  if (request.method === "POST" && splitObservationMatch) {
    const [, lesionId, observationId] = splitObservationMatch;
    const store = await readStore();
    const lesion = store.lesions.find((item) => item.id === lesionId);
    const observationIndex = lesion?.observations.findIndex(
      (item) => item.id === observationId,
    );
    if (!lesion || observationIndex === undefined || observationIndex < 0) {
      sendJson(response, 404, { error: "Observation not found" }, origin);
      return;
    }

    const observation = lesion.observations[observationIndex];
    const newLesionId = crypto.randomUUID();
    const sourcePath = path.resolve(
      imagesDir,
      lesionId,
      path.basename(observation.imageUrl),
    );
    const safeImageRoot = `${path.resolve(imagesDir)}${path.sep}`;
    if (!sourcePath.startsWith(safeImageRoot)) {
      sendJson(response, 400, { error: "Invalid image path" }, origin);
      return;
    }

    const extension = path.extname(sourcePath) || ".jpg";
    const newDirectory = path.join(imagesDir, newLesionId);
    const newFileName = `${observation.id}${extension}`;
    await fs.mkdir(newDirectory, { recursive: true });
    await fs.rename(sourcePath, path.join(newDirectory, newFileName));

    lesion.observations.splice(observationIndex, 1);
    const newLesion = {
      id: newLesionId,
      name: `${lesion.name} — separate`,
      location: lesion.location,
      notes: "Created from a photo that did not match the previous mole.",
      reminderDays: lesion.reminderDays,
      createdAt: new Date().toISOString(),
      observations: [
        {
          ...observation,
          imageUrl: `/media/${newLesionId}/${newFileName}`,
        },
      ],
    };
    store.lesions.unshift(newLesion);
    await writeStore(store);
    sendJson(response, 201, newLesion, origin);
    return;
  }

  const lesionMatch = pathname.match(/^\/api\/lesions\/([0-9a-f-]+)$/);
  if (request.method === "DELETE" && lesionMatch) {
    const lesionId = lesionMatch[1];
    const store = await readStore();
    const before = store.lesions.length;
    store.lesions = store.lesions.filter((item) => item.id !== lesionId);
    if (store.lesions.length === before) {
      sendJson(response, 404, { error: "Lesion not found" }, origin);
      return;
    }
    await writeStore(store);
    const imageTarget = path.resolve(imagesDir, lesionId);
    const safeRoot = `${path.resolve(imagesDir)}${path.sep}`;
    if (imageTarget.startsWith(safeRoot)) {
      await fs.rm(imageTarget, { recursive: true, force: true });
    }
    sendJson(response, 200, { ok: true }, origin);
    return;
  }

  sendJson(response, 404, { error: "Not found" }, origin);
}

export async function startStorageServer({
  host = defaultHost,
  port = defaultPort,
} = {}) {
  await ensureStore();

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) {
        sendJson(
          response,
          error.message === "Payload is too large" ? 413 : 500,
          { error: "Local storage error" },
          request.headers.origin || "",
        );
      } else {
        response.end();
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  console.log(`DermWatch local storage: ${url}`);
  console.log(`Photos: ${imagesDir}`);
  return { server, url, dataDir, imagesDir };
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  await startStorageServer();
}

import { app, BrowserWindow, shell } from "electron";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let appServer;
let storageServer;
let mainWindow;
const smokeTest = process.argv.includes("--smoke-test");
if (smokeTest) app.disableHardwareAcceleration();
if (smokeTest && process.env.DERMWATCH_SMOKE_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.DERMWATCH_SMOKE_DATA_DIR));
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
  });
}

function sendNodeResponse(response, nodeResponse) {
  response.statusCode = nodeResponse.status;
  nodeResponse.headers.forEach((value, key) => response.setHeader(key, value));
  if (!nodeResponse.body) {
    response.end();
    return;
  }
  const reader = nodeResponse.body.getReader();
  const pump = () =>
    reader.read().then(({ done, value }) => {
      if (done) {
        response.end();
        return;
      }
      response.write(Buffer.from(value));
      return pump();
    });
  pump().catch(() => response.end());
}

async function fileResponse(assetRoot, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl).pathname);
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolved = path.resolve(assetRoot, requested);
  const safeRoot = `${path.resolve(assetRoot)}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) return new Response("Forbidden", { status: 403 });

  try {
    const bytes = await fs.readFile(resolved);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": MIME_TYPES[path.extname(resolved).toLowerCase()] ||
          "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function startAppServer() {
  const appRoot = app.getAppPath();
  const assetRoot = path.join(appRoot, "dist");

  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host || "127.0.0.1";
      const url = new URL(request.url || "/", `http://${host}`);
      let webResponse = await fileResponse(assetRoot, url.href);
      if (webResponse.status === 404 && !path.extname(url.pathname)) {
        webResponse = await fileResponse(assetRoot, `${url.origin}/index.html`);
      }
      sendNodeResponse(response, webResponse);
    } catch (error) {
      console.error(error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("DermWatch could not load. Please restart the application.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function openMainWindow() {
  process.env.DERMWATCH_DATA_DIR = path.join(app.getPath("userData"), "data");
  const localApp = await startAppServer();
  appServer = localApp.server;
  process.env.DERMWATCH_ALLOWED_ORIGIN = localApp.url;

  const { startStorageServer } = await import("../server.mjs");
  const storage = await startStorageServer({ port: 0 });
  storageServer = storage.server;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f5f1",
    title: "DermWatch",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: smokeTest,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (!smokeTest) mainWindow.once("ready-to-show", () => mainWindow.show());
  const url = new URL(localApp.url);
  url.searchParams.set("api", storage.url);
  await mainWindow.loadURL(url.href);

  if (smokeTest) {
    await mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          if (
            document.body.innerText.includes("Create your first skin record") ||
            Date.now() >= deadline
          ) resolve(true);
          else setTimeout(check, 100);
        };
        check();
      })
    `);
    if (process.env.DERMWATCH_SMOKE_CREATE_RECORD === "1") {
      await fetch(`${storage.url}/api/lesions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: localApp.url,
        },
        body: JSON.stringify({
          name: "Packaged smoke record",
          location: "Test device",
          reminderDays: 30,
        }),
      });
    }
    const backupUiLoaded = await mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const backupButton = [...document.querySelectorAll("button")].find(
          (button) => button.textContent.trim() === "Backup",
        );
        if (!backupButton) return resolve(false);
        backupButton.click();
        const deadline = Date.now() + 3000;
        const check = () => {
          if (document.body.innerText.includes("Export private backup"))
            resolve(true);
          else if (Date.now() >= deadline) resolve(false);
          else setTimeout(check, 100);
        };
        check();
      })
    `);
    const [rendererState, health, records] = await Promise.all([
      mainWindow.webContents.executeJavaScript(`
        (async () => {
          const api = new URLSearchParams(location.search).get("api");
          try {
            const response = await fetch(api + "/api/health");
            return {
              bodyText: document.body.innerText,
              href: location.href,
              api,
              fetchOk: response.ok,
              allowOrigin: response.headers.get("access-control-allow-origin"),
            };
          } catch (error) {
            return {
              bodyText: document.body.innerText,
              href: location.href,
              api,
              fetchOk: false,
              error: String(error),
            };
          }
        })()
      `),
      fetch(`${storage.url}/api/health`, {
        headers: { Origin: localApp.url },
      }).then((response) => response.json()),
      fetch(`${storage.url}/api/records`, {
        headers: { Origin: localApp.url },
      }).then((response) => response.json()),
    ]);
    const report = {
      ok:
        rendererState.bodyText.includes("DermWatch") &&
        rendererState.fetchOk === true &&
        health.ok === true &&
        Array.isArray(records.lesions) &&
        backupUiLoaded === true,
      uiLoaded: rendererState.bodyText.includes("DermWatch"),
      backupUiLoaded,
      uiStorageOnline: rendererState.fetchOk === true,
      storageOnline: health.ok === true,
      recordsReadable: Array.isArray(records.lesions),
      recordCount: Array.isArray(records.lesions) ? records.lesions.length : -1,
      renderer: rendererState,
    };
    const screenshotPath = process.env.DERMWATCH_SMOKE_SCREENSHOT;
    if (screenshotPath) {
      try {
        const image = await mainWindow.webContents.capturePage();
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await fs.writeFile(screenshotPath, image.toPNG());
        report.screenshotSaved = true;
      } catch (error) {
        report.screenshotSaved = false;
        report.screenshotError = String(error);
      }
    }
    const reportPath = process.env.DERMWATCH_SMOKE_REPORT;
    if (reportPath) {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    }
    await Promise.all([closeServer(appServer), closeServer(storageServer)]);
    app.exit(report.ok ? 0 : 1);
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(openMainWindow).catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    closeServer(appServer);
    closeServer(storageServer);
  });
}

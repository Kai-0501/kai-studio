/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { fork } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const PORT = 31415;
let serverProcess;
let mainWindow;
let githubSyncTimer;

// Expose the full renderer accessibility tree so macOS app-intelligence tools
// can inspect and capture Kai Studio just like a native browser window.
app.commandLine.appendSwitch("force-renderer-accessibility");

function serverDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", ".next", "standalone")
    : path.join(__dirname, "..", ".next", "standalone");
}

function startServer() {
  const directory = serverDirectory();
  const audioDirectory = path.join(app.getPath("userData"), "audio-runtime");
  serverProcess = fork(path.join(directory, "server.js"), [], {
    cwd: directory,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(PORT),
      KAI_STUDIO_DATA_DIR: path.join(app.getPath("userData"), "data"),
      KAI_STUDIO_AUDIO_DIR: audioDirectory,
      KAI_STUDIO_AUDIO_MODEL_DIR: path.join(
        audioDirectory,
        "parakeet-tdt-0.6b-v2",
      ),
      KAI_STUDIO_TRANSCRIBER_PATH: app.isPackaged
        ? path.join(process.resourcesPath, "audio", "fluidaudiocli")
        : path.join(__dirname, "..", "vendor", "audio", "fluidaudiocli"),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  serverProcess.stderr?.on("data", (chunk) => console.error(String(chunk)));
  serverProcess.on("exit", (code) => {
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox(
        "Kai Studio could not start",
        "The local Kai Studio server stopped unexpectedly.",
      );
    }
  });
}

function waitForServer(timeoutMs = 30_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function check() {
      const request = http.get(`http://127.0.0.1:${PORT}`, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("Kai Studio took too long to start."));
          return;
        }
        setTimeout(check, 250);
      });
      request.setTimeout(1_000, () => request.destroy());
    }

    check();
  });
}

function syncGitHubRepositories() {
  return new Promise((resolve) => {
    const request = http.request(
      `http://127.0.0.1:${PORT}/api/github/sync`,
      { method: "POST" },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", (error) => {
      console.error("Automatic GitHub sync failed:", error);
      resolve(null);
    });
    request.end();
  });
}

function scheduleDailyGitHubSync() {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(6, 30, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);

  clearTimeout(githubSyncTimer);
  githubSyncTimer = setTimeout(async () => {
    await syncGitHubRepositories();
    scheduleDailyGitHubSync();
  }, nextRun.getTime() - now.getTime());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#080b12",
    title: "Kai Studio",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      permission === "media" &&
      requestingOrigin.startsWith(`http://127.0.0.1:${PORT}`) &&
      details.mediaType === "audio",
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const isKaiStudio = webContents.getURL().startsWith(
        `http://127.0.0.1:${PORT}`,
      );
      const wantsMicrophone =
        permission === "media" && details.mediaTypes?.includes("audio");
      callback(isKaiStudio && wantsMicrophone);
    },
  );
  startServer();

  try {
    await waitForServer();
    scheduleDailyGitHubSync();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("Kai Studio could not start", error.message);
    app.quit();
  }

  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  clearTimeout(githubSyncTimer);
  serverProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

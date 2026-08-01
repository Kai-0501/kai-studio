/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { fork, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = 31415;
const MODEL_CONTROL_PORT = 31416;
const LLAMA_PORT = 11435;
let serverProcess;
let mainWindow;
let githubSyncTimer;
let modelControlServer;
let llamaProcess;
let activeHuggingFaceModel;

const huggingFaceModels = {
  "hf:gemma4-26b-a4b-q4": {
    name: "Gemma 4 26B A4B · Hugging Face",
    model: "/Users/kai/Models/gemma4-mtp/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf",
    projector: "/Users/kai/Models/gemma4-mtp/mmproj-Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-BF16.gguf",
    draft: "/Users/kai/Models/gemma4-mtp/mtp-gemma-4-26B-A4B-it.gguf",
  },
};

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

function waitForHttp(url, timeoutMs = 180_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      const retry = () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("The local Hugging Face model took too long to load."));
          return;
        }
        setTimeout(check, 500);
      };
      request.on("error", retry);
      request.setTimeout(2_000, () => request.destroy());
    }
    check();
  });
}

function llamaServerPath() {
  const candidates = [
    "/opt/homebrew/bin/llama-server",
    "/usr/local/bin/llama-server",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function ensureHuggingFaceModel(modelId) {
  const definition = huggingFaceModels[modelId];
  if (!definition || !fs.existsSync(definition.model)) {
    throw new Error("That Hugging Face model is not installed on this Mac.");
  }
  if (activeHuggingFaceModel === modelId && llamaProcess?.exitCode === null) return;

  llamaProcess?.kill();
  llamaProcess = undefined;
  activeHuggingFaceModel = undefined;

  const executable = llamaServerPath();
  if (!executable) {
    throw new Error("Kai Studio's embedded Hugging Face runtime is unavailable.");
  }

  const args = [
    "--model", definition.model,
    "--alias", modelId,
    "--host", "127.0.0.1",
    "--port", String(LLAMA_PORT),
    "--ctx-size", "32768",
    "--gpu-layers", "all",
    "--flash-attn", "auto",
    "--no-webui",
    "--reasoning", "off",
  ];
  if (fs.existsSync(definition.projector)) args.push("--mmproj", definition.projector);
  if (fs.existsSync(definition.draft)) {
    args.push("--model-draft", definition.draft, "--spec-type", "draft-mtp");
  }

  llamaProcess = spawn(executable, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  llamaProcess.stderr?.on("data", (chunk) => console.error(String(chunk)));
  llamaProcess.on("exit", () => {
    llamaProcess = undefined;
    activeHuggingFaceModel = undefined;
  });
  await waitForHttp(`http://127.0.0.1:${LLAMA_PORT}/health`);
  activeHuggingFaceModel = modelId;
}

function startModelControlServer() {
  modelControlServer = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/models") {
      const models = Object.entries(huggingFaceModels).flatMap(([id, definition]) =>
        fs.existsSync(definition.model)
          ? [{ id, name: definition.name, size: fs.statSync(definition.model).size }]
          : [],
      );
      response.end(JSON.stringify({ models, activeModel: activeHuggingFaceModel ?? null }));
      return;
    }
    if (request.method === "POST" && request.url === "/ensure") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", async () => {
        try {
          const { model } = JSON.parse(body);
          await ensureHuggingFaceModel(model);
          response.end(JSON.stringify({ ready: true, port: LLAMA_PORT }));
        } catch (error) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  });
  modelControlServer.listen(MODEL_CONTROL_PORT, "127.0.0.1");
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

function syncCloudMemory() {
  return new Promise((resolve) => {
    const request = http.request(`http://127.0.0.1:${PORT}/api/memory/cloud-sync`, { method: "POST" }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", (error) => { console.error("Cloud memory sync failed:", error); resolve(null); });
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
  startModelControlServer();

  try {
    await waitForServer();
    await syncCloudMemory();
    await syncGitHubRepositories();
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
  llamaProcess?.kill();
  modelControlServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

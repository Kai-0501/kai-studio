/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, powerSaveBlocker, session, shell } = require("electron");
const { fork, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
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
let activeBuildMonitor;
let activeBuildPowerBlocker;
let registeredModelRoots = [];

const managedLocalModels = new Map();

function localModelId(modelPath) {
  return `local:${crypto.createHash("sha256").update(fs.realpathSync(modelPath)).digest("hex").slice(0, 20)}`;
}

function defaultModelRoots() {
  const home = os.homedir();
  return [...new Set([path.join(home, "Models"), path.join(home, ".cache", "huggingface", "hub"), path.join(home, "Library", "Application Support", "Kai Studio", "models"), ...registeredModelRoots])];
}

function isSafeModelRoot(root) {
  const resolved = path.resolve(root);
  const home = path.resolve(os.homedir());
  return resolved !== path.parse(resolved).root && resolved !== home && !resolved.split(path.sep).includes(".git");
}

function modelDisplayName(modelPath) {
  return path.basename(modelPath, ".gguf").replace(/-00001-of-\d+$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelMetadata(name) {
  const normalized = name.toLowerCase();
  const parameter = normalized.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i)?.[1];
  return {
    family: normalized.includes("qwen") ? "Qwen" : normalized.includes("gemma") ? "Gemma" : normalized.includes("llama") ? "Llama" : normalized.includes("mistral") ? "Mistral" : undefined,
    parameterClass: parameter ? `${parameter}B` : undefined,
    quantization: normalized.match(/(?:q\d(?:_[a-z0-9]+)?|[a-z]\d+bit|fp\d+|bf16|f16)/i)?.[0]?.toUpperCase(),
    architecture: normalized.includes("moe") || normalized.includes("mtp") ? "moe" : "unknown",
  };
}

function discoverLocalModels(root, depth = 0) {
  if (!fs.existsSync(root) || depth > 5) return;
  const rootCanonical = fs.realpathSync(root);
  for (const entry of fs.readdirSync(rootCanonical, { withFileTypes: true }).slice(0, 1_000)) {
    const fullPath = path.join(rootCanonical, entry.name);
    if (entry.isDirectory()) {
      if (!entry.isSymbolicLink()) discoverLocalModels(fullPath, depth + 1);
      continue;
    }
    if (entry.isSymbolicLink() || !entry.name.toLowerCase().endsWith(".gguf") || /^(mmproj|mtp|draft)/i.test(entry.name)) continue;
    const canonicalPath = fs.realpathSync(fullPath);
    if (!canonicalPath.startsWith(`${rootCanonical}${path.sep}`)) continue;
    const id = localModelId(canonicalPath);
    const siblings = fs.readdirSync(path.dirname(canonicalPath));
    const projector = siblings.find((name) => /^mmproj.*\.gguf$/i.test(name));
    const draft = siblings.find((name) => /^(mtp|draft).*\.gguf$/i.test(name));
    const name = modelDisplayName(canonicalPath);
    managedLocalModels.set(id, {
      id, name, model: canonicalPath, canonicalPath, size: fs.statSync(canonicalPath).size,
      ...(projector ? { projector: path.join(path.dirname(canonicalPath), projector) } : {}),
      ...(draft ? { draft: path.join(path.dirname(canonicalPath), draft) } : {}),
      source: "user-managed-local", ownership: "user-managed", runtime: "llama.cpp", status: "candidate",
      statusReason: "Ready for optional local llama.cpp validation.", ...modelMetadata(name),
    });
  }
}

function refreshManagedLocalModels() {
  managedLocalModels.clear();
  for (const root of defaultModelRoots()) {
    try { discoverLocalModels(root); } catch (error) { console.error("Local model discovery skipped", root, error.message); }
  }
}

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
          reject(new Error("The selected local model took too long to load."));
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
  refreshManagedLocalModels();
  const definition = managedLocalModels.get(modelId);
  if (!definition || !fs.existsSync(definition.model)) {
    throw new Error("That locally discovered model is not available to Kai Studio.");
  }
  if (activeHuggingFaceModel === modelId && llamaProcess?.exitCode === null) return;

  llamaProcess?.kill();
  llamaProcess = undefined;
  activeHuggingFaceModel = undefined;

  const executable = llamaServerPath();
  if (!executable) {
    throw new Error("Kai Studio's managed llama.cpp runtime is unavailable.");
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
  definition.status = "available";
  definition.statusReason = "Loaded successfully by Kai Studio's local llama.cpp runtime.";
}

function startModelControlServer() {
  modelControlServer = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/models") {
      refreshManagedLocalModels();
      const models = [...managedLocalModels.values()].filter((definition) => fs.existsSync(definition.model)).map((definition) => ({
        id: definition.id, name: definition.name, size: definition.size, canonicalPath: definition.canonicalPath,
        source: definition.source, ownership: definition.ownership, runtime: definition.runtime, status: definition.status,
        statusReason: definition.statusReason, family: definition.family, parameterClass: definition.parameterClass,
        quantization: definition.quantization, architecture: definition.architecture, provider: "huggingface",
      }));
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
    if (request.method === "POST" && request.url === "/roots") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try {
          const { roots } = JSON.parse(body);
          if (!Array.isArray(roots) || roots.some((root) => typeof root !== "string" || root.length > 4096 || !isSafeModelRoot(root))) throw new Error("Choose dedicated local model folders only.");
          registeredModelRoots = [...new Set(roots.map((root) => path.resolve(root.trim())).filter(Boolean))];
          refreshManagedLocalModels();
          response.end(JSON.stringify({ roots: registeredModelRoots }));
        } catch (error) {
          response.statusCode = 400;
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

function readActiveBuild() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${PORT}/api/github/build/active`, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(Boolean(JSON.parse(body)?.job)); }
        catch { resolve(false); }
      });
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2_000, () => { request.destroy(); resolve(false); });
  });
}

function startActiveBuildMonitor() {
  const check = async () => {
    const active = await readActiveBuild();
    if (active && activeBuildPowerBlocker === undefined) {
      activeBuildPowerBlocker = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!active && activeBuildPowerBlocker !== undefined) {
      if (powerSaveBlocker.isStarted(activeBuildPowerBlocker)) powerSaveBlocker.stop(activeBuildPowerBlocker);
      activeBuildPowerBlocker = undefined;
    }
  };
  void check();
  activeBuildMonitor = setInterval(check, 5_000);
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
    await syncGitHubRepositories();
    scheduleDailyGitHubSync();
    startActiveBuildMonitor();
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
  clearInterval(activeBuildMonitor);
  if (activeBuildPowerBlocker !== undefined && powerSaveBlocker.isStarted(activeBuildPowerBlocker)) {
    powerSaveBlocker.stop(activeBuildPowerBlocker);
  }
  serverProcess?.kill();
  llamaProcess?.kill();
  modelControlServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

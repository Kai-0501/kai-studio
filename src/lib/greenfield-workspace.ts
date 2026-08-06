import { access, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { greenfieldTemplates, getGreenfieldTemplate } from "@/lib/greenfield-templates";

const defaultRoot = process.env.KAI_GREENFIELD_ROOT ?? path.join(process.env.HOME ?? process.cwd(), "KaiStudioProjects");
const runFile = promisify(execFile);

type ScaffoldFile = { path: string; content: string };
type ScaffoldDefinition = { files: ScaffoldFile[]; install: string[] };

export function greenfieldProjectRoot() { return path.resolve(defaultRoot); }

export async function approveGreenfieldRoot(root: string) {
  const approved = greenfieldProjectRoot();
  const requested = path.resolve(root);
  if (requested !== approved && !requested.startsWith(`${approved}${path.sep}`)) throw new Error("Greenfield workspaces must stay inside the approved KaiStudioProjects root.");
  await mkdir(approved, { recursive: true });
  await mkdir(requested, { recursive: true });
  const [resolvedApproved, resolvedRequested] = await Promise.all([realpath(approved), realpath(requested)]);
  if (resolvedRequested !== resolvedApproved && !resolvedRequested.startsWith(`${resolvedApproved}${path.sep}`)) throw new Error("Greenfield workspace symlinks may not escape the approved root.");
  return resolvedRequested;
}

export async function safeGreenfieldTarget(root: string, relativePath: string) {
  const approved = await approveGreenfieldRoot(root);
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("A relative project path is required.");
  const target = path.resolve(approved, relativePath);
  if (target !== approved && !target.startsWith(`${approved}${path.sep}`)) throw new Error("The requested path escapes the approved workspace.");
  if (relativePath === ".git" || relativePath.startsWith(`.git${path.sep}`) || relativePath.includes(`${path.sep}.git${path.sep}`)) throw new Error("Git internals are protected.");
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Symlink targets are not allowed."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return target;
}

export async function greenfieldHealth() {
  const root = greenfieldProjectRoot();
  try { await access(root); return { root, available: true, templates: greenfieldTemplates }; } catch { return { root, available: false, templates: greenfieldTemplates }; }
}

function json(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }

function nextFiles(name: string): ScaffoldDefinition {
  return {
    install: ["install", "--ignore-scripts"],
    files: [
      { path: "package.json", content: json({ name, version: "0.1.0", description: "A local-first application scaffolded by Kai Studio.", author: "Kai Studio", private: true, scripts: { dev: "next dev", build: "next build", start: "next start", lint: "eslint .", typecheck: "tsc --noEmit", test: "node --test tests/*.test.mjs" }, dependencies: { next: "16.2.12", react: "19.2.4", "react-dom": "19.2.4" }, devDependencies: { "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19", eslint: "^9", "eslint-config-next": "16.2.12", typescript: "^5" } }) },
      { path: "tsconfig.json", content: json({ compilerOptions: { target: "ES2024", lib: ["dom", "dom.iterable", "es2024"], strict: true, noEmit: true, module: "esnext", moduleResolution: "bundler", jsx: "preserve", incremental: true, plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }) },
      { path: "next-env.d.ts", content: "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n" },
      { path: "eslint.config.mjs", content: "import { defineConfig, globalIgnores } from 'eslint/config';\nimport nextVitals from 'eslint-config-next/core-web-vitals';\nexport default defineConfig([...nextVitals, globalIgnores(['.next/**', 'out/**', 'build/**'])]);\n" },
      { path: "src/app/layout.tsx", content: "import type { Metadata } from 'next';\nimport './globals.css';\nexport const metadata: Metadata = { title: '" + name + "', description: 'A local-first application scaffolded by Kai Studio.' };\nexport default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang=\"en\"><body>{children}</body></html>; }\n" },
      { path: "src/app/page.tsx", content: "export default function Home() { return <main><h1>" + name + "</h1><p>Your local-first Next.js application is ready.</p></main>; }\n" },
      { path: "src/app/globals.css", content: "* { box-sizing: border-box; } body { margin: 0; background: #080d16; color: #f8fafc; font-family: Arial, sans-serif; } main { max-width: 760px; margin: 12vh auto; padding: 2rem; } h1 { font-size: 2.5rem; }\n" },
      { path: "tests/scaffold.test.mjs", content: "import test from 'node:test'; import assert from 'node:assert/strict'; test('scaffold contract', () => assert.equal('" + name + "'.length > 0, true));\n" },
      { path: "public/.gitkeep", content: "" },
    ],
  };
}

function electronFiles(name: string): ScaffoldDefinition {
  const base = nextFiles(name);
  const manifest = JSON.parse(base.files.find((file) => file.path === "package.json")!.content) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
  manifest.scripts.desktop = "electron electron/main.cjs";
  manifest.scripts.package = "npm run build && electron-builder --dir";
  manifest.devDependencies.electron = "^37.2.3";
  manifest.devDependencies["electron-builder"] = "^26.0.12";
  const packageFile = base.files.find((file) => file.path === "package.json")!;
  packageFile.content = json({ ...manifest, main: "electron/main.cjs", build: { appId: `local.${name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`, productName: name, files: ["electron/**/*", ".next/**/*", "package.json"] } });
  base.files.push({ path: "electron/main.cjs", content: "const { app, BrowserWindow } = require('electron');\nconst { spawn } = require('node:child_process');\nlet server;\nfunction createWindow() { const window = new BrowserWindow({ width: 1200, height: 800 }); window.loadURL(process.env.KAI_STUDIO_RENDERER_URL || 'http://127.0.0.1:3000'); }\napp.whenReady().then(() => { server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], { stdio: 'ignore' }); setTimeout(createWindow, 1500); });\napp.on('before-quit', () => server?.kill());\n" });
  return base;
}

function nodeFiles(name: string): ScaffoldDefinition {
  return { install: ["install", "--ignore-scripts"], files: [
    { path: "package.json", content: json({ name, version: "0.1.0", description: "A local Node.js utility or service scaffolded by Kai Studio.", private: true, type: "module", scripts: { dev: "node src/index.js", test: "node --test tests/*.test.mjs", lint: "node --check src/index.js", typecheck: "node --check src/index.js", build: "node --check src/index.js" } }) },
    { path: "src/index.js", content: "import { createServer } from 'node:http';\nexport function createApp() { return createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ service: '" + name + "', status: 'ok' })); }); }\nif (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) { const server = createApp(); server.listen(process.env.PORT || 3100, () => console.log('" + name + " listening')); }\n" },
    { path: "tests/service.test.mjs", content: "import test from 'node:test'; import assert from 'node:assert/strict'; import { createApp } from '../src/index.js'; test('service returns a server', () => assert.equal(typeof createApp().listen, 'function'));\n" },
  ] };
}

function scaffoldDefinition(templateId: string, name: string) {
  if (templateId === "nextjs") return nextFiles(name);
  if (templateId === "electron-next") return electronFiles(name);
  return nodeFiles(name);
}

async function safeScaffoldTarget(projectRoot: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error("A safe relative scaffold path is required.");
  const target = path.resolve(projectRoot, relativePath);
  if (!target.startsWith(`${projectRoot}${path.sep}`)) throw new Error("The scaffold file escapes the approved project root.");
  if (relativePath === ".git" || relativePath.startsWith(`.git${path.sep}`)) throw new Error("Git internals are protected.");
  return target;
}

export async function scaffoldGreenfield(root: string, templateId: string, projectName: string) {
  const template = getGreenfieldTemplate(templateId);
  if (!template || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(projectName)) throw new Error("A supported template and safe project name are required.");
  const projectRoot = await approveGreenfieldRoot(path.join(root, projectName));
  const definition = scaffoldDefinition(template.id, projectName);
  for (const file of definition.files) {
    const target = await safeScaffoldTarget(projectRoot, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  await writeFile(path.join(projectRoot, "README.md"), `# ${projectName}\n\nScaffolded locally from the ${template.displayName} template.\n\n## Local checks\n\n\`${template.commands.test}\`\n\`${template.commands.lint}\`\n\`${template.commands.typecheck}\`\n\`${template.commands.build}\`\n`, "utf8");
  await writeFile(path.join(projectRoot, ".gitignore"), "node_modules/\n.next/\ndist/\n.DS_Store\n", "utf8");
  await runFile("/usr/bin/git", ["init", "--initial-branch=main"], { cwd: projectRoot });
  if (process.env.KAI_GREENFIELD_SKIP_INSTALL !== "1") await runFile("/opt/homebrew/bin/npm", definition.install, { cwd: projectRoot, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  return { projectRoot, template, installed: process.env.KAI_GREENFIELD_SKIP_INSTALL !== "1" };
}

export { greenfieldTemplates, getGreenfieldTemplate };

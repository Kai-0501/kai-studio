import { access, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { greenfieldTemplates, getGreenfieldTemplate } from "@/lib/greenfield-templates";

const defaultRoot = process.env.KAI_GREENFIELD_ROOT ?? path.join(process.env.HOME ?? process.cwd(), "KaiStudioProjects");
const runFile = promisify(execFile);

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

export async function scaffoldGreenfield(root: string, templateId: string, projectName: string) {
  const template = getGreenfieldTemplate(templateId);
  if (!template || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(projectName)) throw new Error("A supported template and safe project name are required.");
  const projectRoot = await approveGreenfieldRoot(path.join(root, projectName));
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: projectName, private: true, scripts: { test: "node --test", lint: "node --check src/index.js", build: "node --check src/index.js" } }, null, 2), "utf8");
  await writeFile(path.join(projectRoot, "src", "index.js"), "export function main() { return 'Kai Studio greenfield starter'; }\n", "utf8");
  await writeFile(path.join(projectRoot, "README.md"), `# ${projectName}\n\nScaffolded locally from the ${template.displayName} template.\n`, "utf8");
  await writeFile(path.join(projectRoot, ".gitignore"), "node_modules/\n.DS_Store\n", "utf8");
  await runFile("/usr/bin/git", ["init", "--initial-branch=main"], { cwd: projectRoot });
  return { projectRoot, template };
}

export { greenfieldTemplates, getGreenfieldTemplate };

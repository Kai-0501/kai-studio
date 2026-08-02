export type GreenfieldTemplate = {
  id: "nextjs" | "electron-next" | "node-service";
  displayName: string;
  description: string;
  dependencyManager: "npm";
  expectedDirectories: string[];
  commands: { development: string; test: string; lint: string; typecheck: string; build: string };
  supportsBrowserTests: boolean;
  supportsPackaging: boolean;
  allowedCapabilities: string[];
};

export const greenfieldTemplates: GreenfieldTemplate[] = [
  { id: "nextjs", displayName: "Next.js web application", description: "A local-first TypeScript web app.", dependencyManager: "npm", expectedDirectories: ["src", "public"], commands: { development: "npm run dev", test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck", build: "npm run build" }, supportsBrowserTests: true, supportsPackaging: false, allowedCapabilities: ["filesystem:approved-root", "browser:local"] },
  { id: "electron-next", displayName: "Electron + Next.js desktop application", description: "A desktop application shell around a Next.js renderer.", dependencyManager: "npm", expectedDirectories: ["src", "electron"], commands: { development: "npm run dev", test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck", build: "npm run build" }, supportsBrowserTests: true, supportsPackaging: true, allowedCapabilities: ["filesystem:approved-root", "browser:local", "packaging:approved"] },
  { id: "node-service", displayName: "Node.js utility or service", description: "A bounded TypeScript command-line utility or local service.", dependencyManager: "npm", expectedDirectories: ["src"], commands: { development: "npm run dev", test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck", build: "npm run build" }, supportsBrowserTests: false, supportsPackaging: false, allowedCapabilities: ["filesystem:approved-root"] },
];

export function getGreenfieldTemplate(id: string) {
  return greenfieldTemplates.find((template) => template.id === id) ?? null;
}

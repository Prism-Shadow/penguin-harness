/**
 * The Self-Evolution Workbench as `@penguinharness/agent-evaluation` shipped it in 0.2.19 and
 * 0.2.20 (its 2026.11.25.1 files, byte for byte): the stand-in a 0.2.19 data root has in an
 * Agent's `agent_state/workbenches/benchmark/`, with the install receipt the plugin installer
 * wrote beside it. The startup migration (services/rsi-workbench-migration.ts) replaces exactly
 * these files.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const AGENT_EVALUATION_WORKBENCH: Readonly<Record<string, string>> = {
  "index.ts": `import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

/** Benchmark requests use the existing Project routes of the evaluation service. */
export default {
  modules: {
    Workbench: {
      create() {
        return {
          api: {
            main: {
              async handle() {
                return { status: 404 };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
`,
  "package.json": `{
  "name": "self-evolution-workbench",
  "version": "1.0.0",
  "type": "module",
  "penguin": {
    "version": "2026.11.25.1",
    "icon": "ui/icon.svg",
    "appCenter": {
      "show": true,
      "title": "Self-Evolution Workbench",
      "titleZh": "自进化工作台",
      "icon": "ui/icon.svg"
    },
    "modules": [
      {
        "name": "Workbench",
        "requires": {},
        "provides": {
          "main": "@prismshadow/penguin-server#WorkbenchMain"
        },
        "contributes": {
          "WebModule.sessionTabs": [
            {
              "id": "benchmark.main",
              "key": "main",
              "title": "Self-Evolution Workbench",
              "titleZh": "自进化工作台",
              "renderer": {
                "builtin": "SelfEvolutionWorkbench"
              }
            }
          ]
        }
      }
    ]
  }
}
`,
  "ui/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.55" y2="1">
      <stop offset="0%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="11" fill="url(#bg)" />
  <g fill="none" stroke="#ffffff" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.5 24a13.5 13.5 0 0 1 23-9.5L36.5 17.5" />
    <path d="M36.5 11v6.5H30" />
    <path d="M37.5 24a13.5 13.5 0 0 1-23 9.5L11.5 30.5" />
    <path d="M11.5 37v-6.5H18" />
    <path d="M24 29.5v-11" />
    <path d="m19.8 22.7 4.2-4.2 4.2 4.2" />
  </g>
</svg>
`,
};

/**
 * Writes that workbench into `dir` as the 0.2.19 installer left it: the files, then the receipt
 * naming `agent-evaluation`. `edit` changes a file first (a copy someone edited).
 */
export async function writeAgentEvaluationWorkbench(
  dir: string,
  edit?: (files: Record<string, string>) => void,
): Promise<void> {
  const files = { ...AGENT_EVALUATION_WORKBENCH };
  edit?.(files);
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
  await fs.writeFile(
    path.join(dir, ".plugin.json"),
    JSON.stringify({
      name: "benchmark",
      plugin: "agent-evaluation",
      version: "2026.11.25.1",
      files: Object.keys(AGENT_EVALUATION_WORKBENCH),
    }),
  );
}

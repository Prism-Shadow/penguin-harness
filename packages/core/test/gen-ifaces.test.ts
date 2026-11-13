/**
 * `penguin-gen-ifaces`, the generator core publishes so a plugin package outside this repository
 * builds its `ifaces.json` the way the shipped plugins do. The host reads a plugin's
 * contributions out of that table without running the package, so the table must hold exactly
 * what the source wrote, and a value the generator cannot read as data must stop the build.
 *
 * - Given a package whose contributions are written out as literals, when it is built, its
 *   ifaces.json carries each contribution exactly as written, and names the package's modules.
 * - Given that package lists its own `typescript`, the generator compiles with that one.
 * - Given contributions that reference a constant, spread one, or use a shorthand property, the
 *   build fails naming the file, line and key of each, and no ifaces.json is written. The
 *   package has no `typescript` of its own, so this run also compiles with core's.
 * - Given a decorator whose whole meta is held in a constant, the build fails: read as a
 *   reference, its contributions would silently vanish from the table.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("../bin/gen-ifaces.mjs", import.meta.url));
const SOURCE = path.join("src", "index.ts");
/** A hook's budget for one generator run: a cold runner's first node spawn plus loading typescript. */
const SPAWN_BUDGET = 30_000;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A plugin package in a temp directory: its files, and a tsconfig over `src`. */
function plugin(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gen-ifaces-")));
  dirs.push(dir);
  const all = {
    "package.json": JSON.stringify({ name: "@example/demo", version: "1.0.0", type: "module" }),
    // The meta is read off the syntax; without lib.d.ts a run takes a fraction of the time.
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "es2022", module: "nodenext", noLib: true, types: [] },
      include: ["src"],
    }),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/** The package's build line, run in the package's directory. */
const build = (dir: string): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, [BIN, "--project", "tsconfig.json", "--out", "ifaces.json"], {
    cwd: dir,
    encoding: "utf8",
  });

/** The 1-based line of the first source line containing `needle`. */
const lineOf = (source: string, needle: string): number =>
  source.split("\n").findIndex((line) => line.includes(needle)) + 1;

const HEADER = `import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
`;

describe("a plugin whose contributions are written out", () => {
  const source = `${HEADER}
@Component({
  contributes: {
    "PluginLibraryModule.skills": [
      { id: "demo.skill.notes", name: "notes", path: "skills/notes" },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "demo.hooks",
        version: "2026.11.04.1",
        path: "hooks",
        stop: [{ command: "stop.mjs", timeout: 60 }],
      },
    ] as const,
    "PluginLibraryModule.cards": [
      { id: "demo.card", title: "Demo", preinstall: false, quickStart: { prompt: "Take a note.", goal: true } },
    ],
  },
})
export class DemoPlugin {}

export default { modules: [DemoPlugin] } satisfies Plugin;
`;
  let dir: string;
  let run: SpawnSyncReturns<string>;
  beforeAll(() => {
    // The package's own compiler: the real one, leaving a mark when it is loaded.
    const realTypeScript = createRequire(import.meta.url).resolve("typescript");
    dir = plugin({
      [SOURCE]: source,
      "node_modules/typescript/package.json": JSON.stringify({
        name: "typescript",
        main: "index.js",
      }),
      "node_modules/typescript/index.js": `require("node:fs").writeFileSync(require("node:path").join(__dirname, "loaded"), "");
module.exports = require(${JSON.stringify(realTypeScript)});
`,
    });
    run = build(dir);
  }, SPAWN_BUDGET);

  it("builds an ifaces.json that carries each contribution as written and names the package's modules", () => {
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const table = JSON.parse(fs.readFileSync(path.join(dir, "ifaces.json"), "utf8"));
    expect(table.modules.DemoPlugin.contributes).toEqual({
      "PluginLibraryModule.skills": [
        { id: "demo.skill.notes", name: "notes", path: "skills/notes" },
      ],
      "PluginLibraryModule.hooks": [
        {
          id: "demo.hooks",
          version: "2026.11.04.1",
          path: "hooks",
          stop: [{ command: "stop.mjs", timeout: 60 }],
        },
      ],
      "PluginLibraryModule.cards": [
        {
          id: "demo.card",
          title: "Demo",
          preinstall: false,
          quickStart: { prompt: "Take a note.", goal: true },
        },
      ],
    });
    expect(table.plugin).toEqual({ modules: ["DemoPlugin"], replaces: [] });
  });

  it("is compiled with the typescript the package lists", () => {
    expect(fs.existsSync(path.join(dir, "node_modules/typescript/loaded"))).toBe(true);
  });
});

describe("a plugin whose contributions are not all written out", () => {
  const source = `${HEADER}
const SKILLS = [{ id: "demo.skill.notes", name: "notes", path: "skills/notes" }];
const setup = [{ key: "DOCS_TOKEN" }];
const card = { id: "demo.card" };
const WORKBENCHES = [{ id: "demo.workbench.board", name: "board", path: "workbenches/board" }];

@Component({
  contributes: {
    "PluginLibraryModule.skills": SKILLS,
    "PluginLibraryModule.mcpServers": [
      { id: "demo.mcp.docs", name: "docs", config: { command: "node" }, setup },
    ],
    "PluginLibraryModule.cards": [{ ...card, title: "Demo" }],
    "PluginLibraryModule.workbenches": [...WORKBENCHES],
  },
})
export class DemoPlugin {}

const META = { contributes: { "PluginLibraryModule.cards": [{ id: "other.card" }] } };

@Component(META)
export class OtherPlugin {}

export default { modules: [DemoPlugin, OtherPlugin] } satisfies Plugin;
`;
  let dir: string;
  let run: SpawnSyncReturns<string>;
  beforeAll(() => {
    dir = plugin({ [SOURCE]: source });
    run = build(dir);
  }, SPAWN_BUDGET);

  it("is refused, naming the file, line and key of each value, and no ifaces.json is written", () => {
    expect(run.status).toBe(1);
    const at = (needle: string) => `${SOURCE}:${lineOf(source, needle)}: DemoPlugin contributes`;
    expect(run.stderr).toContain(
      `${at('"PluginLibraryModule.skills": SKILLS')}["PluginLibraryModule.skills"]: 'SKILLS' is a reference`,
    );
    expect(run.stderr).toContain(
      `${at("setup },")}["PluginLibraryModule.mcpServers"][0].setup: 'setup' is shorthand for a reference`,
    );
    expect(run.stderr).toContain(
      `${at("...card")}["PluginLibraryModule.cards"][0]: '...card' is a spread`,
    );
    expect(run.stderr).toContain(
      `${at("[...WORKBENCHES]")}["PluginLibraryModule.workbenches"]: '...WORKBENCHES' is a spread`,
    );
    expect(fs.existsSync(path.join(dir, "ifaces.json"))).toBe(false);
  });

  it("refuses a decorator whose meta is held in a constant, whose contributions would otherwise vanish", () => {
    expect(run.stderr).toContain(
      `${SOURCE}:${lineOf(source, "@Component(META)")}: @Component(META) on OtherPlugin: the argument must be an object literal`,
    );
  });
});

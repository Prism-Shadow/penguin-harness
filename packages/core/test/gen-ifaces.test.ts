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
 * - Given a package whose program reaches another package's sources (a plugin compiled against
 *   its host's face through tsconfig paths), built with `--sources src`, its table holds its own
 *   modules and plugin declaration and none of the other package's classes, and a copy, under
 *   the host's key, of the host interface its module requires.
 * - Given the same program built without `--sources`, the other package's default export is not
 *   taken for this package's plugin declaration: the build passes and the declaration is its own.
 * - Given overlapping source projects, re-exports keep both package keys and a slot's
 *   code interface is present, including nested anonymous objects with methods.
 * - Given conflicting source aliases, generation refuses the ambiguous inputs without
 *   writing a table; an invalid tsconfig is also reported before any output is written.
 * - Given two targets with identically named modules, reading the other target's types
 *   does not put its runtime module into a table restricted to the configured roots.
 * - Given CLI contributions from its own package and the server, invoking generation
 *   from either package or repository root emits the same imports and command order.
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

describe("a table built from overlapping source projects", () => {
  it("emits the same command table from the repository and package directories", () => {
    const component = (name: string) => `
declare function Component(meta: unknown): any;
@Component({ contributes: { "CliCommandsModule.commands": [{ id: "${name}" }] } })
export class ${name} {}
`;
    const dir = plugin({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", noLib: true, types: [] },
        include: ["packages/cli/src", "packages/server/src/cli"],
      }),
      "packages/cli/src/local.ts": component("LocalCommand"),
      "packages/server/src/cli/remote.ts": component("ServerCommand"),
    });
    const table = path.join(dir, "packages/cli/src/commands.ts");
    const args = [
      BIN,
      "--project",
      path.join(dir, "tsconfig.json"),
      "--out",
      path.join(dir, "ifaces.json"),
      "--components-out",
      table,
    ];
    const first = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    const text = fs.readFileSync(table, "utf8");
    const second = spawnSync(process.execPath, args, {
      cwd: path.join(dir, "packages/cli"),
      encoding: "utf8",
    });
    expect(second.status, second.stderr).toBe(0);
    expect(fs.readFileSync(table, "utf8")).toBe(text);
    expect(text).toContain('from "@prismshadow/penguin-server/cli"');
    expect(text).toContain('from "./local.js"');
  });

  it("collects a target's modules while reading another target's types", () => {
    const dir = plugin({
      "src/index.ts": `
import type { Other } from "../other/index.js";
declare function Module(meta: unknown): any;
declare function Interface(): any;
@Module({ contributes: { "Example.items": [{ id: "selected" }] } })
export class SharedName {}
@Interface()
export abstract class Contract { abstract read(): Other }
`,
      "other/index.ts": `
declare function Module(meta: unknown): any;
@Module({ contributes: { "Example.items": [{ id: "other-target" }] } })
export class SharedName {}
export interface Other { value: string }
`,
    });
    const run = spawnSync(
      process.execPath,
      [BIN, "--project", "tsconfig.json", "--out", "ifaces.json", "--root-modules"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    const table = JSON.parse(fs.readFileSync(path.join(dir, "ifaces.json"), "utf8"));
    expect(Object.keys(table.modules)).toEqual(["SharedName"]);
    expect(table.modules.SharedName.contributes).toEqual({ "Example.items": [{ id: "selected" }] });
    expect(
      table.types[table.ifaces["@example/demo#Contract"].methods.read.returns.data.$ref],
    ).toEqual({ value: "string" });
  });

  it("keeps re-exports and every interface reached through slot code", () => {
    const dir = plugin({
      "src/index.ts": 'export { Catalog, type CatalogSlots } from "../other/src/index.js";',
      "other/package.json": JSON.stringify({ name: "@example/other", type: "module" }),
      "other/tsconfig.json": JSON.stringify({ extends: "../tsconfig.json", include: ["src"] }),
      "other/src/index.ts": `
declare function Interface(): any;
interface Slot<D, C> { data: D; code: C }
interface Handler { invoke(): number }
@Interface()
export abstract class Catalog {
  abstract value(): { label: string; run(): number };
}
export interface CatalogSlots { commands: Slot<{ title: string }, Handler> }
`,
    });
    const run = spawnSync(
      process.execPath,
      [
        BIN,
        "--project",
        "tsconfig.json",
        "--project",
        "other/tsconfig.json",
        "--out",
        "ifaces.json",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    const table = JSON.parse(fs.readFileSync(path.join(dir, "ifaces.json"), "utf8"));
    const own = table.ifaces["@example/other#Catalog"];
    expect(table.ifaces["@example/demo#Catalog"]).toEqual(own);
    expect(own.methods.value.returns.object.run.fn.returns).toEqual({ data: "number" });
    const handler = table.ifaces[own.slots.commands.code.iface];
    expect(handler.methods.invoke.returns).toEqual({ data: "number" });
  });

  it.each(["alias", "config"])(
    "refuses an ambiguous or invalid %s before writing output",
    (kind) => {
      const dir = plugin({
        "src/index.ts": "export {};",
        "first.json": JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions: {
            paths: { "@example/dependency": ["./src/first.ts"] },
          },
        }),
        "second.json": JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions:
            kind === "alias"
              ? { paths: { "@example/dependency": ["./src/second.ts"] } }
              : { target: "invalid-target" },
        }),
      });
      const run = spawnSync(
        process.execPath,
        [BIN, "--project", "first.json", "--project", "second.json", "--out", "ifaces.json"],
        { cwd: dir, encoding: "utf8" },
      );
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(kind === "alias" ? "conflicting paths" : "target");
      expect(fs.existsSync(path.join(dir, "ifaces.json"))).toBe(false);
    },
  );
});

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

describe("a package whose program reaches another package's sources", () => {
  let root: string;
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gen-ifaces-")));
    dirs.push(root);
    const files: Record<string, string> = {
      "host/package.json": JSON.stringify({ name: "@example/host", version: "1.0.0" }),
      "host/src/face.ts": `${HEADER}import { Interface } from "@prismshadow/penguin-core/plugin";
@Component({})
export class HostService {}

@Interface()
export abstract class HostClock {
  abstract now(): number;
}

export default { modules: [HostService] } satisfies Plugin;
`,
      "demo/package.json": JSON.stringify({ name: "@example/demo", version: "1.0.0" }),
      "demo/tsconfig.json": JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", noLib: true, types: [] },
        include: ["src"],
      }),
      "demo/src/index.ts": `${HEADER}import { Use } from "@prismshadow/penguin-core/plugin";
import { HostService, type HostClock } from "../../host/src/face.js";

@Component({})
export class DemoPlugin {
  host = HostService;
  @Use() clock!: HostClock;
}

export default { modules: [DemoPlugin] } satisfies Plugin;
`,
    };
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
  });

  const generate = (...extra: string[]): SpawnSyncReturns<string> =>
    spawnSync(
      process.execPath,
      [BIN, "--project", "tsconfig.json", ...extra, "--out", "ifaces.json"],
      { cwd: path.join(root, "demo"), encoding: "utf8" },
    );
  const table = () => JSON.parse(fs.readFileSync(path.join(root, "demo", "ifaces.json"), "utf8"));

  it(
    "with --sources src, keeps the other package's classes out and copies the interface it requires",
    () => {
      const run = generate("--sources", "src");
      expect(run.stderr).not.toMatch(/error/);
      expect(run.status).toBe(0);
      expect(Object.keys(table().modules)).toEqual(["DemoPlugin"]);
      expect(table().plugin).toEqual({ modules: ["DemoPlugin"], replaces: [] });
      expect(table().modules.DemoPlugin.requires.clock).toMatchObject({
        iface: "@example/host#HostClock",
      });
      expect(table().ifaces).toHaveProperty(["@example/host#HostClock"]);
    },
    SPAWN_BUDGET,
  );

  it(
    "without it, does not take the other package's default export for its plugin declaration",
    () => {
      const run = generate();
      expect(run.status).toBe(0);
      expect(table().plugin).toEqual({ modules: ["DemoPlugin"], replaces: [] });
    },
    SPAWN_BUDGET,
  );
});

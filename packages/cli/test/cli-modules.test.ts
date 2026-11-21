/**
 * Shipped plugins' CLI modules, through the real `cli()` (cli-modules.ts, index.ts): the classes
 * of a plugin's `./cli` export booted in a tree of their own against the table the module
 * carries, their commands put on the program after the CLI's own, and the list of such modules
 * generated from the CLI package's dependencies (scripts/gen-cli-modules.mjs).
 *
 * The generated list is the one seam between the build and the CLI at run time, so the test
 * stands in for the build there: `cli-modules.gen.ts` is replaced by a list of fixture modules,
 * and everything after it is the real entry. Each fixture is what a plugin's build leaves —
 * lowered JavaScript importing the SDK's decorators, with its own table — in a temp dir.
 *
 * - Given a module with a command, when it runs, its action runs in this process and prints in
 *   the invocation's language, reading the module's own message group beside the host's; a
 *   group named like a host group is the host's, with one warning naming the package.
 * - Given a command whose register throws, `penguin --version` and `penguin server --help` still
 *   answer, the command is not in help, one warning names its package, and the next module's
 *   commands still register.
 * - Given a module that throws while it evaluates, the same: the CLI answers, one warning, the
 *   next module registers.
 * - Given a command whose first word is an alias already on the program, it is left out and the
 *   alias still reaches its own command; a register that adds an alias already taken is taken
 *   off the program, and the command the alias names is untouched.
 * - Given a module that repeats a key, the first command stands and the repeat is left out.
 * - Given a later module that reuses an earlier module's first word, a CLI command's name or a
 *   malformed key, each is left out with a warning, and the earlier commands are untouched.
 * - The generated list names exactly the package's plugin dependencies (`@penguinharness/*`)
 *   whose package.json exports `./cli`, in package-name order, each importing its `./cli`
 *   default export; a plugin that is not installed is an error, not a module silently missing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInfo } from "@prismshadow/penguin-core";
import type { CliModule } from "@prismshadow/penguin-core/cli";
import { getMessages } from "@prismshadow/penguin-server/cli";
import { renderCliModules, shippedCliPackages } from "../../../scripts/gen-cli-modules.mjs";
import { cli } from "../src/index.js";

/** What the build would have generated: filled per test with the fixture modules. */
const shipped = vi.hoisted(() => ({
  list: [] as { package: string; load: () => Promise<CliModule> }[],
}));
vi.mock("../src/cli-modules.gen.js", () => ({ shippedCliModules: shipped.list }));

/** The SDK's decorators as a plugin's bundle carries them, by file URL from this checkout's build. */
const decorators = new URL("../../core/dist/kernel/index.js", import.meta.url).href;

/** One command of a fixture module: its contribution, and its register as JavaScript source. */
interface Contribution {
  id: string;
  key: string;
  register: string;
}

/** A register that prints `text` (a JavaScript expression over the bundle `t`) when run. */
const printing = (text: string): string =>
  `(node, ctx) => node.action(() => { const t = ctx.messages; process.stdout.write(${text} + "\\n"); })`;

let scratch: string;
const files = new Map<string, string>();

/** Writes a built CLI module: lowered source whose default export carries its own table. */
function writeModule(name: string, contributions: Contribution[], messages = "undefined"): void {
  const cls = `${name.replace(/(^|-)(\w)/g, (_, _dash, c: string) => c.toUpperCase())}Command`;
  const pkg = `@penguinharness/${name}`;
  const entries = contributions.map(({ id, key }) => ({
    id,
    key,
    summary: { en: `Run ${key}`, zh: `运行 ${key}` },
  }));
  const table = {
    ifaces: { [`${pkg}#${cls}`]: { name: cls, methods: {}, slots: {} } },
    types: {},
    modules: {
      [cls]: {
        name: cls,
        kind: "component",
        requires: {},
        provides: { [cls]: `${pkg}#${cls}` },
        contributes: { "ShippedCommandsModule.commands": entries },
        children: [],
      },
    },
  };
  const source = `
import { Bind, Component } from ${JSON.stringify(decorators)};
@Component({ contributes: { "ShippedCommandsModule.commands": ${JSON.stringify(entries)} } })
export class ${cls} {
${contributions.map((c, i) => `  @Bind(${JSON.stringify(c.id)}) c${i}!: unknown;`).join("\n")}
  setup() {
${contributions.map((c, i) => `    this.c${i} = { register: ${c.register} };`).join("\n")}
  }
}
export default { modules: [${cls}], ifaces: ${JSON.stringify(table)}, messages: ${messages} };
`;
  writeLowered(name, source);
}

function writeLowered(name: string, source: string): void {
  const file = path.join(scratch, `${name}.mjs`);
  const lowered = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  fs.writeFileSync(file, lowered);
  files.set(name, pathToFileURL(file).href);
}

/** The generated-list entry of a fixture module, imported when the CLI asks for it. */
const entry = (name: string) => ({
  package: `@penguinharness/${name}`,
  load: async () => ((await import(files.get(name)!)) as { default: CliModule }).default,
});

const GREET_MESSAGES = `{
  en: { greet: { hello: "Hello" }, client: { noServer: () => "the module's words" } },
  zh: { greet: { hello: "你好" }, client: { noServer: () => "模块自己的话" } },
}`;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-modules-"));
  writeModule(
    "greet",
    [
      {
        id: "greet.cli",
        key: "greet",
        register: printing(`t.greet.hello + " | " + t.client.noServer()`),
      },
    ],
    GREET_MESSAGES,
  );
  writeModule("thrower", [
    { id: "thrower.cli", key: "boom", register: `() => { throw new Error("register boom"); }` },
  ]);
  writeLowered("evaluation", `throw new Error("evaluation boom");`);
  writeModule("aliaser", [
    {
      id: "aliaser.cli",
      key: "alpha",
      register: `(node, ctx) => { node.alias("al"); (${printing(`"alpha"`)})(node, ctx); }`,
    },
    { id: "aliaser.steal", key: "steal", register: `(node) => { node.alias("server"); }` },
  ]);
  writeModule("late", [{ id: "late.cli", key: "al", register: printing(`"late"`) }]);
  writeModule("dup", [
    { id: "dup.first", key: "twice", register: printing(`"first"`) },
    { id: "dup.second", key: "twice", register: printing(`"second"`) },
  ]);
  writeModule("reuser", [
    { id: "reuser.greet", key: "greet", register: printing(`"reused"`) },
    { id: "reuser.extra", key: "greet.extra", register: printing(`"extra"`) },
    { id: "reuser.server", key: "server", register: printing(`"the module's server"`) },
    { id: "reuser.bad", key: "Bad", register: printing(`"malformed"`) },
  ]);
});
afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

let stdout: string[];
let stderr: string[];
let spies: { mockRestore(): void }[];
let priorLang: string | undefined;

beforeEach(() => {
  stdout = [];
  stderr = [];
  priorLang = process.env.PENGUIN_LANG;
  process.env.PENGUIN_LANG = "en";
  spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    }),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  if (priorLang === undefined) delete process.env.PENGUIN_LANG;
  else process.env.PENGUIN_LANG = priorLang;
  shipped.list.length = 0;
});

/** Ships these fixture modules, in this order, as the generated list would. */
const ship = (...names: string[]): void => {
  shipped.list.splice(0, shipped.list.length, ...names.map(entry));
};

/** `penguin <argv>`: its exit code, what it printed, and the warnings naming fixture packages. */
async function run(argv: string[]): Promise<{ code: number; out: string; warnings: string[] }> {
  stdout.length = 0;
  stderr.length = 0;
  const code = await cli(argv);
  const warnings = stderr.filter((line) => line.includes("@penguinharness/"));
  return { code, out: stdout.join(""), warnings };
}

/** The top-level command names `penguin --help` lists. */
async function listed(): Promise<string[]> {
  const { out } = await run(["--help"]);
  const section = out.split(/\nCommands:\n/)[1] ?? "";
  return section
    .split("\n")
    .map((line) => /^ {2}([^\s|]+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe("a shipped CLI module's commands", () => {
  it.each(["en", "zh"] as const)(
    "run in this process and read the module's group beside the host's, the host's standing, in %s",
    async (language) => {
      process.env.PENGUIN_LANG = language;
      ship("greet");
      const host = getMessages(language).client.noServer();
      const hello = language === "zh" ? "你好" : "Hello";
      const { code, out, warnings } = await run(["greet"]);
      expect(code).toBe(0);
      expect(out).toBe(`${hello} | ${host}\n`);
      // The module's `client` group lost to the host's, and said so once.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("@penguinharness/greet");
      expect(warnings[0]).toContain("client");
    },
  );
});

describe("a shipped CLI module that fails never stops the CLI", () => {
  it.each([
    ["a register that throws", "thrower"],
    ["a module that throws while it evaluates", "evaluation"],
  ])("given %s, the CLI answers and the next module still registers", async (_case, name) => {
    ship(name, "dup");
    const version = await run(["--version"]);
    expect(version.code).toBe(0);
    expect(version.out).toBe(`${buildInfo().describe}\n`);
    expect(version.warnings.filter((w) => w.includes(`@penguinharness/${name}`))).toHaveLength(1);
    const serverHelp = await run(["server", "--help"]);
    expect(serverHelp.code).toBe(0);
    expect(serverHelp.out).toContain("server");
    const commands = await listed();
    expect(commands).not.toContain("boom");
    expect(commands).toContain("twice");
    expect((await run(["twice"])).out).toBe("first\n");
  });
});

describe("a shipped command never takes a name the program already has", () => {
  it("an alias on the program keeps reaching its command, and a register taking one is undone", async () => {
    ship("aliaser", "late");
    const { code, out, warnings } = await run(["al"]);
    expect(code).toBe(0);
    expect(out).toBe("alpha\n");
    // `late`'s `al` was left out, and `steal` (whose register aliased `server`) taken off again.
    expect(warnings.filter((w) => w.includes("@penguinharness/late"))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("@penguinharness/aliaser"))).toHaveLength(1);
    expect(await listed()).not.toContain("steal");
    expect((await run(["server", "--help"])).code).toBe(0);
  });

  it("a key its module repeats is left out, and the first command with it stands", async () => {
    ship("dup");
    const { out, warnings } = await run(["twice"]);
    expect(out).toBe("first\n");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("twice");
  });

  it("an earlier module's first word, a CLI command's name and a malformed key are left out", async () => {
    ship("greet", "reuser");
    const { out, warnings } = await run(["greet"]);
    expect(out).toBe(`Hello | ${getMessages("en").client.noServer()}\n`);
    const reuser = warnings.filter((w) => w.includes("@penguinharness/reuser"));
    expect(reuser).toHaveLength(4);
    for (const key of ["greet", "greet.extra", "server", "Bad"]) {
      expect(reuser.some((w) => w.includes(`"${key}"`))).toBe(true);
    }
    // `penguin server` is still the CLI's: help describes it with the CLI's own summary.
    const help = (await run(["--help"])).out;
    expect(help).not.toContain("Run server");
    expect(help).not.toContain("Run Bad");
  });
});

describe("the generated list of shipped CLI modules", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-modules-gen-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A package at `dir` with these dependencies, each installed under its node_modules. */
  function writePackage(
    dependencies: Record<string, { exports?: unknown; cli?: string }>,
    devDependencies: Record<string, { exports?: unknown }> = {},
  ): void {
    const versions = (deps: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(deps).map((name) => [name, "1.0.0"]));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "host",
        type: "module",
        dependencies: versions(dependencies),
        devDependencies: versions(devDependencies),
      }),
    );
    for (const [name, dep] of Object.entries({ ...dependencies, ...devDependencies })) {
      const at = path.join(dir, "node_modules", name);
      fs.mkdirSync(at, { recursive: true });
      fs.writeFileSync(
        path.join(at, "package.json"),
        JSON.stringify({ name, type: "module", exports: dep.exports }),
      );
      if ("cli" in dep && dep.cli !== undefined) fs.writeFileSync(path.join(at, "cli.js"), dep.cli);
    }
  }

  it("names the plugin dependencies that export ./cli, in package-name order, and nothing else", () => {
    const cliExport = { "./cli": "./cli.js" };
    writePackage(
      {
        "@penguinharness/zeta": { exports: cliExport },
        "@penguinharness/alpha": { exports: { ".": "./index.js", ...cliExport } },
        "@penguinharness/content": {},
        "@penguinharness/server-only": { exports: { ".": "./index.js" } },
        // A host package's own `./cli` subpath is not a plugin's CLI module.
        "@prismshadow/host-sdk": { exports: cliExport },
      },
      { "@penguinharness/dev-tool": { exports: cliExport } },
    );
    expect(shippedCliPackages(dir)).toEqual(["@penguinharness/alpha", "@penguinharness/zeta"]);
  });

  it("imports each listed package's ./cli default export when asked, with its package", async () => {
    writePackage({
      "@penguinharness/alpha": {
        exports: { "./cli": "./cli.js" },
        cli: 'export default { marker: "alpha" };',
      },
    });
    // Compiled the way the CLI's build compiles it, beside the package it was generated for.
    const file = path.join(dir, "cli-modules.gen.mjs");
    const generated = renderCliModules(shippedCliPackages(dir));
    fs.writeFileSync(
      file,
      ts.transpileModule(generated, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    );
    const { shippedCliModules } = (await import(pathToFileURL(file).href)) as {
      shippedCliModules: { package: string; load: () => Promise<unknown> }[];
    };
    expect(shippedCliModules.map((m) => m.package)).toEqual(["@penguinharness/alpha"]);
    expect(await shippedCliModules[0]!.load()).toEqual({ marker: "alpha" });
  });

  it("refuses a plugin that is not installed instead of leaving it out", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "host", dependencies: { "@penguinharness/missing": "1.0.0" } }),
    );
    expect(() => shippedCliPackages(dir)).toThrow(/@penguinharness\/missing.*pnpm install/s);
  });
});

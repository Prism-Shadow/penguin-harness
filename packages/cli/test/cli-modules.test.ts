/**
 * A shipped plugin's CLI module, as the CLI takes it (cli-modules.ts): the classes of a
 * plugin's `./cli` export booted in a tree of their own against the table the module carries,
 * their commands put on the program after the CLI's own, and the list of such modules generated
 * from the CLI package's dependencies (scripts/gen-cli-modules.mjs). The fixture module is what a
 * plugin's build leaves: lowered JavaScript importing the SDK's decorators, and its own table.
 *
 * - Given a module with a command, when it runs, its action runs in this process and prints in
 *   the invocation's language, reading the module's own message group beside the host's — and
 *   the host's where the module brings a group of the same name.
 * - Given a command whose first word is already a CLI command, or whose key is malformed, it is
 *   left out with one warning naming its package: the CLI's command keeps its own action, and
 *   the module's other commands still register.
 * - Given a module that does not boot (its table lacks its class), none of its commands
 *   register, one warning names its package, and the next module's commands still do.
 * - The generated list names exactly the package's plugin dependencies (`@penguinharness/*`)
 *   whose package.json exports `./cli`, in package-name order, each with its `./cli` default
 *   export; a plugin that is not installed is an error, not a module silently missing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliCommandProgram, CliModule } from "@prismshadow/penguin-core/cli";
import { getMessages } from "@prismshadow/penguin-server/cli";
import type { Language } from "@prismshadow/penguin-server/cli";
import { bootShippedCommands } from "../src/cli-modules.js";
import type { ShippedCliModule } from "../src/cli-modules.js";
import { renderCliModules, shippedCliPackages } from "../../../scripts/gen-cli-modules.mjs";

/** The SDK's decorators as a plugin's bundle carries them, by file URL from this checkout's build. */
const decorators = new URL("../../core/dist/kernel/index.js", import.meta.url).href;

const PKG = "@penguinharness/demo-cli";

/** The module's classes as its author writes them, lowered the way its build would. */
const SOURCE = `
import { Bind, Component } from ${JSON.stringify(decorators)};
@Component({
  contributes: {
    "ShippedCommandsModule.commands": [
      { id: "demo.cli", key: "demo", summary: { en: "Say hello", zh: "打招呼" } },
      { id: "demo.server", key: "server", summary: { en: "Take over server", zh: "顶替 server" } },
      { id: "demo.bad", key: "Demo", summary: { en: "Malformed", zh: "坏键" } },
    ],
  },
})
export class DemoCommand {
  @Bind("demo.cli") cli!: unknown;
  @Bind("demo.server") server!: unknown;
  @Bind("demo.bad") bad!: unknown;
  setup() {
    const say = (text: (t: any) => string) => ({
      register: (node: any, ctx: any) =>
        node.action(() => {
          process.stdout.write(text(ctx.messages) + "\\n");
        }),
    });
    this.cli = say((t) => t.demo.hello + " | " + t.client.noServer());
    this.server = say(() => "the module's server");
    this.bad = say(() => "malformed");
  }
}
`;

/** The table the module's build would have generated for DemoCommand. */
const TABLE = {
  ifaces: {
    [`${PKG}#DemoCommand`]: { name: "DemoCommand", methods: {}, slots: {} },
  },
  types: {},
  modules: {
    DemoCommand: {
      name: "DemoCommand",
      kind: "component",
      requires: {},
      provides: { DemoCommand: `${PKG}#DemoCommand` },
      contributes: {
        "ShippedCommandsModule.commands": [
          { id: "demo.cli", key: "demo", summary: { en: "Say hello", zh: "打招呼" } },
          {
            id: "demo.server",
            key: "server",
            summary: { en: "Take over server", zh: "顶替 server" },
          },
          { id: "demo.bad", key: "Demo", summary: { en: "Malformed", zh: "坏键" } },
        ],
      },
      children: [],
    },
  },
};

/** The module's own message groups: its greeting, and a group the host already has. */
const MESSAGES = {
  en: { demo: { hello: "Hello" }, client: { noServer: () => "the module's words" } },
  zh: { demo: { hello: "你好" }, client: { noServer: () => "模块自己的话" } },
};

let scratch: string;
let DemoCommand: CliModule["modules"][number];
let stdout: string[];
let stderr: string[];
let spies: { mockRestore(): void }[];

beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-modules-"));
  const entry = path.join(scratch, "cli.mjs");
  const lowered = ts.transpileModule(SOURCE, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  fs.writeFileSync(entry, lowered);
  ({ DemoCommand } = (await import(pathToFileURL(entry).href)) as {
    DemoCommand: CliModule["modules"][number];
  });
});
afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  stdout = [];
  stderr = [];
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
});

const demo = (over: Partial<CliModule> = {}): ShippedCliModule => ({
  package: PKG,
  module: { modules: [DemoCommand], ifaces: TABLE, messages: MESSAGES, ...over },
});

/**
 * A program the way the CLI assembles one: its own `server` command first, then the shipped
 * commands, each on the node its key names, registered with the host's bundle.
 */
async function programWith(
  modules: readonly ShippedCliModule[],
  language: Language = "en",
): Promise<{ program: Command; keys: string[] }> {
  const t = getMessages(language);
  const program = new Command().exitOverride();
  program.command("server").action(() => {
    process.stdout.write("the CLI's server\n");
  });
  const shipped = await bootShippedCommands(modules, [{ key: "server" }], t);
  for (const command of shipped) {
    const node = program.command(command.key).description(command.summary[language]);
    command.code.register(node as unknown as CliCommandProgram, { messages: t });
  }
  return { program, keys: shipped.map((c) => c.key) };
}

const run = async (program: Command, argv: string[]): Promise<string> => {
  stdout.length = 0;
  await program.parseAsync(argv, { from: "user" });
  return stdout.join("");
};

describe("a shipped CLI module's commands", () => {
  it.each(["en", "zh"] as const)(
    "run in this process and read the module's group beside the host's, the host's standing, in %s",
    async (language) => {
      const { program } = await programWith([demo()], language);
      // The module's `client` group is not what the command reads: the host's is.
      const host = getMessages(language).client.noServer();
      expect(host).not.toBe(MESSAGES[language].client.noServer());
      expect(await run(program, ["demo"])).toBe(`${MESSAGES[language].demo.hello} | ${host}\n`);
    },
  );

  it("never take a CLI command's name or a malformed key, and the rest still register", async () => {
    const { program, keys } = await programWith([demo()]);
    expect(keys).toEqual(["demo"]);
    expect(await run(program, ["server"])).toBe("the CLI's server\n");
    expect(stderr).toHaveLength(2);
    for (const [line, key] of [
      [stderr[0], "server"],
      [stderr[1], "Demo"],
    ] as const) {
      expect(line).toContain(PKG);
      expect(line).toContain(key);
    }
  });
});

describe("a shipped CLI module that does not boot", () => {
  it("adds nothing, warns once naming its package, and the next module still registers", async () => {
    const unbuilt: ShippedCliModule = {
      package: "@penguinharness/unbuilt-cli",
      module: { modules: [DemoCommand], ifaces: { ifaces: {}, types: {}, modules: {} } },
    };
    const { program, keys } = await programWith([unbuilt, demo()]);
    expect(keys).toEqual(["demo"]);
    expect(stderr.filter((line) => line.includes("@penguinharness/unbuilt-cli"))).toHaveLength(1);
    expect(await run(program, ["demo"])).toContain("Hello");
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
    const cli = { "./cli": "./cli.js" };
    writePackage(
      {
        "@penguinharness/zeta": { exports: cli },
        "@penguinharness/alpha": { exports: { ".": "./index.js", ...cli } },
        "@penguinharness/content": {},
        "@penguinharness/server-only": { exports: { ".": "./index.js" } },
        // A host package's own `./cli` subpath is not a plugin's CLI module.
        "@prismshadow/host-sdk": { exports: cli },
      },
      { "@penguinharness/dev-tool": { exports: cli } },
    );
    expect(shippedCliPackages(dir)).toEqual(["@penguinharness/alpha", "@penguinharness/zeta"]);
  });

  it("imports each listed package's ./cli default export, with its package", async () => {
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
      shippedCliModules: { package: string; module: unknown }[];
    };
    expect(shippedCliModules).toEqual([
      { package: "@penguinharness/alpha", module: { marker: "alpha" } },
    ]);
  });

  it("refuses a plugin that is not installed instead of leaving it out", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "host", dependencies: { "@penguinharness/missing": "1.0.0" } }),
    );
    expect(() => shippedCliPackages(dir)).toThrow(/@penguinharness\/missing.*pnpm install/s);
  });
});

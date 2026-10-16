/**
 * The contribution machinery itself, at two levels.
 *
 * The PURE half needs no I/O: `validateCliCommands` over synthetic per-package tables
 * (malformed entries and a package's own duplicates drop out, reserved roots and a foreign
 * closed subtree are refused, a foreign OPEN subtree stays, and the same key from two
 * packages survives as ambiguous), and the argv matching (`keyMatches` prefix semantics,
 * package grouping).
 *
 * The INTEGRATION half drives the real `cli()` over fixture plugin packages in a temp
 * data root (the same shape the server's plugin tests use: a package.json, a generated
 * ifaces.json carrying the `cli.commands` contribution, and an entry exporting
 * `registerCliCommands`), listed by absolute path in a Project's config — the
 * dev-checkout form of plugin listing:
 *
 *   - a unique hit executes the contributing package's code half, exit 0;
 *   - a prefix overlap across two packages is the ambiguity report — one `penguin exec`
 *     line per candidate, the closing note, exit code 2 — and nothing runs;
 *   - the server package's open `server.*` subtree admits a plugin's `server.health`
 *     registration, and the invocation reports the two-package ambiguity it creates;
 *   - a reserved root and the server package's closed `web` subtree refuse a
 *     registration: ignored by dispatch, listed for review;
 *   - `--help` lists every discovered command with its summary, and none of the code
 *     halves have run to produce it.
 *
 * The server package's manifest subpath imports resolve through its built dist, the same
 * way `penguin auth`'s imports already do in this suite (see version.test.ts).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliCommandEntry } from "@prismshadow/penguin-core/plugin";
import { cli } from "../src/index.js";
import {
  keyMatches,
  matchingCommands,
  matchingPackages,
  validateCliCommands,
  discoverCliCommands,
  type CliDiscovered,
} from "../src/contributions.js";

// ——————————————————————————————— pure half ———————————————————————————————

/** One valid entry, the short way. */
function entry(key: string, id = key, subtree?: "open"): CliCommandEntry {
  return {
    id,
    key,
    summary: { en: `${key} (en)`, zh: `${key} (zh)` },
    ...(subtree === undefined ? {} : { subtree }),
  };
}

describe("validateCliCommands (ownership rules, no I/O)", () => {
  it("keeps well-formed registrations, in package order", () => {
    const result = validateCliCommands(
      new Map([
        ["@a/one", [entry("deploy"), entry("deploy.list")]],
        ["@a/two", [entry("audit")]],
      ]),
    );
    expect(result.commands.map((c) => [c.pkg, c.entry.key])).toEqual([
      ["@a/one", "deploy"],
      ["@a/one", "deploy.list"],
      ["@a/two", "audit"],
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("drops malformed entries, saying what is wrong with them", () => {
    const result = validateCliCommands(
      new Map([
        [
          "@a/bad",
          [
            { id: "no-key", summary: { en: "x", zh: "x" } } as unknown as CliCommandEntry,
            { id: "bad-key", key: "Not Lower", summary: { en: "x", zh: "x" } } as CliCommandEntry,
            { id: "no-summary", key: "quiet" } as unknown as CliCommandEntry,
          ],
        ],
      ]),
    );
    expect(result.commands).toEqual([]);
    expect(result.invalid).toHaveLength(3);
    for (const reg of result.invalid) expect(reg.reason.kind).toBe("malformed");
  });

  it("a package registering one key twice drops BOTH copies (exec on that package stays unambiguous)", () => {
    const result = validateCliCommands(
      new Map([["@a/dup", [entry("twice", "first"), entry("twice", "second")]]]),
    );
    expect(result.commands).toEqual([]);
    expect(result.invalid.map((r) => [r.id, r.reason.kind])).toEqual([
      ["first", "duplicate"],
      ["second", "duplicate"],
    ]);
  });

  it("refuses the host's reserved roots, naming the segment", () => {
    const result = validateCliCommands(
      new Map([["@a/greedy", [entry("update.fast"), entry("plugin"), entry("auth.grant")]]]),
    );
    expect(result.commands).toEqual([]);
    expect(result.invalid.map((r) => r.reason)).toEqual([
      { kind: "reserved", root: "update" },
      { kind: "reserved", root: "plugin" },
      { kind: "reserved", root: "auth" },
    ]);
  });

  it("refuses another package's subtree unless the owner declared it open", () => {
    const closed = validateCliCommands(
      new Map([
        ["@a/owner", [entry("owned")]],
        ["@a/other", [entry("owned.under")]],
      ]),
    );
    expect(closed.commands.map((c) => c.entry.key)).toEqual(["owned"]);
    expect(closed.invalid.map((r) => r.reason)).toEqual([
      { kind: "foreign-subtree", prefix: "owned", owner: "@a/owner" },
    ]);

    const open = validateCliCommands(
      new Map<string, CliCommandEntry[]>([
        ["@a/owner", [entry("owned", "owned", "open")]],
        ["@a/other", [entry("owned.under")]],
      ]),
    );
    expect(open.commands.map((c) => c.entry.key)).toEqual(["owned", "owned.under"]);
    expect(open.invalid).toEqual([]);
  });

  it("the same key from two packages stays valid — and is listed as ambiguous", () => {
    const result = validateCliCommands(
      new Map([
        ["@a/one", [entry("greet")]],
        ["@a/two", [entry("greet")]],
      ]),
    );
    expect(result.commands).toHaveLength(2);
    expect(result.invalid).toEqual([]);
    expect(result.ambiguous).toEqual(["greet"]);
  });
});

describe("argv matching (a key is a prefix of argv; packages group the hits)", () => {
  const commands: CliDiscovered[] = [
    { pkg: "@a/one", entry: entry("deploy") },
    { pkg: "@a/one", entry: entry("deploy.list") },
    { pkg: "@a/two", entry: entry("deploy") },
  ];
  it("a key matches when its segments are argv's leading segments", () => {
    expect(keyMatches("deploy", ["deploy", "--x"])).toBe(true);
    expect(keyMatches("deploy.list", ["deploy", "list"])).toBe(true);
    expect(keyMatches("deploy.list", ["deploy"])).toBe(false); // argv too short
    expect(keyMatches("deploy", ["deployed"])).toBe(false); // a longer word is not the segment
  });
  it("matchingCommands returns every hit, matchingPackages the distinct packages", () => {
    expect(matchingCommands(commands, ["deploy", "list"]).map((m) => m.entry.key)).toEqual([
      "deploy",
      "deploy.list",
      "deploy",
    ]);
    expect(matchingPackages(matchingCommands(commands, ["deploy", "list"]))).toEqual([
      "@a/one",
      "@a/two",
    ]);
    expect(matchingPackages(matchingCommands(commands, ["deploy"]))).toEqual(["@a/one", "@a/two"]);
  });
});

// ——————————————————————————————— integration half ———————————————————————————————

/** Collects what `body` writes to stdout AND stderr, alongside whatever it returns. */
async function captureBoth<T>(
  body: () => Promise<T>,
): Promise<{ out: string; err: string; result: T }> {
  const written: string[] = [];
  const errors: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    errors.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await body();
    return { out: written.join(""), err: errors.join(""), result };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

/** One fixture plugin package: manifest table with `cli.commands`, entry with the code half. */
interface FixturePlugin {
  /** The npm name on the package (the display identity). */
  name: string;
  /** The `cli.commands` data half, raw (malformed entries included, as review sees them). */
  contributes: unknown[];
  /** The entry's code: `registerCliCommands` (plain JS — the code half needs no decorators). */
  register: string;
  /** Skill files to write under `skills/`, relative path → text. */
  skills?: Record<string, string>;
}

/** Writes one fixture plugin package and returns its entry file (the specifier used in config). */
async function writePlugin(dir: string, plugin: FixturePlugin): Promise<string> {
  const pkgDir = path.join(dir, "pkgs", ...plugin.name.split("/"));
  const entry = path.join(pkgDir, "index.mjs");
  await fs.promises.mkdir(pkgDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: plugin.name, type: "module", main: "./index.mjs" }),
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(pkgDir, "ifaces.json"),
    JSON.stringify({
      ifaces: {},
      types: {},
      modules: {
        [`${plugin.name}#Main`]: {
          name: `${plugin.name}#Main`,
          requires: {},
          provides: {},
          contributes: { "cli.commands": plugin.contributes },
          children: [],
        },
      },
      plugin: { modules: [`${plugin.name}#Main`], replaces: [] },
    }),
    "utf8",
  );
  await fs.promises.writeFile(
    entry,
    `export function registerCliCommands(program, ctx) {\n${plugin.register}\n}\nexport default { modules: [] };\n`,
    "utf8",
  );
  for (const [rel, text] of Object.entries(plugin.skills ?? {})) {
    const file = path.join(pkgDir, rel);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, text, "utf8");
  }
  return entry;
}

/** A data root with one Project listing the given fixture plugins (by absolute entry path). */
async function writeRoot(plugins: FixturePlugin[]): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penguin-contrib-"));
  const specifiers: string[] = [];
  for (const plugin of plugins) specifiers.push(await writePlugin(root, plugin));
  const project = path.join(root, "p1");
  await fs.promises.mkdir(project, { recursive: true });
  await fs.promises.writeFile(
    path.join(project, ".project_config.toml"),
    `models = []\n[plugins]\n${specifiers.map((s) => `${JSON.stringify(s)} = "*"`).join("\n")}\n`,
    "utf8",
  );
  return root;
}

/** One plugin command's code half: a command named by its key, whose action writes its marker. */
const writes = (key: string, marker: string): string =>
  `program.command(${JSON.stringify(key)}).description(${JSON.stringify(marker)}).action(() => { ctx.write(${JSON.stringify(marker)}); });`;

const savedHome = process.env.PENGUIN_HOME;
afterEach(() => {
  if (savedHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = savedHome;
});

describe("the host over fixture plugins (cli() end to end)", () => {
  let root: string | undefined;

  it("a unique hit executes the contributing package's code half, exit 0", async () => {
    root = await writeRoot([
      {
        name: "@acme/one",
        contributes: [entry("deploy")],
        register: writes("deploy", "deployed by one"),
      },
    ]);
    process.env.PENGUIN_HOME = root;
    const { out, result } = await captureBoth(() => cli(["deploy"]));
    expect(result).toBe(0);
    expect(out).toContain("deployed by one");
  });

  it("a prefix overlap across packages reports ambiguity: exec lines, the note, exit 2, nothing runs", async () => {
    root = await writeRoot([
      {
        name: "@acme/greet",
        contributes: [entry("greet", "greet", "open")],
        register: writes("greet", "greeted by greet"),
      },
      {
        name: "@acme/world",
        contributes: [entry("greet.world")],
        register: `program.command("greet").command("world").action(() => { ctx.write("worlded by world"); });`,
      },
    ]);
    process.env.PENGUIN_HOME = root;
    const { out, err, result } = await captureBoth(() => cli(["greet", "world"]));
    expect(result).toBe(2);
    // The report goes to stderr, and neither code half executed anything.
    expect(out).not.toContain("greeted");
    expect(out).not.toContain("worlded");
    expect(err).toContain("Ambiguous command: 'greet world' matches commands from 2 packages");
    expect(err).toContain(`penguin exec @acme/greet greet world`);
    expect(err).toContain(`penguin exec @acme/world greet world`);
    expect(err).toContain("Note:");
  });

  it("the server package's open server.* subtree admits a plugin registration — and the shared prefix is the ambiguity the invocation reports", async () => {
    root = await writeRoot([
      {
        name: "@acme/health",
        contributes: [entry("server.health")],
        register: `program.command("server").command("health").action(() => { ctx.write("health by plugin"); });`,
      },
    ]);
    process.env.PENGUIN_HOME = root;
    // The registration is valid: present among the commands, refused by nothing.
    const discovery = await discoverCliCommands({ root });
    expect(discovery.commands.find((c) => c.entry.key === "server.health")?.pkg).toBe(
      "@acme/health",
    );
    expect(discovery.invalid).toEqual([]);
    // Dispatching `penguin server health` matches the server package's own `server` key and
    // the plugin's `server.health`: two packages, so the report says which exec line to run.
    const { err, result } = await captureBoth(() => cli(["server", "health"]));
    expect(result).toBe(2);
    expect(err).toContain("penguin exec @acme/health server health");
  });

  it("a reserved root and the server package's closed web subtree are refused: ignored by dispatch, listed for review", async () => {
    root = await writeRoot([
      {
        name: "@acme/bad",
        contributes: [entry("update.fast"), entry("web.extra"), entry("deploy")],
        register: writes("deploy", "deployed by bad"),
      },
    ]);
    process.env.PENGUIN_HOME = root;
    const discovery = await discoverCliCommands({ root });
    // The valid one dispatches; the refused ones reach neither help nor dispatch.
    expect(discovery.commands.map((c) => [c.pkg, c.entry.key])).toContainEqual([
      "@acme/bad",
      "deploy",
    ]);
    expect(discovery.commands.map((c) => c.entry.key)).not.toContain("update.fast");
    expect(discovery.commands.map((c) => c.entry.key)).not.toContain("web.extra");
    expect(discovery.invalid.map((r) => [r.key, r.reason.kind])).toEqual([
      ["update.fast", "reserved"],
      ["web.extra", "foreign-subtree"],
    ]);
    const { out, err, result } = await captureBoth(() => cli(["update", "fast"]));
    // `update` is the host's own command: the fixture's code never runs.
    expect(result).toBe(1);
    expect(out).not.toContain("by bad");
    expect(err).not.toContain("by bad");
  });

  it("--help lists every discovered command from the data halves alone", async () => {
    root = await writeRoot([
      {
        name: "@acme/one",
        contributes: [entry("deploy")],
        register: writes("deploy", "deployed by one"),
      },
    ]);
    process.env.PENGUIN_HOME = root;
    const { out, result } = await captureBoth(() => cli(["--help"]));
    expect(result).toBe(0);
    // Own commands, the server package's serve group, the fixture's — all in one listing.
    expect(out).toContain("config");
    expect(out).toContain("session");
    expect(out).toContain("benchmark");
    expect(out).toContain("server");
    expect(out).toContain("web");
    expect(out).toContain("deploy (en)");
    // The data half's summary, not the code half's output: no register ran for this help.
    expect(out).not.toContain("deployed by one");
  });

  it("the same key from two packages stays registered and dispatches as ambiguous", async () => {
    root = await writeRoot([
      {
        name: "@acme/one",
        contributes: [entry("greet")],
        register: writes("greet", "greet by one"),
      },
      {
        name: "@acme/two",
        contributes: [entry("greet")],
        register: writes("greet", "greet by two"),
      },
    ]);
    process.env.PENGUIN_HOME = root;
    const discovery = await discoverCliCommands({ root });
    expect(discovery.ambiguous).toEqual(["greet"]);
    const { err, result } = await captureBoth(() => cli(["greet"]));
    expect(result).toBe(2);
    expect(err).toContain("penguin exec @acme/one greet");
    expect(err).toContain("penguin exec @acme/two greet");
  });

  it("penguin exec names the package and runs its command without ambiguity", async () => {
    root = await writeRoot([
      {
        name: "@acme/one",
        contributes: [entry("deploy")],
        register: `program.command("deploy").description("deploys").action(() => { ctx.write("deployed via exec"); });`,
      },
    ]);
    process.env.PENGUIN_HOME = root;
    const { out, result } = await captureBoth(() => cli(["exec", "one", "deploy"]));
    expect(result).toBe(0);
    expect(out).toContain("deployed via exec");
  });

  afterEach(async () => {
    if (root !== undefined) await fs.promises.rm(root, { recursive: true, force: true });
    root = undefined;
  });
});

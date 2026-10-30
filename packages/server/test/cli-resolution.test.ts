/**
 * Resolution: the names it answers with, the RFC's ten cases as one table, the declaration
 * a product carries, and the record reader agreeing with the hot-update layer's own.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPushedCli } from "@prismshadow/penguin-hmr/manifest";
import {
  CLI_FAULTS,
  CLI_REASONS,
  LEGACY_LOADER_NAME,
  resolveCli,
  shimFromResolution,
  type CliResolution,
} from "../src/services/cli-shim.js";

const made: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** A product on disk: its manifest, its CLI entry, its loader beside it. */
interface Product {
  dir: string;
  entry: string;
  loader: string;
}

async function makeProduct(
  options: { declare?: string | false; loader?: boolean } = {},
): Promise<Product> {
  const dir = await tmp("penguin-resolution-product-");
  const dist = path.join(dir, "dist");
  await fs.mkdir(dist, { recursive: true });
  const entry = path.join(dist, "penguin.js");
  const loader = path.join(dist, LEGACY_LOADER_NAME);
  await fs.writeFile(entry, "export const cli = async () => 0;\n");
  if (options.loader !== false) await fs.writeFile(loader, "export const cli = async () => 0;\n");
  const manifest: Record<string, unknown> = { name: "fixture-cli", version: "0.0.0" };
  if (options.declare !== false) {
    manifest.penguin = { cliLoader: options.declare ?? `./dist/${LEGACY_LOADER_NAME}` };
  }
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return { dir, entry, loader };
}

/** A data root: an optional record, and whether the store still holds the CLI it names. */
async function makeRoot(
  options: { record?: unknown; raw?: string; bundle?: boolean } = {},
): Promise<{ root: string; bundle: string }> {
  const root = await tmp("penguin-resolution-root-");
  const bundle = path.join(root, "hmr", "store", "cli", "abc123.mjs");
  if (options.bundle !== false) {
    await fs.mkdir(path.dirname(bundle), { recursive: true });
    await fs.writeFile(bundle, "export const cli = async () => 0;\n");
  }
  if (options.raw !== undefined) {
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), options.raw);
  } else if (options.record !== undefined) {
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), JSON.stringify(options.record));
  }
  return { root, bundle };
}

/** The record a pushed CLI leaves: the store file the caller creates, named relatively. */
const RECORD_WITH_CLI = { cli: { bundle: "store/cli/abc123.mjs" } };

/** One row of the RFC's table: how to build the world, and what the answer must be. */
interface Case {
  name: string;
  product: () => Promise<Product>;
  root: () => Promise<{ root: string; bundle: string }>;
  /** The caller's entry; default the product's entry. */
  callerEntry?: (product: Product) => string;
  /** The entry the answer must name, when it names one. */
  entry?: (product: Product, callerEntry: string) => string;
  /** The pushed bundle the answer must carry, when it carries one. */
  bundle?: (bundle: string) => string;
  expect: Partial<CliResolution>;
}

describe("the names an answer is made of", () => {
  it("is the four faults and the three reasons, verbatim and in the RFC's order", () => {
    expect([...CLI_FAULTS]).toEqual([
      "record-unreadable",
      "declared-loader-missing",
      "no-loader",
      "cli-unloadable",
    ]);
    expect([...CLI_REASONS]).toEqual(["declared-loader", "legacy-loader", "own-entry"]);
  });
});

describe("the RFC's eight cases", () => {
  const cases: Case[] = [
    {
      name: "1. record and a declared loader present → the loader, `declared-loader`",
      product: () => makeProduct(),
      root: () => makeRoot({ record: RECORD_WITH_CLI }),
      entry: (product) => product.loader,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "declared-loader" },
    },
    {
      name: "2. record and a declared loader absent → fault `declared-loader-missing`",
      product: () => makeProduct({ loader: false }),
      root: () => makeRoot({ record: RECORD_WITH_CLI }),
      expect: { kind: "fault", fault: "declared-loader-missing" },
    },
    {
      name: "3. record, no declaration, the legacy loader present → `legacy-loader`",
      product: () => makeProduct({ declare: false }),
      root: () => makeRoot({ record: RECORD_WITH_CLI }),
      entry: (product) => product.loader,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "legacy-loader" },
    },
    {
      name: "4. record, no declaration and no legacy loader → fault `no-loader`",
      product: () => makeProduct({ declare: false, loader: false }),
      root: () => makeRoot({ record: RECORD_WITH_CLI }),
      expect: { kind: "fault", fault: "no-loader" },
    },
    {
      name: "5. a record with no CLI section → the caller's entry, `own-entry`",
      product: () => makeProduct(),
      root: () => makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } }),
      entry: (_product, callerEntry) => callerEntry,
      expect: { kind: "entry", reason: "own-entry" },
    },
    {
      name: "6. no record → the caller's entry, `own-entry`",
      product: () => makeProduct(),
      root: () => makeRoot(),
      entry: (_product, callerEntry) => callerEntry,
      expect: { kind: "entry", reason: "own-entry" },
    },
    {
      name: "7. a record that cannot be used → fault `record-unreadable`",
      product: () => makeProduct(),
      root: () => makeRoot({ raw: "{ not json" }),
      expect: { kind: "fault", fault: "record-unreadable" },
    },
    {
      name: "8. the caller is the declared loader → itself, `declared-loader`, loading the pushed bundle",
      product: () => makeProduct(),
      root: () => makeRoot({ record: RECORD_WITH_CLI }),
      callerEntry: (product) => product.loader,
      entry: (_product, callerEntry) => callerEntry,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "declared-loader" },
    },
    {
      name: "8b. the caller is a legacy loader of a product that declares nothing → `legacy-loader`",
      product: () => makeProduct({ declare: false }),
      root: () => makeRoot({ record: RECORD_WITH_CLI }),
      callerEntry: (product) => product.loader,
      entry: (_product, callerEntry) => callerEntry,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "legacy-loader" },
    },
  ];

  it("answers each case with its entry and reason, or its named fault", async () => {
    for (const item of cases) {
      const product = await item.product();
      const { root, bundle } = await item.root();
      const callerEntry = item.callerEntry?.(product) ?? product.entry;
      const resolved = await resolveCli({ callerEntry, root });
      expect({ name: item.name, ...resolved }).toMatchObject(item.expect);
      if (resolved.kind === "entry") {
        // The entry it names, and the pushed bundle it carries (none when nothing is pushed).
        expect({
          name: item.name,
          entry: resolved.entry,
          bundle: resolved.bundle,
        }).toEqual({
          name: item.name,
          entry: item.entry?.(product, callerEntry) ?? callerEntry,
          bundle: item.bundle?.(bundle) ?? null,
        });
      }
    }
  });

  it("keeps a declaration that names no loader from falling back to the legacy name", async () => {
    const product = await makeProduct({ declare: "   " });
    const { root } = await makeRoot({ record: RECORD_WITH_CLI });
    await expect(resolveCli({ callerEntry: product.entry, root })).resolves.toMatchObject({
      kind: "fault",
      fault: "no-loader",
    });
  });
});

describe("the declaration a product carries", () => {
  it("is found through a bin symlink, and a product that declares nothing inherits nothing", async () => {
    const product = await makeProduct();
    const bin = path.join(product.dir, "node_modules", ".bin", "penguin");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.symlink(product.entry, bin);
    const { root } = await makeRoot({ record: RECORD_WITH_CLI });
    await expect(resolveCli({ callerEntry: bin, root })).resolves.toMatchObject({
      kind: "entry",
      entry: product.loader,
      reason: "declared-loader",
    });

    // A package nested inside a declaring product, with its own manifest that declares nothing:
    // discovery stops there, so the outer declaration never answers for it.
    const inner = path.join(product.dir, "vendor", "app");
    await fs.mkdir(inner, { recursive: true });
    await fs.writeFile(path.join(inner, "penguin.js"), "export const cli = async () => 0;\n");
    await fs.writeFile(path.join(inner, "package.json"), JSON.stringify({ name: "inner" }));
    await expect(
      resolveCli({ callerEntry: path.join(inner, "penguin.js"), root }),
    ).resolves.toMatchObject({
      kind: "fault",
      fault: "no-loader",
    });
  });
});

describe("the record reader and the layer's own", () => {
  it("agrees with `readPushedCli` on a pushed bundle and on nothing pushed", async () => {
    const shapes: Array<{
      name: string;
      root: () => Promise<{ root: string }>;
      /** What the layer answers; where it says broken, resolution's answer is named too. */
      layer: "none" | "bundle" | "broken";
      expect: Partial<CliResolution>;
    }> = [
      {
        name: "no record",
        root: () => makeRoot(),
        layer: "none",
        expect: { kind: "entry", reason: "own-entry" },
      },
      {
        name: "no CLI section",
        root: () => makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } }),
        layer: "none",
        expect: { kind: "entry", reason: "own-entry" },
      },
      {
        name: "a cli entry with no bundle path",
        root: () => makeRoot({ record: { cli: {} } }),
        layer: "broken",
        expect: { kind: "entry", reason: "own-entry" },
      },
      {
        name: "missing file",
        root: () => makeRoot({ record: RECORD_WITH_CLI, bundle: false }),
        layer: "broken",
        expect: { kind: "entry", reason: "own-entry" },
      },
      {
        name: "pushed bundle",
        root: () => makeRoot({ record: RECORD_WITH_CLI }),
        layer: "bundle",
        expect: { kind: "entry", reason: "declared-loader" },
      },
    ];
    for (const shape of shapes) {
      const product = await makeProduct();
      const { root, bundle } = await shape.root();
      const layer = await readPushedCli(root);
      const resolved = await resolveCli({ callerEntry: product.entry, root });
      expect({ name: shape.name, layer: layer.kind }).toEqual({
        name: shape.name,
        layer: shape.layer,
      });
      expect({ name: shape.name, ...resolved }).toMatchObject(shape.expect);
      if (shape.layer === "bundle" && resolved.kind === "entry") {
        // The pushed bundle the layer holds is the one the answer carries.
        expect(resolved.bundle).toBe(bundle);
      }
    }
  });

  it("answers a record it cannot read or parse with the fault `record-unreadable`", async () => {
    const product = await makeProduct();
    const { root } = await makeRoot({ raw: "{ not json" });
    // The layer merges this into `broken` too; the resolver keeps the name, so the Machines
    // page can say more than "nothing was ever pushed".
    expect((await readPushedCli(root)).kind).toBe("broken");
    await expect(resolveCli({ callerEntry: product.entry, root })).resolves.toMatchObject({
      kind: "fault",
      fault: "record-unreadable",
    });
  });
});

describe("the command shim on the answer", () => {
  it("runs the loader of a pushed root, and the server's own entry with the name on a fault", async () => {
    const own = {
      entry: "/install/penguin.js",
      execArgs: ["--import", "tsx"],
      unavailable: null,
    };

    const product = await makeProduct();
    const { root } = await makeRoot({ record: RECORD_WITH_CLI });
    await expect(
      resolveCli({ callerEntry: product.entry, root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: product.loader,
      execArgs: [],
      unavailable: null,
      answerName: "declared-loader",
    });

    const gone = await makeProduct({ loader: false });
    await expect(
      resolveCli({ callerEntry: gone.entry, root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: own.entry,
      execArgs: own.execArgs,
      unavailable: null,
      answerName: "declared-loader-missing",
    });

    expect(shimFromResolution(own, null)).toMatchObject({ answerName: "no-entry" });
  });
});

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

/** A product on disk: its manifest, its installed CLI entry, its loader beside it. */
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
    manifest.penguin = { pushedCliLoader: options.declare ?? `./dist/${LEGACY_LOADER_NAME}` };
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
const PUSHED = { cli: { bundle: "store/cli/abc123.mjs" } };

/** One row of the RFC's table: how to build the world, and what the answer must be. */
interface Case {
  name: string;
  product: () => Promise<Product>;
  root: () => Promise<{ root: string; bundle: string }>;
  /** The caller's entry; default the product's installed entry. */
  self?: (product: Product) => string;
  /** The entry the answer must name, when it names one. */
  entry?: (product: Product, self: string) => string;
  /** The pushed bundle the answer must carry, when it carries one. */
  bundle?: (bundle: string) => string;
  expect: Partial<CliResolution>;
}

describe("the names an answer is made of", () => {
  it("is the six faults and the four reasons, verbatim and in the RFC's order", () => {
    expect([...CLI_FAULTS]).toEqual([
      "damaged-record",
      "cli-pointer-unusable",
      "cli-bundle-missing",
      "loader-missing",
      "loader-absent",
      "loader-unloadable",
    ]);
    expect([...CLI_REASONS]).toEqual(["pushed", "legacy", "no-record", "no-pushed-cli"]);
  });
});

describe("the RFC's ten cases", () => {
  const cases: Case[] = [
    {
      name: "1. record and a declared loader present → the loader, `pushed`",
      product: () => makeProduct(),
      root: () => makeRoot({ record: PUSHED }),
      entry: (product) => product.loader,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "pushed" },
    },
    {
      name: "2. record and a declared loader absent → fault `loader-missing`",
      product: () => makeProduct({ loader: false }),
      root: () => makeRoot({ record: PUSHED }),
      expect: { kind: "fault", fault: "loader-missing" },
    },
    {
      name: "3. record, no declaration, the legacy loader present → `legacy`",
      product: () => makeProduct({ declare: false }),
      root: () => makeRoot({ record: PUSHED }),
      entry: (product) => product.loader,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "legacy" },
    },
    {
      name: "4. record, no declaration and no legacy loader → fault `loader-absent`",
      product: () => makeProduct({ declare: false, loader: false }),
      root: () => makeRoot({ record: PUSHED }),
      expect: { kind: "fault", fault: "loader-absent" },
    },
    {
      name: "5. the pointer's file is gone from the store → fault `cli-bundle-missing`",
      product: () => makeProduct(),
      root: () => makeRoot({ record: PUSHED, bundle: false }),
      expect: { kind: "fault", fault: "cli-bundle-missing" },
    },
    {
      name: "6. an unusable pointer → fault `cli-pointer-unusable`",
      product: () => makeProduct(),
      root: () => makeRoot({ record: { cli: { bundle: "../escaped.mjs" } } }),
      expect: { kind: "fault", fault: "cli-pointer-unusable" },
    },
    {
      name: "7. a record with no CLI section → the caller's entry, `no-pushed-cli`",
      product: () => makeProduct(),
      root: () => makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } }),
      entry: (_product, self) => self,
      expect: { kind: "entry", reason: "no-pushed-cli" },
    },
    {
      name: "8. no record → the caller's entry, `no-record`",
      product: () => makeProduct(),
      root: () => makeRoot(),
      entry: (_product, self) => self,
      expect: { kind: "entry", reason: "no-record" },
    },
    {
      name: "9. a damaged record → fault `damaged-record`",
      product: () => makeProduct(),
      root: () => makeRoot({ raw: "{ not json" }),
      expect: { kind: "fault", fault: "damaged-record" },
    },
    {
      name: "10. the caller is the declared loader → itself, `pushed`, loading the pushed bundle",
      product: () => makeProduct(),
      root: () => makeRoot({ record: PUSHED }),
      self: (product) => product.loader,
      entry: (_product, self) => self,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "pushed" },
    },
    {
      name: "10b. the caller is a legacy loader of a product that declares nothing → `legacy`",
      product: () => makeProduct({ declare: false }),
      root: () => makeRoot({ record: PUSHED }),
      self: (product) => product.loader,
      entry: (_product, self) => self,
      bundle: (bundle) => bundle,
      expect: { kind: "entry", reason: "legacy" },
    },
  ];

  it("answers each case with its entry and reason, or its named fault", async () => {
    for (const item of cases) {
      const product = await item.product();
      const { root, bundle } = await item.root();
      const self = item.self?.(product) ?? product.entry;
      const resolved = await resolveCli({ self, root });
      expect({ name: item.name, ...resolved }).toMatchObject(item.expect);
      if (resolved.kind === "entry") {
        // The entry it names, and the pushed bundle it carries (none when nothing is pushed).
        expect({
          name: item.name,
          entry: resolved.entry,
          bundle: resolved.bundle,
        }).toEqual({
          name: item.name,
          entry: item.entry?.(product, self) ?? self,
          bundle: item.bundle?.(bundle) ?? null,
        });
      }
    }
  });

  it("keeps a broken declaration from falling back to the legacy name", async () => {
    const product = await makeProduct({ declare: "../elsewhere/penguin-hmr.js" });
    const { root } = await makeRoot({ record: PUSHED });
    await expect(resolveCli({ self: product.entry, root })).resolves.toMatchObject({
      kind: "fault",
      fault: "loader-missing",
    });
  });
});

describe("the declaration a product carries", () => {
  it("is found through a bin symlink, and a product that declares nothing inherits nothing", async () => {
    const product = await makeProduct();
    const bin = path.join(product.dir, "node_modules", ".bin", "penguin");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.symlink(product.entry, bin);
    const { root } = await makeRoot({ record: PUSHED });
    await expect(resolveCli({ self: bin, root })).resolves.toMatchObject({
      kind: "entry",
      entry: product.loader,
      reason: "pushed",
    });

    // A package nested inside a declaring product, with its own manifest that declares nothing:
    // discovery stops there, so the outer declaration never answers for it.
    const inner = path.join(product.dir, "vendor", "app");
    await fs.mkdir(inner, { recursive: true });
    await fs.writeFile(path.join(inner, "penguin.js"), "export const cli = async () => 0;\n");
    await fs.writeFile(path.join(inner, "package.json"), JSON.stringify({ name: "inner" }));
    await expect(resolveCli({ self: path.join(inner, "penguin.js"), root })).resolves.toMatchObject(
      {
        kind: "fault",
        fault: "loader-absent",
      },
    );
  });
});

describe("the record reader and the layer's own", () => {
  it("agrees with `readPushedCli` wherever that reader answers", async () => {
    const shapes: Array<{ name: string; root: () => Promise<{ root: string }> }> = [
      { name: "no record", root: () => makeRoot() },
      {
        name: "no CLI section",
        root: () => makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } }),
      },
      { name: "damaged record", root: () => makeRoot({ raw: "{ not json" }) },
      { name: "unusable pointer", root: () => makeRoot({ record: { cli: {} } }) },
      { name: "missing bundle", root: () => makeRoot({ record: PUSHED, bundle: false }) },
      { name: "pushed bundle", root: () => makeRoot({ record: PUSHED }) },
    ];
    for (const shape of shapes) {
      const product = await makeProduct();
      const { root } = await shape.root();
      const layer = await readPushedCli(root);
      const resolved = await resolveCli({ self: product.entry, root });
      const read = { name: shape.name, layer: layer.kind, resolved };
      if (layer.kind === "bundle") {
        expect(read).toMatchObject({ resolved: { kind: "entry", bundle: layer.file } });
      } else if (layer.kind === "none") {
        // The layer's one "nothing pushed" is resolution's two: both are that answer here.
        expect(["no-record", "no-pushed-cli"]).toContain(
          resolved.kind === "entry" ? resolved.reason : null,
        );
      } else {
        expect(read).toMatchObject({ resolved: { kind: "fault" } });
      }
    }
  });
});

describe("the command shim on the answer", () => {
  it("runs the loader of a pushed root, and the installed CLI with the name on a fault", async () => {
    const installed = {
      entry: "/install/penguin.js",
      execArgs: ["--import", "tsx"],
      unavailable: null,
    };

    const product = await makeProduct();
    const { root } = await makeRoot({ record: PUSHED });
    await expect(
      resolveCli({ self: product.entry, root }).then((resolved) =>
        shimFromResolution(installed, resolved),
      ),
    ).resolves.toEqual({
      entry: product.loader,
      execArgs: [],
      unavailable: null,
      answer: "pushed",
    });

    const gone = await makeProduct({ loader: false });
    await expect(
      resolveCli({ self: gone.entry, root }).then((resolved) =>
        shimFromResolution(installed, resolved),
      ),
    ).resolves.toEqual({
      entry: installed.entry,
      execArgs: installed.execArgs,
      unavailable: null,
      answer: "loader-missing",
    });

    expect(shimFromResolution(installed, null)).toMatchObject({ answer: "no-entry" });
  });
});

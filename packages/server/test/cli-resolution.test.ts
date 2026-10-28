/**
 * CLI resolution: the ten cases of the RFC's table, one test each; the six fault names and
 * four reason names verbatim; the five record states the answer depends on; and the three
 * answers a product's manifest declaration can give.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPushedCli, type PushedCli } from "@prismshadow/penguin-hmr/manifest";
import {
  answerForRecordState,
  CLI_FAULTS,
  CLI_REASONS,
  CONSUMER_CONDITIONS,
  LEGACY_LOADER_NAME,
  loaderDeclarationFor,
  readCliRecord,
  readLoaderDeclaration,
  recordStateDetail,
  resolveCli,
} from "../src/cli-resolution.js";

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
  /** Where the loader lands when the manifest declares one (and when it ships one undeclared). */
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
  const manifest: Record<string, unknown> = {
    name: "fixture-cli",
    version: "0.0.0",
    bin: { penguin: "./dist/penguin.js" },
  };
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

describe("the names an answer is made of", () => {
  it("is the six fault names, verbatim and in the RFC's order", () => {
    expect([...CLI_FAULTS]).toEqual([
      "damaged-record",
      "cli-pointer-unusable",
      "cli-bundle-missing",
      "loader-missing",
      "loader-absent",
      "loader-unloadable",
    ]);
  });

  it("is the four reason names, verbatim and in the RFC's order", () => {
    expect([...CLI_REASONS]).toEqual(["pushed", "legacy", "no-record", "no-pushed-cli"]);
  });

  it("names the two consumer conditions beyond the decision order", () => {
    expect([...CONSUMER_CONDITIONS]).toEqual(["loader-unloadable", "entry-not-respawnable"]);
  });
});

describe("the record's five states, each read on its own", () => {
  it("`none`: no record at all", async () => {
    const { root } = await makeRoot();
    await expect(readCliRecord(root)).resolves.toEqual({ kind: "none" });
  });

  it("`damaged`: a record that will not parse", async () => {
    const { root } = await makeRoot({ raw: "{ not json" });
    const read = await readCliRecord(root);
    expect(read.kind).toBe("damaged");
    expect(read.kind === "damaged" && read.reason).toMatch(/not readable JSON/);
  });

  it("`damaged`: a record that holds no JSON object", async () => {
    const { root } = await makeRoot({ raw: "null" });
    await expect(readCliRecord(root)).resolves.toMatchObject({ kind: "damaged" });
  });

  it("`absent`: a record with no CLI section", async () => {
    const { root } = await makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } });
    await expect(readCliRecord(root)).resolves.toEqual({ kind: "absent" });
  });

  it("`unusable`: a CLI section with no pointer, an empty one, or one outside the store", async () => {
    for (const cli of [{}, { bundle: "" }, { bundle: 42 }, { bundle: "../escaped.mjs" }]) {
      const { root } = await makeRoot({ record: { cli } });
      await expect(readCliRecord(root)).resolves.toMatchObject({ kind: "unusable" });
    }
  });

  it("`missing`: a pointer the store no longer holds", async () => {
    const { root, bundle } = await makeRoot({ record: PUSHED, bundle: false });
    await expect(readCliRecord(root)).resolves.toEqual({ kind: "missing", file: bundle });
  });

  it("`bundle`: a pointer the store holds", async () => {
    const { root, bundle } = await makeRoot({ record: PUSHED });
    await expect(readCliRecord(root)).resolves.toEqual({ kind: "bundle", file: bundle });
  });
});

describe("the declaration a product carries in its manifest", () => {
  it("is `declared`, resolved against the manifest's directory", async () => {
    const product = await makeProduct();
    const read = await readLoaderDeclaration(path.join(product.dir, "package.json"));
    expect(read).toEqual({
      kind: "declared",
      declaration: {
        file: product.loader,
        manifest: path.join(product.dir, "package.json"),
      },
    });
  });

  it("is `absent` for a manifest with no declaration, and for no manifest at all", async () => {
    const product = await makeProduct({ declare: false });
    await expect(readLoaderDeclaration(path.join(product.dir, "package.json"))).resolves.toEqual({
      kind: "absent",
      manifest: path.join(product.dir, "package.json"),
    });
    await expect(readLoaderDeclaration(path.join(product.dir, "nope.json"))).resolves.toEqual({
      kind: "absent",
      manifest: null,
    });
  });

  it("is `broken` for a declaration that names no usable file", async () => {
    const product = await makeProduct({ declare: 42 as unknown as string });
    await expect(
      readLoaderDeclaration(path.join(product.dir, "package.json")),
    ).resolves.toMatchObject({ kind: "broken" });

    const escaping = await makeProduct({ declare: "../elsewhere/penguin-hmr.js" });
    await expect(
      readLoaderDeclaration(path.join(escaping.dir, "package.json")),
    ).resolves.toMatchObject({ kind: "broken" });

    const unparseable = await tmp("penguin-resolution-broken-");
    await fs.writeFile(path.join(unparseable, "package.json"), "{ not json");
    await expect(
      readLoaderDeclaration(path.join(unparseable, "package.json")),
    ).resolves.toMatchObject({ kind: "broken" });
  });

  it("is found from the entry, through a bin symlink, at the owning package", async () => {
    const product = await makeProduct();
    const bin = path.join(product.dir, "node_modules", ".bin");
    await fs.mkdir(bin, { recursive: true });
    const linked = path.join(bin, "penguin");
    await fs.symlink(path.relative(bin, product.entry), linked);
    await expect(loaderDeclarationFor(linked)).resolves.toMatchObject({
      kind: "declared",
      declaration: { file: product.loader },
    });
  });

  it("stops at the product's own manifest, which declares nothing, never the one above", async () => {
    // A product nested in a directory that declares a loader must not borrow it: the nearest
    // manifest is the product's own, and its silence is the answer.
    const outer = await makeProduct();
    const inner = path.join(outer.dir, "vendor", "inner");
    await fs.mkdir(path.join(inner, "dist"), { recursive: true });
    const entry = path.join(inner, "dist", "penguin.js");
    await fs.writeFile(entry, "export const cli = async () => 0;\n");
    await fs.writeFile(
      path.join(inner, "package.json"),
      JSON.stringify({ name: "inner-cli", version: "0.0.0" }, null, 2),
    );
    await expect(loaderDeclarationFor(entry)).resolves.toEqual({
      kind: "absent",
      manifest: path.join(inner, "package.json"),
    });
  });
});

describe("the ten cases and their answers", () => {
  it("1. record, CLI file in the store, declared loader present → the loader, `pushed`", async () => {
    const product = await makeProduct();
    const { root } = await makeRoot({ record: PUSHED });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });
  });

  it("2. record, CLI file in the store, declared loader absent → fault `loader-missing`", async () => {
    const product = await makeProduct({ loader: false });
    const { root } = await makeRoot({ record: PUSHED });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "fault", fault: "loader-missing" });
  });

  it("3. record, CLI file in the store, no declaration, legacy loader present → `legacy`", async () => {
    const product = await makeProduct({ declare: false });
    const { root } = await makeRoot({ record: PUSHED });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "legacy" });
  });

  it("4. record, CLI file in the store, no declaration and no legacy loader → `loader-absent`", async () => {
    const product = await makeProduct({ declare: false, loader: false });
    const { root } = await makeRoot({ record: PUSHED });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "fault", fault: "loader-absent" });
  });

  it("5. record, CLI file missing from the store → fault `cli-bundle-missing`, whatever is declared", async () => {
    const { root, bundle } = await makeRoot({ record: PUSHED, bundle: false });
    for (const declare of [undefined, false] as const) {
      const product = await makeProduct(declare === false ? { declare: false } : {});
      const resolved = await resolveCli({
        self: product.entry,
        root,
        declaration: await loaderDeclarationFor(product.entry),
      });
      expect(resolved).toMatchObject({
        kind: "fault",
        fault: "cli-bundle-missing",
        detail: bundle,
      });
    }
  });

  it("6. record, pointer unusable → fault `cli-pointer-unusable`, whatever is declared", async () => {
    for (const record of [{ cli: {} }, { cli: { bundle: "../escaped.mjs" } }]) {
      const { root } = await makeRoot({ record });
      for (const declared of [true, false]) {
        const product = await makeProduct(declared ? {} : { declare: false });
        const resolved = await resolveCli({
          self: product.entry,
          root,
          declaration: await loaderDeclarationFor(product.entry),
        });
        expect(resolved).toMatchObject({ kind: "fault", fault: "cli-pointer-unusable" });
      }
    }
  });

  it("7. record with no CLI section → the installed entry, `no-pushed-cli`", async () => {
    const product = await makeProduct();
    const { root } = await makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({
      kind: "entry",
      entry: product.entry,
      reason: "no-pushed-cli",
    });
  });

  it("8. no record → the installed entry, `no-record`", async () => {
    const product = await makeProduct();
    const { root } = await makeRoot();
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.entry, reason: "no-record" });
  });

  it("9. damaged record → fault `damaged-record`", async () => {
    const product = await makeProduct();
    const { root } = await makeRoot({ raw: "{ not json" });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "fault", fault: "damaged-record" });
  });

  it("10. the caller is the declared loader → itself, `pushed`, whatever the record holds", async () => {
    const product = await makeProduct();
    for (const root of [await makeRoot(), await makeRoot({ record: PUSHED })]) {
      const resolved = await resolveCli({
        self: product.loader,
        root: root.root,
        declaration: await loaderDeclarationFor(product.loader),
      });
      expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "pushed" });
    }
  });

  it("10b. the caller is the legacy loader of a product that declares nothing → `legacy`", async () => {
    const product = await makeProduct({ declare: false });
    const { root } = await makeRoot({ record: PUSHED });
    const resolved = await resolveCli({
      self: product.loader,
      root,
      declaration: await loaderDeclarationFor(product.loader),
    });
    expect(resolved).toMatchObject({ kind: "entry", entry: product.loader, reason: "legacy" });
  });

  it("keeps a broken declaration from falling back to the legacy name", async () => {
    const product = await makeProduct({ declare: "../elsewhere/penguin-hmr.js" });
    // The legacy file is present beside the entry; a readable declaration that breaks must
    // not be rescued by it.
    const { root } = await makeRoot({ record: PUSHED });
    const resolved = await resolveCli({
      self: product.entry,
      root,
      declaration: await loaderDeclarationFor(product.entry),
    });
    expect(resolved).toMatchObject({ kind: "fault", fault: "loader-missing" });
  });
});

describe("the record-state table a consumer reports through", () => {
  it("names each state exactly as resolution answers it, detail included", async () => {
    // The pushed-CLI loader reads the record itself (it needs the file) and reports the state
    // it found; it must not be able to name a state differently from the resolver.
    const product = await makeProduct();
    const roots = {
      none: await makeRoot(),
      absent: await makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } }),
      damaged: await makeRoot({ raw: "{ not json" }),
      unusable: await makeRoot({ record: { cli: {} } }),
      missing: await makeRoot({ record: PUSHED, bundle: false }),
    };
    for (const [state, { root }] of Object.entries(roots)) {
      const record = await readCliRecord(root);
      if (record.kind === "bundle") throw new Error(`${state} must not hold a bundle`);
      const table = answerForRecordState(record.kind);
      const name = table.kind === "entry" ? table.reason : table.fault;
      expect([...CLI_REASONS, ...CLI_FAULTS]).toContain(name);

      const resolved = await resolveCli({
        self: product.entry,
        root,
        declaration: await loaderDeclarationFor(product.entry),
      });
      const resolvedName = resolved.kind === "entry" ? resolved.reason : resolved.fault;
      expect(resolvedName).toBe(name);
      expect(resolved.detail).toBe(recordStateDetail(record, root));
    }
  });
});

describe("agrees with the layer's own reader", () => {
  /**
   * The five states, as the layer's three-answer reader projects them. Resolution reads the
   * record itself — the layer answers two of the five pairs as one — so the two readers are
   * pinned to each other here: a record the layer can answer must not arrive differently
   * through resolution.
   */
  function projection(read: Awaited<ReturnType<typeof readCliRecord>>): PushedCli["kind"] {
    switch (read.kind) {
      case "none":
      case "absent":
        return "none";
      case "bundle":
        return "bundle";
      case "damaged":
      case "unusable":
      case "missing":
        return "broken";
    }
  }

  it("reads every shape a record really takes as the layer reads it", async () => {
    const shapes: { name: string; options: Parameters<typeof makeRoot>[0] }[] = [
      { name: "no record", options: {} },
      {
        name: "a record with no CLI section",
        options: { record: { platform: { bundle: "store/platform/x.mjs" } } },
      },
      { name: "a CLI section with no pointer", options: { record: { cli: {} } } },
      { name: "an empty pointer", options: { record: { cli: { bundle: "" } } } },
      {
        name: "a pointer outside the store",
        options: { record: { cli: { bundle: "../escaped.mjs" } } },
      },
      { name: "a pointer the store holds", options: { record: PUSHED } },
      { name: "a pointer the store lost", options: { record: PUSHED, bundle: false } },
      { name: "a record that will not parse", options: { raw: "{ not json" } },
    ];
    for (const { name, options } of shapes) {
      const { root } = await makeRoot(options);
      const layer = await readPushedCli(root);
      const read = await readCliRecord(root);
      expect({ name, kind: projection(read) }).toEqual({ name, kind: layer.kind });
    }
  });

  it("reads the three shapes the layer's cast cannot answer", async () => {
    // Not a claim that the layer is wrong about a record it can read: these three are not
    // records. `readPushedCli` casts whatever parsed into the record type, so a `cli` that is
    // `null` reaches `.bundle` and throws, a `null` record throws, and an array answers "none".
    // Resolution has to answer, so it names them: a CLI section that names no usable pointer,
    // and a record that holds no JSON object. The test states both behaviours, so a later
    // change to the layer's reader lands here instead of silently diverging.
    const cliNull = await makeRoot({ record: { cli: null } });
    await expect(readPushedCli(cliNull.root)).rejects.toThrow();
    await expect(readCliRecord(cliNull.root)).resolves.toMatchObject({ kind: "unusable" });

    const nullRecord = await makeRoot({ raw: "null" });
    await expect(readPushedCli(nullRecord.root)).rejects.toThrow();
    await expect(readCliRecord(nullRecord.root)).resolves.toMatchObject({ kind: "damaged" });

    const arrayRecord = await makeRoot({ raw: "[]" });
    await expect(readPushedCli(arrayRecord.root)).resolves.toEqual({ kind: "none" });
    await expect(readCliRecord(arrayRecord.root)).resolves.toMatchObject({ kind: "damaged" });
  });
});

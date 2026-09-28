import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  discoverLoomProducts,
  loomRefPaths,
  manifestLanguages,
  mapProductMetadata,
  mapRefMetadata,
  parseRefDirName,
  readLoomProduct,
  refDirName,
} from "../src/activities/loom-import.js";

let modules: string;

/** Writes a Loom authoring tree the way Loom's own path helpers lay it out. */
async function writeRef(
  folder: string,
  productCode: string,
  refNum: number,
  files: Partial<
    Record<
      "metadata" | "spec" | "manifest" | "description" | "stateMachine" | "implementationFeatures",
      string
    >
  >,
) {
  const paths = loomRefPaths(modules, folder, productCode, refNum);
  await fs.mkdir(path.dirname(paths.metadata), { recursive: true });
  for (const [key, body] of Object.entries(files))
    await fs.writeFile(paths[key as keyof typeof paths], body!, "utf8");
}

async function writeProduct(folder: string, productCode: string, metadata: unknown) {
  const dir = path.join(modules, folder, "generated", productCode, "spec");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "activity_metadata.json"), JSON.stringify(metadata), "utf8");
}

beforeAll(async () => {
  modules = await fs.mkdtemp(path.join(os.tmpdir(), "loom-import-"));

  // A product with two refs, the second canonical, and Spanish alongside English.
  await writeProduct("waf-module-sight-words", "sight-words", {
    id: "sight-words",
    moduleFolder: "waf-module-sight-words",
    title: "Sight Words",
    canonicalRefNum: 2,
    activityType: "standard",
    templateStable: true,
  });
  await writeRef("waf-module-sight-words", "sight-words", 1, {
    metadata: JSON.stringify({ refNum: 1, displayName: "First pass", templateStable: false }),
    spec: JSON.stringify({ id: "sight-words", scenes: [{ id: "intro", description: "Hello" }] }),
    manifest: JSON.stringify({
      productCode: "sight-words",
      refNum: 1,
      assets: { "en-US": [], "es-MX": [] },
    }),
    description: "Practice sight words.",
    stateMachine: JSON.stringify({ version: "1.1", id: "sight-words", initial: "intro" }),
  });
  await writeRef("waf-module-sight-words", "sight-words", 2, {
    metadata: JSON.stringify({ refNum: 2, templateStable: true }),
    spec: JSON.stringify({ id: "sight-words", scenes: [{ id: "intro", description: "Hello" }] }),
    manifest: JSON.stringify({ productCode: "sight-words", refNum: 2, assets: { "en-US": [] } }),
    description: "Practice sight words, revised.",
    stateMachine: "{}",
  });

  // A second product inside the SAME module folder, which Loom permits.
  await writeProduct("waf-module-sight-words", "letter-hunt", {
    id: "letter-hunt",
    title: "Letter Hunt",
    canonicalRefNum: 0,
    activityType: "book",
    bookMode: "readAlong",
  });
  await writeRef("waf-module-sight-words", "letter-hunt", 0, {
    metadata: JSON.stringify({ refNum: 0 }),
    spec: JSON.stringify({ id: "letter-hunt", scenes: [] }),
    manifest: JSON.stringify({ assets: [] }),
    description: "A book.",
    stateMachine: "{}",
  });

  // Something that is not a module folder at all.
  await fs.mkdir(path.join(modules, "not-a-module", "src"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(modules, { recursive: true, force: true });
});

describe("ref directory names", () => {
  it("builds and reads Loom's name", () => {
    expect(refDirName("sight-words", 3)).toBe("sight-words-3");
    expect(parseRefDirName("sight-words", "sight-words-3")).toBe(3);
    expect(parseRefDirName("sight-words", "sight-words-0")).toBe(0);
  });

  it("matches the product prefix exactly, since a code may contain hyphens and digits", () => {
    // "sight-words-2-4" is not ref 4 of "sight-words".
    expect(parseRefDirName("sight-words", "sight-words-2-4")).toBeNull();
    expect(parseRefDirName("sight", "sight-words-2")).toBeNull();
    expect(parseRefDirName("sight-words", "other-words-2")).toBeNull();
  });

  it("refuses anything that is not a plain non-negative number", () => {
    for (const bad of ["sight-words-", "sight-words-01", "sight-words--1", "sight-words-x"])
      expect(parseRefDirName("sight-words", bad)).toBeNull();
  });
});

describe("metadata translation", () => {
  it("lets the file's module folder win over where it was found", () => {
    const product = mapProductMetadata("code", "found-here", { moduleFolder: "declared-there" });
    expect(product.moduleFolder).toBe("declared-there");
  });

  it("falls back to the directory when the file names no folder", () => {
    expect(mapProductMetadata("code", "found-here", {}).moduleFolder).toBe("found-here");
  });

  it("reads a book and its mode, and treats anything else as standard", () => {
    expect(
      mapProductMetadata("c", "f", { activityType: "book", bookMode: "decodable" }),
    ).toMatchObject({ activityType: "book", bookMode: "decodable" });
    expect(mapProductMetadata("c", "f", { activityType: "nonsense" }).activityType).toBe(
      "standard",
    );
    expect(
      mapProductMetadata("c", "f", { activityType: "book", bookMode: "wrong" }).bookMode,
    ).toBeNull();
  });

  it("keeps a missing canonical ref as unknown rather than guessing zero", () => {
    expect(mapProductMetadata("c", "f", {}).canonicalRefNum).toBeNull();
    expect(mapProductMetadata("c", "f", { canonicalRefNum: -1 }).canonicalRefNum).toBeNull();
    expect(mapProductMetadata("c", "f", { canonicalRefNum: 0 }).canonicalRefNum).toBe(0);
  });

  it("maps Loom's templateStable onto stability, and only when it is true", () => {
    expect(mapRefMetadata({ templateStable: true }).stable).toBe(true);
    expect(mapRefMetadata({ templateStable: "yes" }).stable).toBe(false);
    expect(mapRefMetadata({}).stable).toBe(false);
  });

  it("survives metadata that is not an object", () => {
    expect(mapRefMetadata(null).refNum).toBeNull();
    expect(mapProductMetadata("c", "f", "nope").activityType).toBe("standard");
  });
});

describe("manifest languages", () => {
  it("reads the language groups, sorted", () => {
    expect(manifestLanguages({ assets: { "es-MX": [], "en-US": [] } })).toEqual(["en-US", "es-MX"]);
  });

  it("treats Loom's older flat list as the default language only", () => {
    expect(manifestLanguages({ assets: [] })).toEqual(["en-US"]);
  });

  it("says nothing for a manifest it could not read", () => {
    expect(manifestLanguages(null)).toEqual([]);
  });
});

describe("reading a product", () => {
  it("reads every ref, in number order, and marks the canonical one", async () => {
    const found = await readLoomProduct(modules, "waf-module-sight-words", "sight-words");
    expect(found.problems).toEqual([]);
    expect(found.refs.map((ref) => ref.refNum)).toEqual([1, 2]);
    expect(found.refs.map((ref) => ref.canonical)).toEqual([false, true]);
  });

  it("brings the description, spec, manifest and languages across", async () => {
    const found = await readLoomProduct(modules, "waf-module-sight-words", "sight-words");
    const [first] = found.refs;
    expect(first!.description).toBe("Practice sight words.");
    expect((first!.spec as { scenes: unknown[] }).scenes).toHaveLength(1);
    expect(first!.languages).toEqual(["en-US", "es-MX"]);
    expect(first!.displayName).toBe("First pass");
    expect(first!.stable).toBe(false);
    expect(first!.problems).toEqual([]);
  });

  it("brings a ref's implementation features, keeping only ones it knows", async () => {
    await writeRef("waf-module-sight-words", "sight-words", 2, {
      implementationFeatures: JSON.stringify({
        selectedIds: ["vocabwordsreview-final-review-cards", "retired-feature"],
      }),
    });
    const found = await readLoomProduct(modules, "waf-module-sight-words", "sight-words");
    expect(found.refs.map((ref) => ref.implementationFeatures)).toEqual([
      [],
      ["vocabwordsreview-final-review-cards"],
    ]);
    // An absent file is the usual case, not a problem.
    expect(found.refs[0]!.problems).toEqual([]);
  });

  it("names what is missing instead of inventing it", async () => {
    await writeRef("waf-module-thin", "thin", 0, {
      metadata: JSON.stringify({ refNum: 0 }),
    });
    await writeProduct("waf-module-thin", "thin", { canonicalRefNum: 0 });
    const found = await readLoomProduct(modules, "waf-module-thin", "thin");
    const [only] = found.refs;
    expect(only!.spec).toBeNull();
    expect(only!.manifest).toBeNull();
    expect(only!.problems).toEqual([
      "Activity specification is missing.",
      "Asset manifest is missing.",
      "Activity description is missing.",
    ]);
    // Absent, but not a problem: 84 of 85 refs in the real Loom tree are like this.
    expect(only!.hasStateMachine).toBe(false);
    expect(found.problems).toContain(
      "Neither this product nor any of its refs has a state machine.",
    );
  });

  it("reports unreadable JSON rather than throwing", async () => {
    await writeRef("waf-module-broken", "broken", 0, {
      metadata: "{ not json",
      spec: JSON.stringify({ scenes: [] }),
      manifest: JSON.stringify({ assets: {} }),
      description: "",
      stateMachine: "{}",
    });
    await writeProduct("waf-module-broken", "broken", { canonicalRefNum: 0 });
    const found = await readLoomProduct(modules, "waf-module-broken", "broken");
    expect(found.refs[0]!.problems.some((p) => p.includes("not valid JSON"))).toBe(true);
  });

  it("reports a canonical ref the product names but does not have", async () => {
    await writeProduct("waf-module-ghost", "ghost", { canonicalRefNum: 9 });
    await writeRef("waf-module-ghost", "ghost", 0, { metadata: JSON.stringify({ refNum: 0 }) });
    const found = await readLoomProduct(modules, "waf-module-ghost", "ghost");
    expect(found.problems).toContain(
      "Product metadata names ref 9 as canonical, but no such ref exists.",
    );
  });

  it("reports a product with no refs directory", async () => {
    await writeProduct("waf-module-empty", "empty", { canonicalRefNum: 0 });
    const found = await readLoomProduct(modules, "waf-module-empty", "empty");
    expect(found.problems).toContain("This product has no refs directory.");
    expect(found.refs).toEqual([]);
  });
});

describe("discovering a modules directory", () => {
  it("finds both products sharing one module folder", async () => {
    const found = await discoverLoomProducts(modules);
    const codes = found.map((entry) => entry.product.productCode);
    expect(codes).toContain("sight-words");
    expect(codes).toContain("letter-hunt");
  });

  it("reads the book's type and mode", async () => {
    const found = await discoverLoomProducts(modules);
    const book = found.find((entry) => entry.product.productCode === "letter-hunt");
    expect(book!.product).toMatchObject({ activityType: "book", bookMode: "readAlong" });
  });

  it("skips a directory that is not a module folder", async () => {
    const found = await discoverLoomProducts(modules);
    expect(found.some((entry) => entry.product.moduleFolder === "not-a-module")).toBe(false);
  });

  it("returns nothing for a modules directory that is not there", async () => {
    expect(await discoverLoomProducts(path.join(modules, "absent"))).toEqual([]);
  });
});

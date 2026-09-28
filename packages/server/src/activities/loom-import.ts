/**
 * Reading an activity Loom already authored.
 *
 * Strictly read-only: this opens files under a Loom modules directory and reports what it
 * found. Nothing is written, here or anywhere it calls. That is deliberate for the first
 * pass — the point is to test the product hierarchy against real Loom data before nine
 * generation stages are built on top of it, and a reader that cannot write cannot damage
 * a checkout someone authored in.
 *
 * The source is Loom's AUTHORING layout under `modules_dir`, not the exported
 * `waf-activity-data` projection: the projection is what gets deployed and is lossy for
 * authoring — it has no description, no asset manifest and no state machine.
 *
 *     <modulesDir>/<moduleFolder>/generated/<productCode>/
 *       spec/activity_metadata.json      product: module folder, canonical ref, type
 *       spec/state-machine.json          the canonical product machine
 *       refs/<productCode>-<refNum>/spec/
 *         activity_metadata.json         ref: number, display name, stability
 *         activity_spec.json             scenes
 *         asset_manifest.json            media, keyed by language
 *         activity_description.txt       what an author typed
 *         state-machine.json             this ref's machine
 */
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeFeatureSelection } from "./implementation-features.js";

/** Loom's directory name for one ref. */
export function refDirName(productCode: string, refNum: number): string {
  return `${productCode}-${refNum}`;
}

/**
 * The ref number a directory name carries, or null when it is not one of this product's.
 *
 * A product code may itself contain hyphens and digits, so the prefix has to match exactly
 * rather than being split on the last hyphen.
 */
export function parseRefDirName(productCode: string, name: string): number | null {
  const prefix = `${productCode}-`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  if (!/^(?:0|[1-9][0-9]*)$/.test(rest)) return null;
  const refNum = Number(rest);
  return Number.isSafeInteger(refNum) && refNum >= 0 ? refNum : null;
}

export interface LoomProductPaths {
  productDir: string;
  metadata: string;
  stateMachine: string;
  refsDir: string;
}

export function loomProductPaths(
  modulesDir: string,
  moduleFolder: string,
  productCode: string,
): LoomProductPaths {
  const productDir = path.join(modulesDir, moduleFolder, "generated", productCode);
  return {
    productDir,
    metadata: path.join(productDir, "spec", "activity_metadata.json"),
    stateMachine: path.join(productDir, "spec", "state-machine.json"),
    refsDir: path.join(productDir, "refs"),
  };
}

export interface LoomRefPaths {
  refDir: string;
  metadata: string;
  spec: string;
  manifest: string;
  description: string;
  stateMachine: string;
  implementationFeatures: string;
}

export function loomRefPaths(
  modulesDir: string,
  moduleFolder: string,
  productCode: string,
  refNum: number,
): LoomRefPaths {
  const refDir = path.join(
    loomProductPaths(modulesDir, moduleFolder, productCode).refsDir,
    refDirName(productCode, refNum),
  );
  const spec = path.join(refDir, "spec");
  return {
    refDir,
    metadata: path.join(spec, "activity_metadata.json"),
    spec: path.join(spec, "activity_spec.json"),
    manifest: path.join(spec, "asset_manifest.json"),
    description: path.join(spec, "activity_description.txt"),
    stateMachine: path.join(spec, "state-machine.json"),
    implementationFeatures: path.join(spec, "implementation_features.json"),
  };
}

/** What a product's metadata says, with Loom's names translated to Penguin's. */
export interface ImportedProduct {
  productCode: string;
  moduleFolder: string;
  title: string | null;
  canonicalRefNum: number | null;
  activityType: "standard" | "book";
  bookMode: "decodable" | "readAlong" | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const asRefNum = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function mapProductMetadata(
  productCode: string,
  moduleFolder: string,
  json: unknown,
): ImportedProduct {
  const record = asRecord(json);
  const type = asString(record["activityType"]) ?? asString(record["type"]);
  const bookMode = asString(record["bookMode"]);
  return {
    productCode,
    // Loom lets a product override its folder, and one folder may host several products,
    // so what the file says wins over where it was found.
    moduleFolder: asString(record["moduleFolder"]) ?? moduleFolder,
    title: asString(record["title"]),
    canonicalRefNum: asRefNum(record["canonicalRefNum"]),
    activityType: type === "book" ? "book" : "standard",
    bookMode: bookMode === "decodable" || bookMode === "readAlong" ? bookMode : null,
  };
}

/** What a ref's metadata says. Loom calls the stability flag `templateStable`. */
export interface ImportedRefMetadata {
  refNum: number | null;
  title: string | null;
  displayName: string | null;
  stable: boolean;
}

export function mapRefMetadata(json: unknown): ImportedRefMetadata {
  const record = asRecord(json);
  return {
    refNum: asRefNum(record["refNum"]),
    title: asString(record["title"]),
    displayName: asString(record["displayName"]),
    stable: record["templateStable"] === true,
  };
}

/** One ref as read off disk, with whatever was missing named rather than filled in. */
export interface ImportedRef extends ImportedRefMetadata {
  refNum: number;
  canonical: boolean;
  spec: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  description: string;
  hasStateMachine: boolean;
  /** Loom's implementation features this ref selected, known ones only. */
  implementationFeatures: string[];
  /** Languages the manifest holds, which is how multi-language arrives from Loom. */
  languages: string[];
  /** What could not be read. An empty list means a complete ref. */
  problems: string[];
}

export interface ImportedActivity {
  product: ImportedProduct;
  refs: ImportedRef[];
  /** The canonical machine sits here; a ref copy appears only after implementation. */
  hasProductStateMachine: boolean;
  problems: string[];
}

/** Reads a JSON file, or reports why it could not. Never throws for a missing file. */
async function readJson(
  file: string,
  problems: string[],
  label: string,
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      problems.push(`${label} could not be read: ${(error as Error).message}`);
    else problems.push(`${label} is missing.`);
    return null;
  }
  try {
    return asRecord(JSON.parse(text));
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${(error as Error).message}`);
    return null;
  }
}

/** The language groups a Loom asset manifest holds, in a stable order. */
export function manifestLanguages(manifest: Record<string, unknown> | null): string[] {
  const assets = manifest?.["assets"];
  // Loom's manifest allows either a flat list or a map keyed by language; a flat list is
  // the default language only.
  if (Array.isArray(assets)) return ["en-US"];
  return Object.keys(asRecord(assets)).sort();
}

/** Reads one ref. Returns what it has plus what is missing; never writes. */
export async function readLoomRef(
  modulesDir: string,
  moduleFolder: string,
  product: ImportedProduct,
  refNum: number,
): Promise<ImportedRef> {
  const paths = loomRefPaths(modulesDir, moduleFolder, product.productCode, refNum);
  const problems: string[] = [];
  const metadata = mapRefMetadata(await readJson(paths.metadata, problems, "Ref metadata"));
  const spec = await readJson(paths.spec, problems, "Activity specification");
  const manifest = await readJson(paths.manifest, problems, "Asset manifest");
  let description = "";
  try {
    description = await fs.readFile(paths.description, "utf8");
  } catch (error) {
    // A description is what an author typed before generating; an activity imported
    // without one is still usable, so this is a note rather than a failure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      problems.push("Activity description is missing.");
    else problems.push(`Activity description could not be read: ${(error as Error).message}`);
  }
  // NOT a problem when absent. Measured against the real Loom tree: 84 of 85 refs have no
  // ref-level machine. Loom keeps the canonical machine on the PRODUCT and only
  // materialises it down to a ref when implement_behavior runs, so an absent ref machine
  // is the normal state of an activity nobody has implemented behaviour for yet.
  const hasStateMachine = await fs
    .stat(paths.stateMachine)
    .then((stat) => stat.isFile())
    .catch(() => false);
  // Optional in Loom: most refs select no features, and then the file is never written.
  const features: unknown = await fs
    .readFile(paths.implementationFeatures, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => null);
  const implementationFeatures = normalizeFeatureSelection(
    (features as { selectedIds?: unknown } | null)?.selectedIds,
  );
  return {
    ...metadata,
    refNum,
    canonical: product.canonicalRefNum === refNum,
    spec,
    manifest,
    description,
    hasStateMachine,
    implementationFeatures,
    languages: manifestLanguages(manifest),
    problems,
  };
}

/** Reads one product and every ref beneath it. Never writes. */
export async function readLoomProduct(
  modulesDir: string,
  moduleFolder: string,
  productCode: string,
): Promise<ImportedActivity> {
  const problems: string[] = [];
  const paths = loomProductPaths(modulesDir, moduleFolder, productCode);
  const product = mapProductMetadata(
    productCode,
    moduleFolder,
    await readJson(paths.metadata, problems, "Product metadata"),
  );
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(paths.refsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    problems.push("This product has no refs directory.");
  }
  const refNums = entries
    .map((name) => parseRefDirName(productCode, name))
    .filter((refNum): refNum is number => refNum !== null)
    .sort((a, b) => a - b);
  const refs = await Promise.all(
    refNums.map((refNum) => readLoomRef(modulesDir, product.moduleFolder, product, refNum)),
  );
  if (refs.length && !refs.some((ref) => ref.canonical))
    problems.push(
      product.canonicalRefNum === null
        ? "Product metadata names no canonical ref."
        : `Product metadata names ref ${product.canonicalRefNum} as canonical, but no such ref exists.`,
    );
  // Where the behaviour contract lives. The product machine is the canonical one; a ref
  // gets its own copy only once implement_behavior has run for it.
  const hasProductStateMachine = await fs
    .stat(paths.stateMachine)
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!hasProductStateMachine && !refs.some((ref) => ref.hasStateMachine))
    problems.push("Neither this product nor any of its refs has a state machine.");
  return { product, refs, problems, hasProductStateMachine };
}

/**
 * Every product under a Loom modules directory.
 *
 * One module folder may hold several product codes, which is why this walks both levels
 * rather than assuming `waf-module-<productCode>`.
 */
export async function discoverLoomProducts(modulesDir: string): Promise<ImportedActivity[]> {
  let folders: string[] = [];
  try {
    folders = (await fs.readdir(modulesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const found: ImportedActivity[] = [];
  for (const folder of folders) {
    let codes: string[] = [];
    try {
      codes = (
        await fs.readdir(path.join(modulesDir, folder, "generated"), {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      // Not a module folder. A modules directory holds other things too.
      continue;
    }
    for (const code of codes) found.push(await readLoomProduct(modulesDir, folder, code));
  }
  return found;
}

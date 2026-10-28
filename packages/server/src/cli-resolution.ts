/**
 * CLI resolution: which entry runs a harness command, answered once and shared by every
 * consumer that runs one — the pushed-CLI loader, a supervisor re-spawning a server, a
 * remote machine command, the push gate, and the command shim that puts `penguin` on a
 * person's PATH.
 *
 * The answer comes from two things: the record a data root holds (see
 * `@prismshadow/penguin-hmr/manifest` and PRFC-0023) and the declaration the caller's
 * product carries in its package manifest. The answer is one entry with a reason, or one
 * fault with a name. Every state the record can be in is one of the five {@link readCliRecord}
 * tells apart, and each of them answers differently here.
 *
 * The loader's identity is the declaration, never a file name:
 *
 * ```json
 * "penguin": { "pushedCliLoader": "./dist/penguin-hmr.js" }
 * ```
 *
 * in the manifest of the package that ships the loader. A product that predates the
 * declaration carries none, and only there does the legacy file name answer — recorded as
 * `legacy`, so the transition window stays visible while it lasts. A declaration that
 * names no present loader answers its fault alone; the legacy name stays unread, because a
 * new product with a broken declaration is a broken installation, not an old one.
 *
 * `loader-unloadable` and `entry-not-respawnable` are conditions a CONSUMER reports about
 * its own entry or its own probe. They are named here with everything else and never enter
 * the decision order below: presence decides the answer, and loading it is a later report.
 *
 * ## Where this module lives, and why
 *
 * Resolution is not in the hot-update layer (`packages/hmr`, `packages/server/src/hmr/`).
 * That layer carries the store and the record's mechanism, and every change there ships by
 * rebuilding and redeploying every installation. The decision procedure is the part a
 * deployment may reasonably want to change without that cost, so it lives here, outside the
 * layer, and reaches a product through the package this repository already publishes for
 * host-less readers: the CLI's thin loader imports it as
 * `@prismshadow/penguin-server/cli-resolution` — the subpath mechanism that already carries
 * `./hmr/manifest` and `./version-report` into a process with no server in it. Server-side
 * consumers import this module directly.
 *
 * ## The record: five states, read here
 *
 * The layer's reader answers three states (`readPushedCli`: nothing, a bundle, or broken),
 * and that is not enough for the table this module answers: "nothing" merges "no record"
 * with "a record that pushed no CLI", and "broken" merges a damaged record, a pointer this
 * root cannot use, and a store that lost the file. So this module reads `<root>/hmr/harness.json`
 * itself, into the five states the decision order treats separately. The two readers must
 * agree wherever the layer's reader answers at all, and a test pins that projection
 * (`packages/server/test/cli-resolution.test.ts`, "agrees with the layer's own reader").
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** The loader's file name in products built before the declaration (the transition window). */
export const LEGACY_LOADER_NAME = "penguin-hmr.js";

/** The package-manifest namespace a product declares its loader in. */
export const LOADER_MANIFEST_NAMESPACE = "penguin";

/** The field inside that namespace naming the loader, relative to the manifest's directory. */
export const LOADER_MANIFEST_FIELD = "pushedCliLoader";

/** Every fault name resolution can answer with, or a consumer can report about its own probe. */
export const CLI_FAULTS = [
  "damaged-record",
  "cli-pointer-unusable",
  "cli-bundle-missing",
  "loader-missing",
  "loader-absent",
  "loader-unloadable",
] as const;

export type CliFaultName = (typeof CLI_FAULTS)[number];

/**
 * The faults resolution itself answers. `loader-unloadable` is the one fault a consumer's
 * own probe reports — a present loader that cannot load the CLI — and it never enters the
 * decision order.
 */
export type ResolutionFault = Exclude<CliFaultName, "loader-unloadable">;

/** Every reason an answer can name its entry for. */
export const CLI_REASONS = ["pushed", "legacy", "no-record", "no-pushed-cli"] as const;

export type CliReason = (typeof CLI_REASONS)[number];

/**
 * Conditions about a consumer's own entry rather than about resolution's answer: a loader
 * that is present but cannot load the CLI, and an entry that cannot be re-spawned (an
 * extension-less symlink on PATH, a source run through a TypeScript runner).
 */
export const CONSUMER_CONDITIONS = ["loader-unloadable", "entry-not-respawnable"] as const;

export type ConsumerCondition = (typeof CONSUMER_CONDITIONS)[number];

/**
 * What the record says about the pushed CLI, in the five states a resolver must answer
 * differently: no record at all, a record it cannot read, a record holding no CLI section,
 * a CLI entry whose pointer is unusable, and a pointer whose file the store no longer holds.
 */
export type CliRecordRead =
  /** No `<root>/hmr/harness.json`: nothing has ever been pushed to this root. */
  | { kind: "none" }
  /** A record that cannot be read or parsed: this root DID commit a version it cannot name. */
  | { kind: "damaged"; reason: string }
  /** A record with no `cli` section: the version it holds pushed no CLI. */
  | { kind: "absent" }
  /** A `cli` entry naming no usable pointer: none, an empty one, or one outside the store. */
  | { kind: "unusable"; reason: string }
  /** A pointer the store no longer holds (pruned, see the layer's pruneStore). */
  | { kind: "missing"; file: string }
  /** The committed CLI bundle, absolute. */
  | { kind: "bundle"; file: string };

/** A record state that holds no bundle: the five the resolver answers differently. */
export type NoBundleRecord = Exclude<CliRecordRead["kind"], "bundle">;

/** The record shapes that hold no bundle, as the reader hands them out. */
export type NoBundleRead = Exclude<CliRecordRead, { kind: "bundle" }>;

/**
 * Reads the record's CLI half. Never throws: a malformed record is one of the answers, not
 * an exception, because both callers — a resolver and a CLI entry point — have to say
 * something useful either way.
 *
 * `cli.bundle` is trusted content, written only by the layer's persistVersion, but a reader
 * must never let a malformed or malicious value walk it out of the store via `..` segments —
 * an escape is `unusable`, like a pointer that names nothing.
 */
export async function readCliRecord(root: string): Promise<CliRecordRead> {
  const file = path.join(root, "hmr", "harness.json");
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "damaged", reason: `${file} could not be read: ${msg(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { kind: "damaged", reason: `${file} is not readable JSON: ${msg(err)}` };
  }
  // The record is an object; a scalar or an array is a record no reader can act on.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "damaged", reason: `${file} does not hold a JSON object` };
  }
  const cli: unknown = (parsed as Record<string, unknown>).cli;
  // No `cli` entry at all is a version that pushed no CLI; an entry that names nothing
  // usable is a record this root cannot act on.
  if (cli === undefined) return { kind: "absent" };
  const bundle: unknown =
    typeof cli === "object" && cli !== null ? (cli as { bundle?: unknown }).bundle : undefined;
  if (typeof bundle !== "string" || bundle.length === 0) {
    return { kind: "unusable", reason: "harness.json has a `cli` entry with no bundle path" };
  }
  const hmrDir = path.join(root, "hmr");
  const abs = path.resolve(hmrDir, bundle);
  if (abs !== hmrDir && !abs.startsWith(hmrDir + path.sep)) {
    return {
      kind: "unusable",
      reason: `harness.json points \`cli.bundle\` outside ${hmrDir}: ${bundle}`,
    };
  }
  if (!fs.existsSync(abs)) return { kind: "missing", file: abs };
  return { kind: "bundle", file: abs };
}

/**
 * How the fixed table names a record state that holds no bundle: the two states that answer
 * the installed entry (a reason), and the three that answer a fault.
 */
export type RecordStateAnswer =
  | { kind: "entry"; reason: "no-record" | "no-pushed-cli" }
  | { kind: "fault"; fault: ResolutionFault };

/**
 * The name the fixed table gives a record state, for a consumer that had to read the record
 * itself: the pushed-CLI loader reads it to get the file it loads. It reports through this
 * same table instead of spelling the names again, so a state never answers two names.
 */
export function answerForRecordState(kind: NoBundleRecord): RecordStateAnswer {
  switch (kind) {
    case "none":
      return { kind: "entry", reason: "no-record" };
    case "absent":
      return { kind: "entry", reason: "no-pushed-cli" };
    case "damaged":
      return { kind: "fault", fault: "damaged-record" };
    case "unusable":
      return { kind: "fault", fault: "cli-pointer-unusable" };
    case "missing":
      return { kind: "fault", fault: "cli-bundle-missing" };
  }
}

/** Why that answer, in one line: read from the record where it explains itself. */
export function recordStateDetail(record: NoBundleRead, root: string): string {
  switch (record.kind) {
    case "none":
      return `no record in ${root}`;
    case "absent":
      return `the record in ${root} holds no CLI`;
    case "damaged":
    case "unusable":
      return record.reason;
    case "missing":
      return record.file;
  }
}

/** The loader one product ships, as its package manifest declares it. */
export interface LoaderDeclaration {
  /** The loader's path, absolute, as the declaring product ships it. */
  file: string;
  /** The package manifest that declared it. */
  manifest: string;
}

/**
 * What a product declares about its loader, in the three states the answer depends on:
 * a declaration naming a file, no declaration at all, and a declaration that names no
 * usable file.
 */
export type LoaderDeclarationRead =
  | { kind: "declared"; declaration: LoaderDeclaration }
  /** No manifest to ask, or a manifest carrying no declaration: a product from before it. */
  | { kind: "absent"; manifest: string | null }
  /** A declaration that names no usable loader. Broken, not absent: the legacy name stays unread. */
  | { kind: "broken"; manifest: string; reason: string };

/**
 * Reads one package manifest's loader declaration.
 *
 * The three answers are deliberately not two: a product built before the declaration and a
 * product whose declaration is unreadable must not arrive as the same value, because the
 * first is allowed the legacy name and the second is a named fault.
 */
export async function readLoaderDeclaration(manifestFile: string): Promise<LoaderDeclarationRead> {
  let raw: string;
  try {
    raw = await fsp.readFile(manifestFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent", manifest: null };
    return {
      kind: "broken",
      manifest: manifestFile,
      reason: `the manifest could not be read: ${msg(err)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      kind: "broken",
      manifest: manifestFile,
      reason: `the manifest is not readable JSON: ${msg(err)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      kind: "broken",
      manifest: manifestFile,
      reason: "the manifest does not hold a JSON object",
    };
  }
  const namespace = (parsed as Record<string, unknown>)[LOADER_MANIFEST_NAMESPACE];
  if (namespace === undefined || namespace === null)
    return { kind: "absent", manifest: manifestFile };
  if (typeof namespace !== "object" || Array.isArray(namespace)) {
    return {
      kind: "broken",
      manifest: manifestFile,
      reason: `the \`${LOADER_MANIFEST_NAMESPACE}\` field is not an object`,
    };
  }
  const declared = (namespace as Record<string, unknown>)[LOADER_MANIFEST_FIELD];
  if (declared === undefined || declared === null)
    return { kind: "absent", manifest: manifestFile };
  const field = `${LOADER_MANIFEST_NAMESPACE}.${LOADER_MANIFEST_FIELD}`;
  if (typeof declared !== "string" || declared.trim().length === 0) {
    return { kind: "broken", manifest: manifestFile, reason: `\`${field}\` names no file` };
  }
  const dir = path.dirname(manifestFile);
  const file = path.resolve(dir, declared);
  // A declaration is a path inside the product: one that climbs out of the package names
  // some other installation's file, which is worse than naming none.
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    return {
      kind: "broken",
      manifest: manifestFile,
      reason: `\`${field}\` points outside ${dir}: ${declared}`,
    };
  }
  return { kind: "declared", declaration: { file, manifest: manifestFile } };
}

/**
 * The declaration the product owning `entry` carries: the first package manifest above it.
 *
 * The nearest manifest is the product's own, so the walk stops there whether that manifest
 * declares a loader or not — a product that declares nothing must not inherit its parent
 * directory's declaration. `entry` is resolved first, because a bin symlink or an installed
 * `PATH` entry is a link to the file whose package owns the declaration.
 */
export async function loaderDeclarationFor(entry: string): Promise<LoaderDeclarationRead> {
  let dir = path.dirname(await realPathOf(entry));
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) return readLoaderDeclaration(manifest);
    const parent = path.dirname(dir);
    if (parent === dir) return { kind: "absent", manifest: null };
    dir = parent;
  }
}

/** What resolution is asked: the caller's entry, the data root, and the caller's declaration. */
export interface CliResolutionInput {
  /** The caller's own entry, absolute: what this process runs, or the entry it offers. */
  self: string;
  /** The data root whose record says whether a CLI was pushed here. */
  root: string;
  /** What the caller's product declares about its loader. */
  declaration: LoaderDeclarationRead;
  /** Whether the transition window is open. Default true. */
  legacyWindow?: boolean;
}

/** Resolution's answer: one entry with a reason, or one fault with a name. */
export type CliResolution =
  | {
      kind: "entry";
      /** The entry to run, absolute. */
      entry: string;
      reason: CliReason;
      /** Why this answer, in one line — for a log, not a decision. */
      detail: string;
    }
  | { kind: "fault"; fault: ResolutionFault; detail: string };

/**
 * Which entry runs this command, in the fixed order of the RFC: the first step that applies
 * decides, and later steps stay unread.
 *
 * 1. the caller's own entry, when it is the loader the product declares (or, with no
 *    declaration, the legacy loader) — answered as itself, so a loader never loads itself;
 * 2. the record, read into its five states;
 * 3. no record → the installed entry, `no-record`;
 * 4. a damaged record → fault `damaged-record`;
 * 5. a record with no CLI section → the installed entry, `no-pushed-cli`;
 * 6. an unusable pointer → fault `cli-pointer-unusable`;
 * 7. a pointer the store no longer holds → fault `cli-bundle-missing`;
 * 8. the declared loader → the loader, `pushed`, or fault `loader-missing`;
 * 9. no declaration → the legacy loader, `legacy`, or fault `loader-absent`.
 */
export async function resolveCli(input: CliResolutionInput): Promise<CliResolution> {
  const root = path.resolve(input.root);
  const self = path.resolve(input.self);
  const declared = input.declaration.kind === "declared" ? input.declaration.declaration : null;

  // 1. Self.
  if (declared !== null && (await sameFile(self, declared.file))) {
    return {
      kind: "entry",
      entry: self,
      reason: "pushed",
      detail: `the caller is the loader declared by ${declared.manifest}`,
    };
  }
  if (input.declaration.kind === "absent" && path.basename(self) === LEGACY_LOADER_NAME) {
    return {
      kind: "entry",
      entry: self,
      reason: "legacy",
      detail: "the caller is the legacy loader, and its product declares no loader",
    };
  }

  // 2. The record, read into its five states.
  const record = await readCliRecord(root);
  if (record.kind !== "bundle") {
    const answer = answerForRecordState(record.kind);
    const detail = recordStateDetail(record, root);
    // 3, 5. No record, or a record with no CLI section: the installed entry runs.
    if (answer.kind === "entry") {
      return { kind: "entry", entry: self, reason: answer.reason, detail };
    }
    // 4, 6, 7. A damaged record, an unusable pointer, a pointer the store lost.
    return { kind: "fault", fault: answer.fault, detail };
  }

  // 8. The declared loader.
  if (input.declaration.kind === "declared") {
    const { file, manifest } = input.declaration.declaration;
    if (isFile(file)) {
      return { kind: "entry", entry: file, reason: "pushed", detail: `declared by ${manifest}` };
    }
    return { kind: "fault", fault: "loader-missing", detail: `${manifest} declares ${file}` };
  }
  if (input.declaration.kind === "broken") {
    return {
      kind: "fault",
      fault: "loader-missing",
      detail: `${input.declaration.manifest}: ${input.declaration.reason}`,
    };
  }

  // 9. The legacy loader.
  if (input.legacyWindow !== false) {
    const legacy = path.join(path.dirname(self), LEGACY_LOADER_NAME);
    if (isFile(legacy)) {
      return {
        kind: "entry",
        entry: legacy,
        reason: "legacy",
        detail: `${legacy}: no declaration above ${path.dirname(self)}`,
      };
    }
  }
  return {
    kind: "fault",
    fault: "loader-absent",
    detail: `nothing declared above ${path.dirname(self)}`,
  };
}

/** A file that is really there: a directory named like the loader names no loader. */
function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Whether two entries name the same file, through symlinks and relative spellings. */
async function sameFile(a: string, b: string): Promise<boolean> {
  if (path.resolve(a) === path.resolve(b)) return true;
  return (await realPathOf(a)) === (await realPathOf(b));
}

/** The real path of a file that exists; the plain absolute path otherwise. */
async function realPathOf(file: string): Promise<string> {
  const abs = path.resolve(file);
  try {
    return await fsp.realpath(abs);
  } catch {
    return abs;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

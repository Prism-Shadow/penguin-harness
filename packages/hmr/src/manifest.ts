/**
 * The harness.json shape (`<root>/hmr/harness.json`) and pure readers over it.
 *
 * Split out of host.ts so a reader never needs a running HmrHost: `penguin` is a
 * separate, short-lived process per invocation (see packages/cli/src/index.ts) — it
 * has no host instance to ask, only the data root's own harness.json on disk.
 * `resolveCliBundlePath` is that reader: a plain disk read, no HTTP, no boot, no
 * in-memory state.
 *
 * ONE atomic version, THREE independent artifacts: `platform`, `cli`, and `web` are
 * always written together by HmrHost's single merged upgrade path (see host.ts's
 * persistVersion), but each is content-addressed and stored on its own — a push to
 * POST /api/hmr/upgrade carries `platform` and `cli` as two separate single-file ESM
 * sources, so `cli.bundle` points at its OWN file, a different sha from
 * `platform.bundle`. They are read back together too (see host.ts's restore): a
 * partial record (e.g. `platform` present but `web` or `cli` missing) is never
 * trusted — the whole version is treated as absent instead of partially applied.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { HarnessInfo } from "@prismshadow/penguin-core";

/**
 * The committed on-disk record: a runtime restart resumes exactly this CODE (platform,
 * cli, web). It carries no STATE — a restart always boots the resumed platform bundle
 * against its own fresh initial context (bundle.context, see host.ts's PlatformBundle),
 * never a document parked from a previous run (see host.ts's module doc for why: a
 * parked doc's live-resource handles die with the process anyway, so resuming one could
 * only ever produce handles that fail to reclaim). Paths are relative to hmrDir
 * (`<root>/hmr`).
 */
/**
 * Written into an assets directory once every file in it is on disk. Its absence marks a
 * directory whose materialization was interrupted; no asset path can collide with it
 * (assets arrive as `node_modules/...` paths).
 */
export const MATERIALIZED = ".materialized";

export interface Manifest {
  platform?: { bundle: string };
  /**
   * The CLI's own bundle pointer — its own independent file (a different sha from
   * `platform.bundle`; the two are separately compiled artifacts), kept as its own
   * field so a reader that only wants "which bundle does the CLI load right now"
   * never has to reach into `platform` at all.
   */
  cli?: { bundle: string };
  /** One gzip(JSON.stringify({ files })) artifact, restored straight into memory. */
  web?: { manifest: string };
  /**
   * Files the pushed platform needs as REAL files on disk, unpacked under this directory
   * (relative to hmrDir). The web artifact stays in memory because it is only ever served
   * as bytes; an asset is something the platform hands to the OS — a native `.node` the
   * loader must resolve by path, a helper binary it execs — so it has to exist on the
   * filesystem, with its exec bit intact.
   */
  assets?: { dir: string };
  /**
   * Provenance of the push that produced this version, exactly as the pushing client sent
   * it (scripts/deploy.mjs fills it from its own checkout). Recorded, never executed or
   * resolved. Absent for a version pushed without it, and for every version committed
   * before the field existed — which is why every reader treats it as optional.
   */
  source?: { repo: string; revision: string };
  /** When this version was committed to the store (ISO 8601). Absent on older records. */
  pushedAt?: string;
  /**
   * The sha256 of each part this version was pushed as (platform, cli, every web file):
   * the blobs the store keeps alive so the next push need not carry an unchanged one.
   * Absent on older records.
   */
  blobs?: string[];
}

/** A string field of an untrusted manifest, or null unless it is a non-empty string. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What the store has committed, for version reporting: provenance, commit time, and the
 * three artifact pointers. Null when nothing has ever been pushed to this root.
 *
 * Read defensively rather than cast: harness.json is written only by persistVersion, but a
 * truncated or hand-edited file must degrade a `penguin version` to missing fields, never
 * crash it. A record missing every artifact pointer counts as nothing pushed, and so does an
 * unreadable one — the only reader here that deliberately collapses the two, because its
 * caller is a report with nowhere to put a fault. The host says so at boot instead, and
 * `penguin-hmr` says so through readPushedCli.
 */
export async function readHarnessInfo(root: string): Promise<HarnessInfo | null> {
  const manifest = await readManifest(root);
  if (manifest === null) return null;

  const bundles = {
    platform: str(manifest.platform?.bundle),
    cli: str(manifest.cli?.bundle),
    web: str(manifest.web?.manifest),
  };
  if (bundles.platform === null && bundles.cli === null && bundles.web === null) return null;

  const repo = str(manifest.source?.repo);
  const revision = str(manifest.source?.revision);
  return {
    // Both halves or neither: half a provenance names nothing.
    source: repo !== null && revision !== null ? { repo, revision } : null,
    pushedAt: str(manifest.pushedAt),
    bundles,
  };
}

/**
 * `<root>/hmr/harness.json`, as one of three answers. No file means nothing was ever pushed
 * here; a file that cannot be read or parsed is a fault on a root that DID commit a version,
 * and the two must not arrive as the same value — a reader that acts on "nothing pushed"
 * would quietly ignore a version this root still holds.
 */
type ManifestRead =
  { kind: "none" } | { kind: "manifest"; manifest: Manifest } | { kind: "broken"; reason: string };

async function readManifestFile(root: string): Promise<ManifestRead> {
  const file = path.join(root, "hmr", "harness.json");
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "broken", reason: `${file} could not be read: ${msg(err)}` };
  }
  try {
    return { kind: "manifest", manifest: JSON.parse(raw) as Manifest };
  } catch (err) {
    return { kind: "broken", reason: `${file} is not readable JSON: ${msg(err)}` };
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads and parses `<root>/hmr/harness.json`; null when missing or corrupt. The published
 * `./hmr/manifest` subpath is a contract with installed CLIs, so this keeps its shape;
 * a caller that has to tell the two apart reads it through readPushedCli.
 */
export async function readManifest(root: string): Promise<Manifest | null> {
  const read = await readManifestFile(root);
  return read.kind === "manifest" ? read.manifest : null;
}

/**
 * What this root has for the `penguin-hmr` loader. Three answers, never two: a root that
 * pushed no CLI and a root whose record names one it cannot produce are different
 * situations, and collapsing them tells the caller "nothing pushed" when the truth is
 * "the store lost it".
 */
export type PushedCli =
  /** Nothing has pushed a CLI here: a fresh root, or a record with no `cli` entry. */
  | { kind: "none" }
  /** The committed CLI bundle, absolute. */
  | { kind: "bundle"; file: string }
  /** The record names a CLI this root cannot produce. Says which, so it can be repaired. */
  | { kind: "broken"; reason: string };

/**
 * Reads the committed CLI bundle. Never throws: a malformed record is an answer
 * (`broken`), not an exception, because the caller is a CLI entry point that has to print
 * something useful either way.
 *
 * `cli.bundle` is trusted content, written only by persistVersion, but a reader must never
 * let a malformed or malicious value walk it out of the store via `..` segments — an escape
 * is `broken`, like a file the store no longer holds (pruned, see host.ts's pruneStore).
 */
export async function readPushedCli(root: string): Promise<PushedCli> {
  const read = await readManifestFile(root);
  if (read.kind === "none") return { kind: "none" };
  if (read.kind === "broken") return { kind: "broken", reason: read.reason };
  // No `cli` entry at all is a version that pushed no CLI; an entry that names nothing
  // usable is a record this root cannot act on.
  if (read.manifest.cli === undefined) return { kind: "none" };
  const bundle: unknown = read.manifest.cli.bundle;
  if (typeof bundle !== "string" || bundle.length === 0) {
    return { kind: "broken", reason: "harness.json has a `cli` entry with no bundle path" };
  }
  const hmrDir = path.join(root, "hmr");
  const abs = path.resolve(hmrDir, bundle);
  if (abs !== hmrDir && !abs.startsWith(hmrDir + path.sep)) {
    return {
      kind: "broken",
      reason: `harness.json points \`cli.bundle\` outside ${hmrDir}: ${bundle}`,
    };
  }
  if (!fs.existsSync(abs)) {
    return { kind: "broken", reason: `the committed CLI bundle is missing from the store: ${abs}` };
  }
  return { kind: "bundle", file: abs };
}

/**
 * The committed CLI bundle's path, or null for anything else. The published `./hmr/manifest`
 * subpath is a contract with installed CLIs, so this keeps its shape; readPushedCli is what
 * says WHY there is no path.
 */
export async function resolveCliBundlePath(root: string): Promise<string | null> {
  const cli = await readPushedCli(root);
  return cli.kind === "bundle" ? cli.file : null;
}

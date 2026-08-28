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
export interface Manifest {
  platform?: { bundle: string };
  /**
   * The CLI's own bundle pointer — its own independent file (a different sha from
   * `platform.bundle`; the two are separately compiled artifacts), kept as its own
   * field so a reader that only wants "which bundle does the CLI load right now"
   * never has to reach into `platform` at all.
   */
  cli?: { bundle: string };
  /**
   * The RUNTIME's own bundle pointer — the server this process is.
   *
   * Unlike the other three it is not adopted by the running process. A platform is
   * imported into it, a cli is loaded per invocation, a web dist is served as bytes; the
   * runtime is the thing doing all of that, and swapping it under itself is not a thing a
   * process can do. So it is written here and taken up at the NEXT START, by the launcher
   * that resolves it (resolveRuntimeBundlePath).
   *
   * That is the whole difference between this field and the others: committing it changes
   * nothing until somebody restarts, which is why an upgrade carrying one reports that a
   * restart is pending rather than that it is done.
   */
  runtime?: { bundle: string };
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
 * crash it. A record missing every artifact pointer counts as nothing pushed.
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

/** Reads and parses `<root>/hmr/harness.json`; null when missing or corrupt (nothing committed yet). */
export async function readManifest(root: string): Promise<Manifest | null> {
  try {
    const raw = await fsp.readFile(path.join(root, "hmr", "harness.json"), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

/**
 * Resolves the current CLI bundle's absolute path from a data root, or null when
 * nothing has been pushed yet: a fresh root, a missing/corrupt manifest, no `cli`
 * entry, a `cli.bundle` that isn't a non-empty string (e.g. `{"cli":{}}` — a
 * hand-edited or truncated harness.json), a path that resolves outside `<root>/hmr/`
 * (defense in depth: `manifest.cli.bundle` is trusted content today, written only by
 * this same process's persistVersion, but a reader must never let a malformed or
 * malicious manifest value walk it out of the store directory via `..` segments), or
 * a referenced file that no longer exists (e.g. pruned from the store — see host.ts's
 * pruneStore). A null return means "use the packaged default" to every caller;
 * nothing here ever throws for an ordinary unconfigured or malformed root.
 */
export async function resolveCliBundlePath(root: string): Promise<string | null> {
  return resolveBundlePath(root, (m) => m.cli?.bundle);
}

/**
 * The pushed RUNTIME bundle's absolute path, or null when there is none to prefer.
 *
 * Read by the launcher before anything else starts, on exactly the same terms as the CLI's:
 * null means "run the packaged one", and every malformed shape — missing entry, non-string,
 * a path that resolves outside the store, a file since pruned — is a null rather than a
 * throw. A launcher that threw here would turn a bad manifest into a machine with no server
 * at all, which is the one outcome the whole hot-update design refuses to allow.
 */
export async function resolveRuntimeBundlePath(root: string): Promise<string | null> {
  return resolveBundlePath(root, (m) => m.runtime?.bundle);
}

/** The shared resolution both readers stand on; see resolveCliBundlePath for the rules. */
async function resolveBundlePath(
  root: string,
  pick: (manifest: Manifest) => string | undefined,
): Promise<string | null> {
  const manifest = await readManifest(root);
  const bundle = manifest === null ? undefined : pick(manifest);
  if (typeof bundle !== "string" || bundle.length === 0) return null;
  const hmrDir = path.join(root, "hmr");
  const abs = path.resolve(hmrDir, bundle);
  const withinHmrDir = abs === hmrDir || abs.startsWith(hmrDir + path.sep);
  if (!withinHmrDir) return null;
  return fs.existsSync(abs) ? abs : null;
}

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
  /** One gzip(JSON.stringify({ files })) artifact, restored straight into memory. */
  web?: { manifest: string };
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
  const manifest = await readManifest(root);
  const bundle = manifest?.cli?.bundle;
  if (typeof bundle !== "string" || bundle.length === 0) return null;
  const hmrDir = path.join(root, "hmr");
  const abs = path.resolve(hmrDir, bundle);
  const withinHmrDir = abs === hmrDir || abs.startsWith(hmrDir + path.sep);
  if (!withinHmrDir) return null;
  return fs.existsSync(abs) ? abs : null;
}

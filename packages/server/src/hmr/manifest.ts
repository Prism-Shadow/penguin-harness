/**
 * The harness.json shape (`<root>/hmr/harness.json`) and pure readers over it.
 *
 * Split out of host.ts so a reader never needs a running HmrHost: `penguin` is a
 * separate, short-lived process per invocation (see packages/cli/src/index.ts) — it
 * has no host instance to ask, only the data root's own harness.json on disk.
 * `resolveCliBundlePath` is that reader: a plain disk read, no HTTP, no boot, no
 * in-memory state.
 *
 * ONE unified version: `platform`, `cli`, and `web` are always written together by
 * HmrHost's single merged upgrade path (see host.ts's persistVersion) — a bundle
 * pushed to POST /api/hmr/upgrade exports both `hotPlatform` and `cli`, so `cli.bundle`
 * always points at the SAME file as `platform.bundle`. They are read back together
 * too (see host.ts's restore): a partial record (e.g. `platform` present but `web`
 * missing) is never trusted — the whole version is treated as absent instead of
 * partially applied.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * The committed on-disk state: a runtime restart boots exactly this. Paths are
 * relative to hmrDir (`<root>/hmr`).
 */
export interface Manifest {
  platform?: { bundle: string; park: string };
  /**
   * The CLI's own bundle pointer — same file as `platform.bundle` (one bundle
   * exports both `hotPlatform` and `cli`), kept as its own field so a reader that
   * only wants "which bundle does the CLI load right now" never has to know about
   * parked documents.
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
 * entry, or a referenced file that no longer exists (e.g. pruned from the store —
 * see host.ts's pruneStore). A null return means "use the packaged default" to every
 * caller; nothing here ever throws for an ordinary unconfigured root.
 */
export async function resolveCliBundlePath(root: string): Promise<string | null> {
  const manifest = await readManifest(root);
  if (manifest?.cli === undefined) return null;
  const abs = path.join(root, "hmr", manifest.cli.bundle);
  return fs.existsSync(abs) ? abs : null;
}

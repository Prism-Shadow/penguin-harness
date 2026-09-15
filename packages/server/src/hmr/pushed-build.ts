/**
 * The upgrade body, rebuilt from this server's own hmr store: exactly what was pushed here,
 * forwarded unchanged — the native assets and the provenance included. Two callers read it:
 * a hand-over to another machine (machines/upgrade.ts) and the harness history, which keeps
 * a version's body as the copy it can push back. One reader, so the two never disagree about
 * what a version's body is.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { MATERIALIZED } from "./manifest.js";
import { UNPACKED_DIR } from "./asset-archives.js";

/**
 * Null when nothing has been pushed here — a server running its packaged build has no bundle
 * to hand on.
 *
 * The assets are not optional in practice: a pushed platform resolves node-pty out of its
 * assets directory and nowhere else (terminal/pty-module.ts), so a hand-over that dropped
 * them left the machine on a build whose every terminal failed with "no assets directory
 * available" — while the same build pushed by deploy.mjs worked. Exec bits come from the
 * files' modes, which the receiving host restores from the `exec` list.
 */
export function readPushedBuild(dataRoot: string): Buffer | null {
  try {
    const hmrDir = path.join(dataRoot, "hmr");
    const manifest = JSON.parse(fs.readFileSync(path.join(hmrDir, "harness.json"), "utf8")) as {
      platform?: { bundle?: string };
      cli?: { bundle?: string };
      web?: { manifest?: string };
      assets?: { dir?: string };
      source?: { repo?: string; revision?: string };
    };
    if (
      typeof manifest.platform?.bundle !== "string" ||
      typeof manifest.cli?.bundle !== "string" ||
      typeof manifest.web?.manifest !== "string"
    ) {
      return null;
    }
    const platform = fs.readFileSync(path.join(hmrDir, manifest.platform.bundle), "utf8");
    const cli = fs.readFileSync(path.join(hmrDir, manifest.cli.bundle), "utf8");
    // The web artifact is stored as gzip(JSON.stringify({ files })) — the same shape the
    // upgrade body carries, so it is unwrapped once here rather than re-encoded.
    const web = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(hmrDir, manifest.web.manifest))).toString("utf8"),
    ) as { files: Record<string, string> };
    const assets =
      typeof manifest.assets?.dir === "string"
        ? readAssets(path.join(hmrDir, manifest.assets.dir))
        : undefined;
    const source =
      typeof manifest.source?.repo === "string" && typeof manifest.source.revision === "string"
        ? { repo: manifest.source.repo, revision: manifest.source.revision }
        : undefined;
    return zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform,
          cli,
          web,
          ...(assets ? { assets } : {}),
          ...(source ? { source } : {}),
        }),
      ),
    );
  } catch {
    return null; // No store, a partial record, or damage: nothing safe to forward.
  }
}

/** A materialized assets directory back into the shape it was pushed as. */
function readAssets(dir: string): { files: Record<string, string>; exec: string[] } {
  const files: Record<string, string> = {};
  const exec: string[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === MATERIALIZED) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    // What this machine unpacked from the archives is not part of the build: the machine
    // receiving it unpacks its own (hmr/asset-archives.ts).
    if (rel === UNPACKED_DIR || rel.startsWith(`${UNPACKED_DIR}/`)) continue;
    files[rel] = fs.readFileSync(abs).toString("base64");
    // The mode where the filesystem keeps one; by name where it cannot. A Windows machine has
    // no exec bit to read, and a hand-over from it would otherwise strip the bit off
    // node-pty's darwin spawn-helper — the one file whose bit decides whether a terminal
    // starts on the macOS machine receiving it. deploy.mjs applies the same rule on push.
    if (rel.endsWith("/spawn-helper") || (fs.statSync(abs).mode & 0o111) !== 0) exec.push(rel);
  }
  return { files, exec };
}

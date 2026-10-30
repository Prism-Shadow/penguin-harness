/**
 * The upgrade body, rebuilt from this server's own hmr store: exactly what was pushed here,
 * forwarded unchanged — the native assets and the provenance included. Two callers read it:
 * a hand-over to another machine (machines/upgrade.ts) and the harness history, which keeps
 * a version's body as the copy it can push back. One reader, so the two never disagree about
 * what a version's body is.
 *
 * And its inverse, writePushedBuild: a body laid down as a store, for the one version that is
 * built here rather than pushed here — a source checkout's install image
 * (machines/checkout-image.ts). Written and read in the same file, so the two cannot drift.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { MATERIALIZED } from "./manifest.js";
import { UNPACKED_DIR } from "./asset-archives.js";

/** An upgrade body with every part inline: what deploy.mjs pushes, and what readPushedBuild returns once gunzipped. */
export interface PushedBuild {
  platform: string;
  cli: string;
  web: { files: Record<string, string> };
  assets?: { files: Record<string, string>; exec?: string[] };
  source?: { repo: string; revision: string };
}

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

/**
 * Lays a body down as an hmr store under `hmrDir` — `harness.json` beside `store/` — in the
 * layout the HMR layer commits a push in and restores at boot (packages/hmr's host.ts): the
 * platform and CLI bundles as content-named `.mjs` files, the web dist as one gzipped
 * artifact, the assets as real files with their exec bits, marked complete. A machine that
 * receives the directory therefore boots this version as if it had been pushed to it, and
 * its `penguin-hmr` finds this CLI.
 *
 * Every name is the one the layer itself would give the same content, so a later push of
 * the same parts to that machine lands on these files rather than beside them. Blobs are not
 * written: they only spare a pusher re-sending parts, and nothing restores from them.
 *
 * For a directory of its own. Pointed at a running server's `<root>/hmr`, it would replace
 * what that server restores at its next start — which is why no caller here does that.
 *
 * Returns the harness.json text it wrote, which is the identity an install compares.
 */
export async function writePushedBuild(
  hmrDir: string,
  build: PushedBuild,
  at: Date,
): Promise<string> {
  const web = build.web.files;
  if (typeof web["index.html"] !== "string") throw new Error("the web dist has no index.html");
  for (const rel of [...Object.keys(web), ...Object.keys(build.assets?.files ?? {})]) {
    if (!isSafeRelPath(rel)) throw new Error(`unsafe path in the build: ${rel}`);
  }
  const platformSha = sha1(build.platform).slice(0, 16);
  const cliSha = sha1(build.cli).slice(0, 16);
  const webSha = digest(web).slice(0, 16);
  await writeFile(path.join(hmrDir, "store", "platform", `${platformSha}.mjs`), build.platform);
  await writeFile(path.join(hmrDir, "store", "cli", `${cliSha}.mjs`), build.cli);
  await writeFile(
    path.join(hmrDir, "store", "web", `${webSha}.webz`),
    zlib.gzipSync(Buffer.from(JSON.stringify({ files: web }))),
  );

  let assetsDir: string | null = null;
  if (build.assets !== undefined) {
    const contents = Object.entries(build.assets.files).map(
      ([rel, b64]) => [rel, Buffer.from(b64, "base64")] as const,
    );
    const name = digest(
      Object.fromEntries(contents.map(([rel, bytes]) => [rel, sha256(bytes)])),
    ).slice(0, 16);
    assetsDir = `store/assets/${name}`;
    const exec = new Set(build.assets.exec ?? []);
    for (const [rel, bytes] of contents) {
      const file = path.join(hmrDir, ...assetsDir.split("/"), ...rel.split("/"));
      await writeFile(file, bytes);
      // Explicit: a write's mode is masked by umask.
      await fsp.chmod(file, exec.has(rel) ? 0o755 : 0o644);
    }
    // Last, as the layer does: its presence is what says the directory is whole.
    await writeFile(path.join(hmrDir, ...assetsDir.split("/"), MATERIALIZED), name);
  }

  const text = JSON.stringify(
    {
      platform: { bundle: `store/platform/${platformSha}.mjs` },
      cli: { bundle: `store/cli/${cliSha}.mjs` },
      web: { manifest: `store/web/${webSha}.webz` },
      ...(assetsDir === null ? {} : { assets: { dir: assetsDir } }),
      ...(build.source === undefined ? {} : { source: build.source }),
      pushedAt: at.toISOString(),
    },
    null,
    2,
  );
  await writeFile(path.join(hmrDir, "harness.json"), text);
  return text;
}

async function writeFile(file: string, content: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
}

function sha1(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** The layer's name for a set of files: a sha1 over its sorted `relPath → value` pairs. */
function digest(files: Record<string, string>): string {
  const hash = crypto.createHash("sha1");
  for (const rel of Object.keys(files).sort()) hash.update(rel).update("\0").update(files[rel]!);
  return hash.digest("hex");
}

/** No absolute paths, no `..`: the paths become files, and must stay under the store. */
function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

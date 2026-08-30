/**
 * Sending THIS server's hot-pushed build to a machine, and applying it there.
 *
 * The same three artifacts the local server was pushed — platform, cli, web (plus any native
 * assets) — are re-packed into the body `/api/hmr/upgrade` takes and POSTed to the machine's
 * OWN copy of that endpoint, through the forward this side holds to it. What the far side
 * answers is the endpoint's own JSON, with its own error codes, exactly as the local push
 * reads it.
 *
 * The result is a hot swap: seconds, no restart, and nothing that machine was running dies.
 * That is the difference between this and reinstalling, which replaces the program on disk
 * and needs the server bounced to take effect.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { machineApi } from "./machine-api.js";
import { MATERIALIZED } from "../hmr/host.js";

/** Long enough for 8 MB over a slow link, plus the unpack, boot and commit on the far side. */
const APPLY_TIMEOUT_MS = 10 * 60_000;

export type UpgradeOutcome =
  | { kind: "upgraded"; detail: string }
  /** The machine answered, and said no — a refused body, a runtime that cannot take it. */
  | { kind: "refused"; detail: string }
  /** Nothing to send: this server has never been pushed to. */
  | { kind: "no-build" }
  /**
   * Nothing to update: no server is running over there. A hot swap replaces the code a
   * RUNNING server is serving, so this is not a failure — whatever is on its disk is what it
   * will load when it next starts.
   */
  | { kind: "no-server" }
  /** Could not reach it, or it never answered; `detail` is its own words where there are any. */
  | { kind: "failed"; step: string; detail: string };

/**
 * The upgrade body, rebuilt from this server's own hmr store: exactly what it was pushed,
 * forwarded unchanged — the native assets and the provenance included. Null when nothing has
 * been pushed here — a server running its packaged build has no bundle to hand on.
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
    files[rel] = fs.readFileSync(abs).toString("base64");
    if ((fs.statSync(abs).mode & 0o111) !== 0) exec.push(rel);
  }
  return { files, exec };
}

/** The machine's own words for a refusal: the API error envelope's message, else the text. */
export function refusalDetail(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    const message = body.error?.message;
    if (typeof message === "string" && message !== "") return message;
  } catch {
    // Not the API's error envelope; the text itself is the best there is.
  }
  const said = text.trim();
  return said === "" ? `it refused with ${status} and said nothing` : said;
}

/** Applies this server's build on the machine reachable at `port`. Never throws. */
export async function upgradeRemote(opts: {
  /** The forward's local port. */
  port: number;
  /** A session on that machine, as its own cookie (`penguin_session=…`). */
  cookie: string;
  dataRoot: string;
  onProgress?: (line: string) => void;
}): Promise<UpgradeOutcome> {
  const payload = readPushedBuild(opts.dataRoot);
  if (payload === null) return { kind: "no-build" };
  opts.onProgress?.(`Sending this build (${(payload.byteLength / 1048576).toFixed(1)} MB)…`);
  let answer: { status: number; text: string };
  try {
    answer = await machineApi(opts.port, opts.cookie).postBytes(
      "/api/hmr/upgrade",
      "application/gzip",
      payload,
      APPLY_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "failed",
      step: "apply",
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 400),
    };
  }
  // A refusal is an ANSWER: the machine was reached and said no. That is not the same as
  // failing to reach it, and the page offers different things for the two.
  if (answer.status < 200 || answer.status >= 300) {
    return { kind: "refused", detail: refusalDetail(answer.status, answer.text).slice(0, 400) };
  }
  return { kind: "upgraded", detail: answer.text.trim().slice(0, 400) };
}

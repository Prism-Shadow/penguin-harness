/**
 * Sending THIS server's hot-pushed build to a machine, and applying it there.
 *
 * The same three artifacts the local server was pushed — platform, cli, web (plus any native
 * assets) — are sent to the machine's OWN copy of `/api/hmr`, through the connection this side
 * holds to it: the parts it lacks as blobs, then a push body that names every part by hash. What the far side
 * answers is the endpoint's own JSON, with its own error codes, exactly as the local push
 * reads it.
 *
 * The result is a hot swap: seconds, no restart, and nothing that machine was running dies.
 * That is the difference between this and reinstalling, which replaces the program on disk
 * and needs the server bounced to take effect.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { machineApi, putStream } from "./machine-api.js";
import type { MachineApi } from "./machine-api.js";
import { readPushedBuild } from "../hmr/pushed-build.js";
import { MATERIALIZED } from "../hmr/manifest.js";
import { UNPACKED_DIR } from "../hmr/asset-archives.js";

// The body a hand-over forwards is read by the same helper the harness history keeps its
// rollback copies with; re-exported so this module stays the machines' one import for it.
export { readPushedBuild };

/**
 * How long one request may sit with nothing moving — an idle timeout, not a deadline for the
 * whole transfer (node:http's `timeout`), so a large part over a slow link is not cut off
 * for being large. Long enough for the unpack, boot and commit the far side does before it
 * answers the push.
 */
const APPLY_TIMEOUT_MS = 10 * 60_000;

export type UpgradeOutcome =
  /**
   * The machine took the build and is running it. `persisted` is its own word on whether the
   * version was also written to its disk: false means live now and gone at its next restart
   * (host.ts's persistVersion), which is not the same fact as upgraded, and is not recorded
   * as one.
   */
  | { kind: "upgraded"; detail: string; persisted: boolean }
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

/** The files of a materialized assets directory, and which of them must land executable. */
function assetFiles(dir: string): { rel: string; abs: string; executable: boolean }[] {
  const out: { rel: string; abs: string; executable: boolean }[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === MATERIALIZED) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    // What this machine unpacked from the archives is not part of the build: the machine
    // receiving it unpacks its own (hmr/asset-archives.ts). Same rule as readPushedBuild.
    if (rel === UNPACKED_DIR || rel.startsWith(`${UNPACKED_DIR}/`)) continue;
    // The mode where the filesystem keeps one; by name where it cannot. A Windows machine has
    // no exec bit to read, and a hand-over from it would otherwise strip the bit off
    // node-pty's darwin spawn-helper — the one file whose bit decides whether a terminal
    // starts on the macOS machine receiving it. deploy.mjs applies the same rule on push.
    const executable = rel.endsWith("/spawn-helper") || (fs.statSync(abs).mode & 0o111) !== 0;
    out.push({ rel, abs, executable });
  }
  return out;
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

/** One part of this server's pushed build: named by the sha256 of its bytes, read only when sent. */
interface PushedPart {
  sha: string;
  size: number;
  open(): NodeJS.ReadableStream;
}

/** This server's pushed build as parts, none of them read into memory but the web dist. */
export interface PushedParts {
  platform: PushedPart;
  cli: PushedPart;
  web: Record<string, PushedPart>;
  assets?: { files: Record<string, PushedPart>; exec: string[] };
  source?: { repo: string; revision: string };
}

/**
 * The same build readPushedBuild re-packs, as parts named by hash — what the content-addressed
 * transfer sends. Files are hashed as streams and opened again only when a part is sent, so a
 * build of any size is never held here. The web dist is the exception: it is stored as one
 * gzip(JSON) artifact and is read whole, as it always was. Null when nothing has been pushed here.
 */
export async function readPushedParts(dataRoot: string): Promise<PushedParts | null> {
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
    const web = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(hmrDir, manifest.web.manifest))).toString("utf8"),
    ) as { files: Record<string, string> };
    const webParts: Record<string, PushedPart> = {};
    for (const [rel, b64] of Object.entries(web.files))
      webParts[rel] = bytesPart(Buffer.from(b64, "base64"));
    let assets: PushedParts["assets"];
    if (typeof manifest.assets?.dir === "string") {
      const dir = path.join(hmrDir, manifest.assets.dir);
      const files: Record<string, PushedPart> = {};
      const exec: string[] = [];
      for (const { rel, abs, executable } of assetFiles(dir)) {
        files[rel] = await filePart(abs);
        if (executable) exec.push(rel);
      }
      assets = { files, exec };
    }
    return {
      platform: await filePart(path.join(hmrDir, manifest.platform.bundle)),
      cli: await filePart(path.join(hmrDir, manifest.cli.bundle)),
      web: webParts,
      ...(assets ? { assets } : {}),
      ...(typeof manifest.source?.repo === "string" && typeof manifest.source.revision === "string"
        ? { source: { repo: manifest.source.repo, revision: manifest.source.revision } }
        : {}),
    };
  } catch {
    return null; // No store, a partial record, or damage: nothing safe to forward.
  }
}

async function filePart(file: string): Promise<PushedPart> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha: hash.digest("hex"), size, open: () => fs.createReadStream(file) };
}

function bytesPart(bytes: Buffer): PushedPart {
  return {
    sha: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    open: () => Readable.from([bytes]),
  };
}

/** A probe answers for at most this many names at once (packages/hmr's probeEndpoint). */
const PROBE_BATCH = 50_000;

/**
 * Applies this server's build on the machine reachable at `port`. Never throws.
 *
 * Content-addressed, the way scripts/deploy.mjs pushes: ask which parts the machine lacks, send
 * only those — each one streamed from its file, never held — then push a body that names every
 * part by hash. A machine whose server predates the probe answers 404 to it and is sent the
 * whole build inline, as before (readPushedBuild).
 */
export async function upgradeRemote(opts: {
  /** A dial through the machine's connection, and its server's port over there. */
  agent: http.Agent;
  port: number;
  /** A session on that machine, as its own cookie (`penguin_session=…`). */
  cookie: string;
  dataRoot: string;
  onProgress?: (line: string) => void;
}): Promise<UpgradeOutcome> {
  const parts = await readPushedParts(opts.dataRoot);
  if (parts === null) return { kind: "no-build" };
  const api = machineApi(opts.agent, opts.port, opts.cookie);
  const failed = (step: string, err: unknown): UpgradeOutcome => ({
    kind: "failed",
    step,
    detail: (err instanceof Error ? err.message : String(err)).slice(0, 400),
  });

  const all = new Map<string, PushedPart>();
  for (const part of [
    parts.platform,
    parts.cli,
    ...Object.values(parts.web),
    ...Object.values(parts.assets?.files ?? {}),
  ]) {
    all.set(part.sha, part);
  }
  const hashes = [...all.keys()];
  const missing: string[] = [];
  for (let i = 0; i < hashes.length; i += PROBE_BATCH) {
    let answer: { status: number; text: string };
    try {
      answer = await api.request("POST", "/api/hmr/assets/probe", {
        hashes: hashes.slice(i, i + PROBE_BATCH),
      });
    } catch (err) {
      return failed("probe", err);
    }
    if (answer.status === 404) return upgradeInline(opts, api);
    if (answer.status !== 200) {
      return { kind: "refused", detail: refusalDetail(answer.status, answer.text).slice(0, 400) };
    }
    try {
      missing.push(...(JSON.parse(answer.text) as { missing: string[] }).missing);
    } catch (err) {
      return failed("probe", err);
    }
  }

  const bytes = missing.reduce((sum, sha) => sum + (all.get(sha)?.size ?? 0), 0);
  opts.onProgress?.(
    `Sending ${missing.length} of ${all.size} parts this machine lacks (${(bytes / 1048576).toFixed(1)} MB)…`,
  );
  for (const sha of missing) {
    const part = all.get(sha);
    if (part === undefined) continue; // named by the probe but not asked about: not ours to send
    let answer: { status: number; text: string };
    try {
      answer = await putStream(
        opts.agent,
        opts.port,
        opts.cookie,
        `/api/hmr/blobs/${sha}`,
        { stream: part.open(), length: part.size },
        APPLY_TIMEOUT_MS,
      );
    } catch (err) {
      return failed("apply", err);
    }
    if (answer.status < 200 || answer.status >= 300) {
      return { kind: "refused", detail: refusalDetail(answer.status, answer.text).slice(0, 400) };
    }
  }

  const ref = (part: PushedPart) => ({ sha: part.sha });
  const refs = (map: Record<string, PushedPart>) =>
    Object.fromEntries(Object.entries(map).map(([rel, part]) => [rel, ref(part)]));
  const body = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        platform: ref(parts.platform),
        cli: ref(parts.cli),
        web: { files: refs(parts.web) },
        ...(parts.assets
          ? { assets: { files: refs(parts.assets.files), exec: parts.assets.exec } }
          : {}),
        ...(parts.source ? { source: parts.source } : {}),
      }),
    ),
  );
  let answer: { status: number; text: string };
  try {
    answer = await api.postBytes("/api/hmr/upgrade", "application/gzip", body, APPLY_TIMEOUT_MS);
  } catch (err) {
    return failed("apply", err);
  }
  return classifyUpgradeAnswer(answer.status, answer.text);
}

/** The whole build in one body, for a machine whose server has no probe (older than it). */
async function upgradeInline(
  opts: { dataRoot: string; onProgress?: (line: string) => void },
  api: MachineApi,
): Promise<UpgradeOutcome> {
  const payload = readPushedBuild(opts.dataRoot);
  if (payload === null) return { kind: "no-build" };
  opts.onProgress?.(`Sending this build (${(payload.byteLength / 1048576).toFixed(1)} MB)…`);
  let answer: { status: number; text: string };
  try {
    answer = await api.postBytes("/api/hmr/upgrade", "application/gzip", payload, APPLY_TIMEOUT_MS);
  } catch (err) {
    return {
      kind: "failed",
      step: "apply",
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 400),
    };
  }
  return classifyUpgradeAnswer(answer.status, answer.text);
}

/**
 * What the endpoint's answer means. A refusal is an ANSWER: the machine was reached and said
 * no, which is not the same as failing to reach it, and the page offers different things for
 * the two. And a 2xx is not yet a yes: `/api/hmr/upgrade` answers 200 for `blocked` — the
 * running version kept serving, the body names what would have been discarded — so clients
 * keep one parsing path (hmr/routes.ts), and scripts/deploy.mjs reads it the same way.
 */
export function classifyUpgradeAnswer(status: number, text: string): UpgradeOutcome {
  if (status < 200 || status >= 300) {
    return { kind: "refused", detail: refusalDetail(status, text).slice(0, 400) };
  }
  let body: {
    status?: unknown;
    persisted?: unknown;
    dropped?: unknown;
    missing?: unknown;
    invalid?: unknown;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return {
      kind: "refused",
      detail: `it answered ${status} with something that is not its outcome: ${text.trim().slice(0, 200)}`,
    };
  }
  if (body.status === "blocked") {
    const names = (key: "dropped" | "missing" | "invalid") =>
      Array.isArray(body[key]) && body[key].length > 0
        ? `${key}: ${(body[key] as string[]).join(", ")}`
        : null;
    const why = [names("missing"), names("invalid"), names("dropped")]
      .filter((s) => s !== null)
      .join("; ");
    return {
      kind: "refused",
      detail: `it kept its current version${why === "" ? "" : ` — ${why}`}`.slice(0, 400),
    };
  }
  if (body.status !== "ok") {
    return {
      kind: "refused",
      detail: `it answered ${status} with an outcome this build does not know: ${text.trim().slice(0, 200)}`,
    };
  }
  return {
    kind: "upgraded",
    detail: text.trim().slice(0, 400),
    persisted: body.persisted !== false,
  };
}

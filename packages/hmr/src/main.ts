/**
 * The HMR layer's entry: the operations that are FROZEN.
 *
 * Everything that decides how a generation becomes current lives here and in host.ts —
 * how the first one boots, how a push is applied and what happens when its boot fails, when
 * a request may be handed to a generation, and what the layer must refresh once a new one
 * is current. The product hands in three things and drives nothing itself:
 *
 * - `host`: the store and the swap (HmrHost), built over the product's packaged bundle;
 * - `replace`: what the product does with a generation once it is current — point its
 *   handles at it, refresh what it derives from a version. Called for the first boot and
 *   after every push: the pushed generation when it lands, the previous one re-booted
 *   when it does not;
 * - `start`: the product's boot — publish what a generation claims, then the first `ensure`.
 *
 * `start` receives the control object before it runs, so the product's routes and seam can
 * be built over it while the first generation is still coming up.
 */
import zlib from "node:zlib";
import type { Instance, Park } from "@prismshadow/penguin-core/kernel";
import { Readable } from "node:stream";
import type { HmrHost, UpgradeAllTarget, UpgradeOutcome } from "./host.js";
import { isBlobName } from "./host.js";

/** Where a push arrives. The product declares and contributes the route like any other; the protocol behind it is this file's. */
export const HMR_ROUTE_PREFIX = "/api/hmr";
export const HMR_UPGRADE_PATH = `${HMR_ROUTE_PREFIX}/upgrade`;
/** Names the blobs a pusher holds; answers which of them this store lacks, so the push carries only those. */
export const HMR_PROBE_PATH = `${HMR_ROUTE_PREFIX}/assets/probe`;
/** `PUT ${HMR_BLOBS_PATH}/<sha256>` with the raw bytes: one blob into the store, hashed as it lands. */
export const HMR_BLOBS_PATH = `${HMR_ROUTE_PREFIX}/blobs`;

/** What the product does with a generation once it is current. */
export type Replace<Api extends Park> = (instance: Instance<Api>) => void;

/** The frozen operations, as the product sees them. */
export interface Hmr<Api extends Park> {
  /**
   * The generation requests go to. Waits out an in-flight swap FIRST: the kernel disposes the
   * old tree before the new one has booted, and for that window the host still answers with
   * the old instance — a caller that did not wait would be handed a disposed tree. Throws
   * when no generation can boot at all; the product's own routes are the fallback then, and
   * the upgrade channel stays reachable to push a working one.
   */
  current(): Promise<Instance<Api>>;
  /**
   * THE upgrade, serialized: store the bundles, boot the new generation, swap, commit the
   * version — or put the previous generation back and report why. `replace` runs once the
   * new one is current.
   */
  upgrade(target: UpgradeAllTarget): Promise<UpgradeOutcome>;
  /**
   * The channel's endpoints, framework-free: a Request in, a Response out — what the routes
   * the product declares under HMR_ROUTE_PREFIX answer with. HMR_PROBE_PATH names blobs and
   * answers which ones the store lacks; HMR_BLOBS_PATH takes one blob, raw; HMR_UPGRADE_PATH
   * is the push, whose parts may be inline or named by hash and resolved from the store. Any
   * generation may serve the routes by handing the request here, which is how one without a
   * platform of its own still carries the channel.
   */
  endpoint(
    request: Request,
    onLanded?: (outcome: Extract<UpgradeOutcome, { status: "ok" }>) => void,
  ): Promise<Response>;
}

/** The control object alone, for a product that boots its first generation some other way (tests). */
export function hmrControl<Api extends Park>(host: HmrHost<Api>, replace: Replace<Api>): Hmr<Api> {
  const hmr: Hmr<Api> = {
    endpoint: (request, onLanded) => {
      const { pathname } = new URL(request.url);
      if (pathname === HMR_PROBE_PATH) return probeEndpoint(host, request);
      if (pathname.startsWith(`${HMR_BLOBS_PATH}/`)) return blobEndpoint(host, request);
      return upgradeEndpoint(hmr, request, onLanded, (sha) => host.readBlob(sha));
    },
    current: async () => {
      await host.waitIdle();
      return host.ensure();
    },
    upgrade: async (target) => {
      const outcome = await host.upgradeAll(target, admitsUpgradeRoute);
      // Whatever is current now is a NEW instance — the pushed generation, or the previous
      // one re-booted after the pushed one failed — and the product is told either way. A
      // double fault leaves nothing current: ensure() throws, and the product keeps its last.
      try {
        replace(await host.ensure());
      } catch {
        // No generation is current; the upgrade channel stays reachable to push a good one.
      }
      return outcome;
    },
  };
  return hmr;
}

export async function hmrMain<Api extends Park>(
  host: HmrHost<Api>,
  replace: Replace<Api>,
  start: (hmr: Hmr<Api>) => Promise<void>,
): Promise<Hmr<Api>> {
  const hmr = hmrControl(host, replace);
  await start(hmr);
  replace(await host.ensure());
  return hmr;
}

/**
 * The one thing every generation must serve: the upgrade channel. A platform without it
 * would be committed and restored on every restart with no way to push another — so it is
 * refused before commit, and the previous generation stays. The probe carries no
 * credential: the route's own gate answering (401/403), or the endpoint refusing the
 * probe's shape (400/405), proves the route is there; null, a 404 or anything else does not.
 */
export async function admitsUpgradeRoute<Api extends Park>(
  instance: Instance<Api>,
): Promise<string | null> {
  const api = instance.api as {
    http?: (request: Request) => Promise<Response | null> | Response | null;
  };
  if (typeof api.http !== "function")
    return `the pushed platform serves no HTTP, so no ${HMR_UPGRADE_PATH}`;
  let response: Response | null;
  try {
    response = await api.http.call(
      api,
      new Request(`http://localhost${HMR_UPGRADE_PATH}`, { method: "POST" }),
    );
  } catch (err) {
    return `probing ${HMR_UPGRADE_PATH} on the pushed platform threw: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (response !== null && [400, 401, 403, 405].includes(response.status)) return null;
  return (
    `the pushed platform serves no ${HMR_UPGRADE_PATH} (answered ${response === null ? "nothing" : response.status}); ` +
    `a push must carry the upgrade channel, or the installation could never be upgraded again`
  );
}

/** A part of a push named by the hash of a blob already in the store. */
type BlobRef = { sha: string };
const isRef = (value: unknown): value is BlobRef =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as BlobRef).sha === "string" &&
  isBlobName((value as BlobRef).sha);

/**
 * What a push's body is: `gzip(JSON.stringify({ platform, cli, web, assets?, source? }))`.
 * Each of `platform`, `cli` and a `web.manifest` entry may be inline or `{ sha }`, a blob
 * put in the store beforehand (HMR_BLOBS_PATH) and resolved here through `readBlob`. A
 * reference to a blob the store does not hold is refused, naming it. Throws with the reason
 * when the body is not a push.
 */
export function parseUpgradeTarget(
  contentType: string | null,
  body: Buffer,
  readBlob: (sha: string) => Buffer | null = () => null,
): UpgradeAllTarget {
  const resolve = (what: string, value: unknown): Buffer | null => {
    if (!isRef(value)) return null;
    const blob = readBlob(value.sha);
    if (blob === null) {
      throw new Error(
        `${what} names blob ${value.sha.slice(0, 12)}, which this store does not hold — put it first (${HMR_BLOBS_PATH}/<sha256>)`,
      );
    }
    return blob;
  };
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/gzip" && type !== "application/octet-stream") {
    throw new Error(
      "expected a gzip(JSON.stringify({ platform, cli, web })) body " +
        "(Content-Type application/gzip or application/octet-stream)",
    );
  }
  let payload: {
    platform?: string | BlobRef;
    cli?: string | BlobRef;
    web?: { files?: Record<string, string>; manifest?: Record<string, BlobRef> };
    assets?: {
      files?: Record<string, string>;
      manifest?: Record<string, { sha: string }>;
      blobs?: Record<string, string>;
      exec?: string[];
    };
    source?: { repo: string; revision: string };
  };
  try {
    payload = JSON.parse(zlib.gunzipSync(body).toString("utf8"));
  } catch (err) {
    throw new Error(
      `invalid gzip upgrade payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const platform = resolve("`platform`", payload.platform)?.toString("utf8") ?? payload.platform;
  if (typeof platform !== "string")
    throw new Error("payload has no `platform` (string or { sha })");
  const cli = resolve("`cli`", payload.cli)?.toString("utf8") ?? payload.cli;
  if (typeof cli !== "string") throw new Error("payload has no `cli` (string or { sha })");
  let web = payload.web?.files;
  if (typeof payload.web?.manifest === "object" && payload.web.manifest !== null) {
    web = { ...(web ?? {}) };
    for (const [rel, ref] of Object.entries(payload.web.manifest)) {
      const blob = resolve(`\`web.manifest\` entry ${rel}`, ref);
      if (blob === null) throw new Error(`\`web.manifest\` entry ${rel} is not { sha }`);
      web[rel] = blob.toString("base64");
    }
  }
  if (typeof web !== "object" || web === null) {
    throw new Error("payload has no `web.files` (a { relPath: base64 } map) or `web.manifest`");
  }
  return {
    platform,
    cli,
    web,
    // Optional: a push that needs no real files on disk (no native module, no helper
    // binary) simply omits it, and older pushers keep working unchanged. Two shapes:
    // every file inline (`files`), or a manifest of hashes plus only the blobs this
    // store said it was missing (`manifest` + `blobs`, after HMR_PROBE_PATH).
    ...(payload.assets?.files || payload.assets?.manifest
      ? {
          assets: {
            ...(payload.assets.files ? { files: payload.assets.files } : {}),
            ...(payload.assets.manifest ? { manifest: payload.assets.manifest } : {}),
            ...(payload.assets.blobs ? { blobs: payload.assets.blobs } : {}),
            ...(payload.assets.exec ? { exec: payload.assets.exec } : {}),
          },
        }
      : {}),
    // Provenance is optional and, unlike the bundles, outlives the request in harness.json —
    // so it is accepted only fully formed. A half-filled or wrong-typed `source` is dropped
    // rather than committed: readers tolerate its absence, and a malformed record on disk
    // would outlive the push that produced it.
    ...(typeof payload.source?.repo === "string" &&
    typeof payload.source.revision === "string" &&
    payload.source.repo.length > 0 &&
    payload.source.revision.length > 0
      ? { source: { repo: payload.source.repo, revision: payload.source.revision } }
      : {}),
  };
}

/**
 * The upgrade endpoint, framework-free: a Request in, a Response out. A malformed push and a
 * push whose generation could not become current both answer 400 with the reason;
 * `blocked` is an outcome, not an error — the body carries the paths for the upper rungs
 * of the upgrade ladder, so clients keep one parsing path. `onLanded` runs for a push that
 * landed: what the product tells its clients (a reload), not what the layer does.
 */
export async function probeEndpoint(
  host: Pick<HmrHost, "missingBlobs">,
  request: Request,
): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const bad = (message: string) => json(400, { error: { code: "bad_request", message } });
  const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
  const hashes = body?.hashes;
  if (!Array.isArray(hashes) || hashes.some((h) => typeof h !== "string")) {
    return bad("expected { hashes: string[] }");
  }
  if (hashes.length > 50_000) return bad("too many hashes in one probe");
  return json(200, { missing: host.missingBlobs(hashes as string[]) });
}

/**
 * One blob in, raw: `PUT <HMR_BLOBS_PATH>/<sha256>` with the bytes as the body. Stored under
 * that name only if the bytes hash to it; the answer names the size stored. What a pusher
 * does for each blob the probe reported missing, before a push that names them.
 */
export async function blobEndpoint(
  host: Pick<HmrHost, "putBlob">,
  request: Request,
): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const bad = (status: number, message: string) =>
    json(status, {
      error: { code: status === 405 ? "method_not_allowed" : "bad_request", message },
    });
  if (request.method !== "PUT") return bad(405, `${HMR_BLOBS_PATH}/<sha256> takes PUT`);
  const sha = new URL(request.url).pathname.slice(HMR_BLOBS_PATH.length + 1);
  if (!isBlobName(sha))
    return bad(400, "a blob is named by the lowercase hex sha256 of its content");
  const body = request.body === null ? Readable.from([]) : Readable.fromWeb(request.body as never);
  try {
    const size = await host.putBlob(sha, body);
    return json(200, { sha, size });
  } catch (err) {
    return bad(400, err instanceof Error ? err.message : String(err));
  }
}

export async function upgradeEndpoint<Api extends Park>(
  hmr: Hmr<Api>,
  request: Request,
  onLanded?: (outcome: Extract<UpgradeOutcome, { status: "ok" }>) => void,
  readBlob?: (sha: string) => Buffer | null,
): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const bad = (message: string) => json(400, { error: { code: "bad_request", message } });
  let target: UpgradeAllTarget;
  try {
    target = parseUpgradeTarget(
      request.headers.get("content-type"),
      Buffer.from(await request.arrayBuffer()),
      readBlob,
    );
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err));
  }
  let outcome: UpgradeOutcome;
  try {
    outcome = await hmr.upgrade(target);
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err));
  }
  if (outcome.status === "ok") onLanded?.(outcome);
  return json(200, outcome);
}

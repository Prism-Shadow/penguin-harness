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
import type { HmrHost, UpgradeAllTarget, UpgradeOutcome } from "./host.js";

/** Where a push arrives. The product declares and contributes the route like any other; the protocol behind it is this file's. */
export const HMR_ROUTE_PREFIX = "/api/hmr";
export const HMR_UPGRADE_PATH = `${HMR_ROUTE_PREFIX}/upgrade`;

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
   * The upgrade endpoint over `upgrade`: a Request in, a Response out — what the route the
   * product declares for it answers with. Any generation may serve the route by handing
   * the request here, which is how one without a platform of its own still carries the
   * channel.
   */
  endpoint(
    request: Request,
    onLanded?: (outcome: Extract<UpgradeOutcome, { status: "ok" }>) => void,
  ): Promise<Response>;
}

/** The control object alone, for a product that boots its first generation some other way (tests). */
export function hmrControl<Api extends Park>(host: HmrHost<Api>, replace: Replace<Api>): Hmr<Api> {
  const hmr: Hmr<Api> = {
    endpoint: (request, onLanded) => upgradeEndpoint(hmr, request, onLanded),
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

/** What a push's body is: `gzip(JSON.stringify({ platform, cli, web, assets?, source? }))`. Throws with the reason when it is not. */
export function parseUpgradeTarget(contentType: string | null, body: Buffer): UpgradeAllTarget {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/gzip" && type !== "application/octet-stream") {
    throw new Error(
      "expected a gzip(JSON.stringify({ platform, cli, web })) body " +
        "(Content-Type application/gzip or application/octet-stream)",
    );
  }
  let payload: {
    platform?: string;
    cli?: string;
    web?: { files?: Record<string, string> };
    assets?: { files?: Record<string, string>; exec?: string[] };
    source?: { repo: string; revision: string };
  };
  try {
    payload = JSON.parse(zlib.gunzipSync(body).toString("utf8"));
  } catch (err) {
    throw new Error(
      `invalid gzip upgrade payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof payload.platform !== "string") throw new Error("payload has no `platform` (string)");
  if (typeof payload.cli !== "string") throw new Error("payload has no `cli` (string)");
  if (typeof payload.web?.files !== "object" || payload.web.files === null) {
    throw new Error("payload has no `web.files` (a { relPath: base64 } map)");
  }
  return {
    platform: payload.platform,
    cli: payload.cli,
    web: payload.web.files,
    // Optional: a push that needs no real files on disk (no native module, no helper
    // binary) simply omits it, and older pushers keep working unchanged.
    ...(payload.assets?.files
      ? {
          assets: {
            files: payload.assets.files,
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
export async function upgradeEndpoint<Api extends Park>(
  hmr: Hmr<Api>,
  request: Request,
  onLanded?: (outcome: Extract<UpgradeOutcome, { status: "ok" }>) => void,
): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const bad = (message: string) => json(400, { error: { code: "bad_request", message } });
  let target: UpgradeAllTarget;
  try {
    target = parseUpgradeTarget(
      request.headers.get("content-type"),
      Buffer.from(await request.arrayBuffer()),
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

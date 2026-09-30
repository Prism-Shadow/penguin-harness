/**
 * Whether the target already has the build deploy.mjs is about to push — so a repeated push
 * of the same build can stop before it reaches the target at all.
 *
 * A push is not idempotent on the receiving side. The store is content-addressed, so the files
 * land on themselves, but the platform bundle is imported again under a fresh query string and
 * booted as a new generation; the module records of every earlier generation stay in the
 * process for its lifetime. Pushing the same build ten times leaves ten generations behind.
 * The only place that can avoid it without changing the runtime is here, before sending.
 *
 * What is compared is `harness` from GET /api/version: the four content-addressed pointers
 * (platform, cli, web, assets) the target has committed. They are recomputed here from the
 * bytes about to be sent, by the same rules the runtime names its store files with
 * (packages/hmr's host.ts), so equal pointers mean equal content.
 *
 * Committed is what the target can report; which generation is executing, nothing reports.
 * The two differ in two cases. A push whose disk commit failed (`persisted: false`) runs a
 * build harness.json does not name — the pointers differ, so the push goes ahead, which is
 * the safe direction. A restore that failed at startup runs the packaged platform while
 * harness.json still names the pushed build — the pointers match and the push is skipped;
 * the runtime warns at startup when that happens, and `--force` pushes regardless. The
 * report's own build identity (`commit`, `describe`) cannot tell them apart: it is stamped
 * into core's dist when core is built, not by the push.
 *
 * Every other doubt resolves to pushing. A target that answers no report, or reports no
 * assets pointer (a platform older than the field), gets the push it would have got before
 * this check existed.
 *
 * Kept free of deploy.mjs's top-level argv/env side effects so tests can import it (see
 * deploy-target-safety.mjs for the same split).
 */
import { createHash } from "node:crypto";

const sha1 = (data) => createHash("sha1").update(data).digest("hex");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** A `relPath → value` map hashed in sorted order, as host.ts's filesDigest / recordDigest do. */
function mapDigest(files) {
  const hash = createHash("sha1");
  for (const rel of Object.keys(files).sort()) hash.update(rel).update("\0").update(files[rel]);
  return hash.digest("hex");
}

/**
 * The pointers the target would commit for this build, relative to `<root>/hmr`.
 *
 * - platform, cli: sha1 of the bundle text.
 * - web: sha1 over `rel \0 base64(content)` in sorted order — the body carries web files as
 *   base64 and the runtime hashes the strings it receives.
 * - assets: sha1 over `rel \0 sha256(content)` in sorted order — the runtime names an assets
 *   directory by the blob names of its files. Null when the push carries no assets.
 *
 * @param {{ platform: Buffer, cli: Buffer, web: Record<string, Buffer>, assets?: Record<string, Buffer> }} build
 */
export function buildPointers(build) {
  const short = (hex) => hex.slice(0, 16);
  const web = Object.fromEntries(
    Object.entries(build.web).map(([rel, bytes]) => [rel, bytes.toString("base64")]),
  );
  const assetFiles = build.assets ?? {};
  const assets = Object.fromEntries(
    Object.entries(assetFiles).map(([rel, bytes]) => [rel, sha256(bytes)]),
  );
  return {
    platform: `store/platform/${short(sha1(build.platform.toString("utf8")))}.mjs`,
    cli: `store/cli/${short(sha1(build.cli.toString("utf8")))}.mjs`,
    web: `store/web/${short(mapDigest(web))}.webz`,
    assets:
      Object.keys(assetFiles).length === 0 ? null : `store/assets/${short(mapDigest(assets))}`,
  };
}

/**
 * Compares a target's version report with the build about to be pushed.
 *
 * @param {unknown} report GET /api/version's body, as parsed JSON (anything else: not the same).
 * @param {ReturnType<typeof buildPointers>} pointers
 * @returns {{ same: true } | { same: false, reason: string }}
 */
export function committedBuildMatches(report, pointers) {
  const r = typeof report === "object" && report !== null ? report : {};
  const harness = typeof r.harness === "object" && r.harness !== null ? r.harness : null;
  if (harness === null) return { same: false, reason: "the target has no pushed harness" };
  const bundles =
    typeof harness.bundles === "object" && harness.bundles !== null ? harness.bundles : {};
  for (const part of ["platform", "cli", "web"]) {
    if (bundles[part] !== pointers[part]) {
      return { same: false, reason: `its committed ${part} differs` };
    }
  }
  // `undefined` is a platform that predates the field: it cannot say, so it is not a match.
  if (!("assets" in harness)) {
    return { same: false, reason: "its version report does not name its assets" };
  }
  if (harness.assets !== pointers.assets) {
    return { same: false, reason: "its committed assets differ" };
  }
  return { same: true };
}

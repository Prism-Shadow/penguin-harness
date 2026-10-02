/**
 * Vitest global setup for this package: the live suite confines with the bubblewrap the plugin
 * SHIPS, and that binary is put in place by the build (scripts/vendor-bwrap.mjs), which a run of
 * the tests alone never does. So on Linux, when this architecture's vendored bwrap is missing,
 * fetch it here with the same script — pinned by sha256 and cached under node_modules/.cache, so
 * only the first run on a machine touches the network. Present: nothing to do, no network. Not
 * Linux: the plugin ships nothing that runs here.
 *
 * Here rather than in CI or an npm `prepare` script: CI should not need to know what one plugin's
 * tests require, and pnpm runs a workspace package's `prepare` on every install, on every platform.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vendoredRunner } from "../src/index.js";

export interface PrepareBwrapOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  /** Whether the plugin's own bwrap for this platform and arch is in place and executable. */
  present?: (platform: NodeJS.Platform, arch: string) => boolean;
  /** Puts the vendored bwrap in place (scripts/vendor-bwrap.mjs). */
  vendor?: () => Promise<unknown>;
}

/** What preparing did: nothing off Linux, nothing when the binary is in place, else vendored it. */
export async function prepareVendoredBwrap({
  platform = process.platform,
  arch = process.arch,
  present = (p, a) => vendoredRunner(p, a) !== "",
  vendor = vendorBwrap,
}: PrepareBwrapOptions = {}): Promise<"not-linux" | "present" | "vendored"> {
  if (platform !== "linux") return "not-linux";
  if (present(platform, arch)) return "present";
  await vendor();
  return "vendored";
}

/** The build's own vendoring, called as the library it also is. */
async function vendorBwrap(): Promise<unknown> {
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../scripts/vendor-bwrap.mjs",
  );
  const { vendorBwrap: vendor } = (await import(pathToFileURL(script).href)) as {
    vendorBwrap: () => Promise<string>;
  };
  return vendor();
}

export default async function setup(): Promise<void> {
  await prepareVendoredBwrap();
}

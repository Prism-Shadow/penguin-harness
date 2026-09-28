/**
 * What Penguin downloads to run GitHub Copilot itself: the Copilot CLI's platform package from
 * npm (the same program the Local CLI recipe runs with --acp), at a version pinned here and
 * raised deliberately with a Penguin release.
 */
export const COPILOT_VERSION = "1.0.88";

const ARCHES = new Set(["x64", "arm64"]);

/** The npm package holding the program for this machine, or null when Copilot has no build for it. */
export function copilotPackageName(
  platform: NodeJS.Platform,
  arch: string,
  musl: boolean,
): string | null {
  if (!ARCHES.has(arch)) return null;
  if (platform === "win32" || platform === "darwin") return `@github/copilot-${platform}-${arch}`;
  if (platform === "linux") return `@github/copilot-${musl ? "linuxmusl" : "linux"}-${arch}`;
  return null;
}

/** A Linux without glibc (Alpine and the like), where the musl build is the one that runs. */
export function isMuslLinux(): boolean {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport?.() as
    { header?: { glibcVersionRuntime?: string } } | undefined;
  const header = report?.header;
  return header !== undefined && header.glibcVersionRuntime === undefined;
}

/** The program's path inside the unpacked package, from its manifest. */
export function binaryFromManifest(manifest: unknown): string {
  const m = manifest as { exports?: Record<string, unknown>; bin?: Record<string, unknown> };
  const exported = m.exports?.["."];
  const bin = m.bin !== undefined ? Object.values(m.bin)[0] : undefined;
  const found = typeof exported === "string" ? exported : typeof bin === "string" ? bin : null;
  if (found === null) throw new Error("The Copilot package does not name its program.");
  return found.replace(/^\.\//u, "");
}

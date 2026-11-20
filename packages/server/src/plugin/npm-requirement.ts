/**
 * Whether a package needs npm to install, and whether it installs on this machine at all —
 * the two questions an install made without npm (direct-install.ts) asks of a version's
 * manifest before it fetches the tarball (the registry document's version entry) and again
 * of the package's own package.json once it is unpacked.
 *
 * A package needs npm when installing it does something besides placing its files:
 *
 * - it depends on other packages — `dependencies`, `optionalDependencies`,
 *   `bundleDependencies` (always listed among the dependencies too), or `peerDependencies`
 *   not marked optional, which npm 7+ installs — npm resolves and downloads them;
 * - it has an install-time script — `preinstall`, `install` or `postinstall` (the registry's
 *   abbreviated document says `hasInstallScript` instead) — which npm runs;
 * - it carries `binding.gyp` at its root (`gypfile` in a manifest), which npm compiles with
 *   node-gyp when no install script says otherwise.
 *
 * `prepare` is not among them: npm runs it for a git repository or a local directory, never
 * for a registry or tarball install, which are the only installs made without npm.
 *
 * `binding.gyp` with `gypfile: false` is not compiled, as npm leaves it.
 *
 * Where it may install is npm's own rule (EBADPLATFORM): an `os`, `cpu` or `libc` list naming
 * values excludes every other one, and a `!value` excludes that one.
 */

import { readFileSync } from "node:fs";

/** The fields of a package manifest these rules read; anything else is ignored. */
export type PackageManifest = Record<string, unknown>;

/** The scripts npm runs while it installs a registry or tarball package. */
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"] as const;

/** The dependency names a manifest lists under `field`. */
function dependencyNames(manifest: PackageManifest, field: string): string[] {
  const value = manifest[field];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "object" && value !== null) return Object.keys(value);
  return [];
}

/** The names, at most five, then how many more. */
function listed(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(", ");
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

/**
 * Why the package needs npm, as clauses that complete "it needs npm: …"; empty when it needs
 * nothing npm does. `bindingGyp` is whether the unpacked package has `binding.gyp` at its root.
 */
export function npmNeededBecause(
  manifest: PackageManifest,
  { bindingGyp = false }: { bindingGyp?: boolean } = {},
): string[] {
  const reasons: string[] = [];
  const optionalPeers = (() => {
    const meta = manifest.peerDependenciesMeta;
    if (typeof meta !== "object" || meta === null) return new Set<string>();
    return new Set(
      Object.entries(meta)
        .filter(([, v]) => (v as { optional?: unknown } | null)?.optional === true)
        .map(([k]) => k),
    );
  })();
  const dependencies = [
    ...new Set([
      ...dependencyNames(manifest, "dependencies"),
      ...dependencyNames(manifest, "optionalDependencies"),
      ...dependencyNames(manifest, "bundleDependencies"),
      ...dependencyNames(manifest, "bundledDependencies"),
      ...dependencyNames(manifest, "peerDependencies").filter((name) => !optionalPeers.has(name)),
    ]),
  ];
  if (dependencies.length > 0) {
    reasons.push(`it depends on ${listed(dependencies)}, which npm resolves and downloads`);
  }
  const scripts =
    typeof manifest.scripts === "object" && manifest.scripts !== null
      ? (manifest.scripts as Record<string, unknown>)
      : {};
  const declared = INSTALL_SCRIPTS.filter(
    (name) => typeof scripts[name] === "string" && (scripts[name] as string).trim() !== "",
  );
  if (declared.length > 0) {
    reasons.push(`it has install scripts (${declared.join(", ")}), which npm runs`);
  } else if (manifest.hasInstallScript === true) {
    reasons.push("it has install scripts, which npm runs");
  } else if ((bindingGyp && manifest.gypfile !== false) || manifest.gypfile === true) {
    reasons.push("it carries binding.gyp, which npm compiles with node-gyp");
  }
  return reasons;
}

/** The C library this Linux machine runs on, as npm tells it apart (glibc, musl); undefined elsewhere or when it cannot tell. */
let libcFamily: { value: string | undefined } | null = null;
function currentLibc(platform: string): string | undefined {
  if (platform !== "linux") return undefined;
  libcFamily ??= { value: detectLibc() };
  return libcFamily.value;
}

/** npm-install-checks' reading: `ldd` names its library; else the process report's runtime. */
function detectLibc(): string | undefined {
  try {
    const ldd = readFileSync("/usr/bin/ldd", "utf8");
    if (ldd.includes("musl")) return "musl";
    if (ldd.includes("GNU C Library")) return "glibc";
  } catch {
    // No ldd to read: the process report answers below.
  }
  const report = process.report?.getReport() as
    { header?: { glibcVersionRuntime?: string }; sharedObjects?: unknown } | undefined;
  if (report?.header?.glibcVersionRuntime !== undefined) return "glibc";
  const shared = Array.isArray(report?.sharedObjects) ? (report.sharedObjects as string[]) : [];
  return shared.some((f) => f.includes("libc.musl-") || f.includes("ld-musl-"))
    ? "musl"
    : undefined;
}

/** npm's `checkList`: `any` admits everything; no `!value` may match, and one plain value must when any is listed. */
function listAdmits(value: string | undefined, list: readonly string[]): boolean {
  if (list.length === 1 && list[0] === "any") return true;
  let negated = 0;
  let match = false;
  for (const entry of list) {
    if (entry.startsWith("!")) {
      negated += 1;
      if (value === entry.slice(1)) return false;
    } else {
      match ||= value === entry;
    }
  }
  return match || negated === list.length;
}

/** A platform list as npm reads one: a string is a list of one. */
function platformList(manifest: PackageManifest, field: string): string[] | null {
  const value = manifest[field];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return null;
}

/**
 * Why the package does not install on this machine, by its `os`, `cpu` and `libc` lists
 * (npm's EBADPLATFORM rule, npm-install-checks `checkPlatform`); null when it does. A `libc`
 * list excludes every machine that is not Linux.
 */
export function platformRefusal(
  manifest: PackageManifest,
  platform: string = process.platform,
  arch: string = process.arch,
  libc: () => string | undefined = () => currentLibc(platform),
): string | null {
  const refusal = (field: string, current: () => string | undefined, what: string) => {
    const list = platformList(manifest, field);
    if (list === null) return null;
    const value = current();
    // npm refuses a `libc` list where it cannot name the C library (every machine but Linux).
    if (field === "libc" && value === undefined) {
      return `its libc list (${list.join(", ")}) needs a Linux machine whose C library npm can name`;
    }
    return listAdmits(value, list)
      ? null
      : `its ${field} list (${list.join(", ")}) does not admit this machine's ${what}, ${value}`;
  };
  return (
    refusal("os", () => platform, "operating system") ??
    refusal("cpu", () => arch, "CPU") ??
    refusal("libc", libc, "C library")
  );
}

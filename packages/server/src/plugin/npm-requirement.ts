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
 * Where it may install is npm's own rule (EBADPLATFORM): an `os` or `cpu` list naming values
 * excludes every other one, and a `!value` excludes that one.
 */

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
  } else if (bindingGyp || manifest.gypfile === true) {
    reasons.push("it carries binding.gyp, which npm compiles with node-gyp");
  }
  return reasons;
}

/**
 * Why the package does not install on this machine, by its `os` and `cpu` lists (npm's
 * EBADPLATFORM rule); null when it does.
 */
export function platformRefusal(
  manifest: PackageManifest,
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  const refusal = (field: "os" | "cpu", current: string, what: string): string | null => {
    const list = dependencyNames(manifest, field);
    const blocked = list.filter((v) => v.startsWith("!")).map((v) => v.slice(1));
    const allowed = list.filter((v) => !v.startsWith("!"));
    if (blocked.includes(current)) return `its ${field} list excludes ${what} ${current}`;
    if (allowed.length > 0 && !allowed.includes(current)) {
      return `it supports the ${what} ${allowed.join(", ")} only, not ${current}`;
    }
    return null;
  };
  return refusal("os", platform, "operating system") ?? refusal("cpu", arch, "CPU");
}

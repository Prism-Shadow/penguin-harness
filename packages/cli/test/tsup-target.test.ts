/**
 * Drift guard for the Node version every bundle is compiled against.
 *
 * `target` in a tsup config is the syntax level esbuild emits down to, and each package had
 * drifted to its own answer — node20 for core, cli and skills, node22 for server and
 * desktop — while the packages that declare `engines` all require Node >= 24, CI runs 24,
 * and releases ship a 24 runtime. Nothing broke, because targeting an older Node only means
 * output that could have been left alone gets transpiled; the cost is that "which Node do
 * we build for" had five answers and no one of them was right.
 *
 * The rule this pins: one target across every package, and it agrees with the `engines`
 * requirement those packages publish. A published package must never emit syntax older Node
 * cannot parse without saying so in `engines` — that declaration is what makes the mismatch
 * surface at install time, as npm's `EBADENGINE` warning and as an outright refusal under
 * `engine-strict`, instead of the user meeting a SyntaxError at import time.
 *
 * Lives here rather than at the repo root because the root runs no test suite of its own,
 * following dev-script-entry.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packagesDir = path.join(repoRoot, "packages");

/** Every package that builds with tsup, as [name, config source, package.json]. */
const tsupPackages = readdirSync(packagesDir)
  .map((name) => ({ name, dir: path.join(packagesDir, name) }))
  .map(({ name, dir }) => ({
    name,
    configPath: path.join(dir, "tsup.config.ts"),
    pkgPath: path.join(dir, "package.json"),
  }))
  .filter(({ configPath }) => {
    try {
      readFileSync(configPath);
      return true;
    } catch {
      return false;
    }
  });

/** The `target: "nodeNN"` a config declares. Read as text: importing it would run tsup's. */
function declaredTarget(configPath: string): string | null {
  return /target:\s*"(node\d+)"/.exec(readFileSync(configPath, "utf8"))?.[1] ?? null;
}

/**
 * The major from an `engines.node` range, which this workspace always writes as `>=NN`.
 *
 * Anchored to that one form on purpose: a loose digit scan would read `"<24"` as major 24 and
 * wave through a package whose declared runtimes are all older than the syntax it emits.
 * Anything but `>=NN` reads as no answer, and the caller fails the package rather than
 * guessing at the range's meaning.
 */
function requiredMajor(pkgPath: string): number | null {
  const engines = (JSON.parse(readFileSync(pkgPath, "utf8")) as { engines?: { node?: string } })
    .engines?.node;
  const major = engines === undefined ? undefined : /^\s*>=\s*(\d+)\s*$/.exec(engines)?.[1];
  return major === undefined ? null : Number(major);
}

describe("tsup build target", () => {
  it("discovers the packages that build with tsup", () => {
    // Deliberately not an exact list: new packages arrive (the sandbox backends were the
    // first), and a closed enumeration would fail for the one reason that is not a defect.
    // What has to hold is that discovery works at all — if it silently found nothing, the
    // target assertion below would pass vacuously.
    const names = tsupPackages.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["cli", "core", "desktop", "server"]));
  });

  it("is the same Node version everywhere", () => {
    const targets = tsupPackages.map(({ name, configPath }) => [name, declaredTarget(configPath)]);
    expect(Object.fromEntries(targets)).toEqual(
      Object.fromEntries(tsupPackages.map(({ name }) => [name, "node24"])),
    );
  });

  it("has something to check — discovery finding nothing would pass the rule vacuously", () => {
    expect(tsupPackages.length).toBeGreaterThan(0);
  });

  it("never emits syntax newer than a published package admits to needing", () => {
    for (const { name, configPath, pkgPath } of tsupPackages) {
      const target = declaredTarget(configPath);
      const required = requiredMajor(pkgPath);
      const published = !(JSON.parse(readFileSync(pkgPath, "utf8")) as { private?: boolean })
        .private;
      if (!published) continue;
      expect(
        required,
        `${name} builds for ${target} but declares no engines.node range of the form ">=NN"`,
      ).not.toBeNull();
      expect(`node${required}`, `${name}: engines.node and tsup target disagree`).toBe(target);
    }
  });
});

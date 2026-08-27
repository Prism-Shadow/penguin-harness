/**
 * Drift guard for the port/data-root isolation of the dev entry points.
 *
 * Two servers cannot share a port, and a data root admits one server at a time
 * (`<root>/server.lock`) — so entry points meant to run at the same time must differ in
 * BOTH. The pair that carries that requirement is `pnpm dev:server` and the dev CLI's
 * `penguin web`: a harness started as `pnpm penguin web` is exactly what asks an Agent to
 * run `pnpm dev` in this repo (the allocation table lives in
 * `packages/core/src/internal/ports.ts`). The assignments themselves are run-with-env
 * defaults on package.json script lines that nothing type-checks, so this test parses
 * them back out and pins the disjointness — including against the installed server's
 * port and root, which those dev entries must never touch.
 *
 * The desktop's dev shell deliberately shares `~/.penguin/dev-data` with `dev:server`
 * (a second server on a locked root is its attach-mode case, and the two surfaces
 * sharing one dataset when used alternately is the point), and it binds no fixed port —
 * so it is pinned to that root rather than away from it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliDir, "..", "..");

const readScripts = (pkgPath: string): Record<string, string> =>
  (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};

/**
 * The `VAR=value` defaults a script passes to run-with-env.mjs (the segment between the
 * script path and the `--` separator). Returns null when the script does not use it.
 */
function runWithEnvDefaults(script: string | undefined): Record<string, string> | null {
  if (script === undefined) return null;
  const m = script.match(/run-with-env\.mjs\s+(.+?)\s+--\s/);
  if (m === null) return null;
  const defaults: Record<string, string> = {};
  for (const token of m[1]!.split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) defaults[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return defaults;
}

/** Expands the leading `~/` the same way run-with-env.mjs does, then normalizes. */
function expandHome(value: string): string {
  const expanded =
    value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
  return path.normalize(expanded);
}

const rootScripts = readScripts(path.join(repoRoot, "package.json"));
const serverScripts = readScripts(path.join(repoRoot, "packages", "server", "package.json"));
const cliScripts = readScripts(path.join(cliDir, "package.json"));

const devServer = runWithEnvDefaults(serverScripts["dev"]);
const devCli = runWithEnvDefaults(rootScripts["penguin"]);
const devDesktop = runWithEnvDefaults(rootScripts["desktop"]);

/** The installed server/CLI root, `~/.penguin/data` (core's resolveRoot() default). */
const installedRoot = path.join(os.homedir(), ".penguin", "data");

describe("dev entry point isolation (ports and data roots)", () => {
  it("dev:server and the dev CLI each declare a port and a data root", () => {
    for (const [name, defaults] of [
      ["dev:server", devServer],
      ["penguin", devCli],
    ] as const) {
      expect(defaults, `${name} must set its defaults through run-with-env`).not.toBeNull();
      expect(defaults!.PORT, `${name} must pin a port`).toMatch(/^\d+$/);
      expect(defaults!.PENGUIN_HOME, `${name} must pin a data root`).toBeDefined();
    }
  });

  it("no two simultaneously runnable server entries share a port", () => {
    const ports = [
      Number(devServer!.PORT),
      Number(devCli!.PORT),
      DEFAULT_SERVER_PORT, // the installed server both dev entries must coexist with
    ];
    expect(new Set(ports).size).toBe(ports.length);
  });

  it("no two simultaneously runnable server entries share a data root", () => {
    const roots = [
      expandHome(devServer!.PENGUIN_HOME!),
      expandHome(devCli!.PENGUIN_HOME!),
      path.normalize(installedRoot),
    ];
    expect(new Set(roots).size).toBe(roots.length);
  });

  it("the root and packages/cli penguin scripts agree on their defaults", () => {
    // Two spellings of the same entry point; a root moved in one and not the other
    // would make `pnpm penguin` and `pnpm --dir packages/cli penguin` serve different data.
    expect(runWithEnvDefaults(cliScripts["penguin"])).toEqual(devCli);
  });

  it("the dev desktop shell stays on dev:server's root, by design", () => {
    expect(devDesktop).not.toBeNull();
    expect(expandHome(devDesktop!.PENGUIN_HOME!)).toBe(expandHome(devServer!.PENGUIN_HOME!));
    // No PORT: the embedded server allocates its own (PORT=0 + sticky preference).
    expect(devDesktop!.PORT).toBeUndefined();
  });
});

/**
 * Drift guard for the source entry and watcher/prebuild commands the dev runners execute.
 *
 * Only `src/penguin.ts` runs the CLI: it calls `cli()` and sets the exit code, and tsup
 * builds it into the `penguin` bin. `src/index.ts` merely exports `cli()`, so a runner
 * pointed at it imports the module, executes nothing and exits 0 — indistinguishable, at
 * the terminal, from a CLI that started and printed nothing. Splitting the entry in #298
 * updated this package's own `penguin` script and left the repo root's behind, which is
 * exactly that silent no-op. If this test fails, point the failing script at the source
 * file matching the bin.
 *
 * - Given the CLI bin entry in `packages/cli/package.json`, when resolving the dev runner's
 *   source file, then both the root and `packages/cli` `penguin` scripts pass `src/penguin.ts`
 *   to `tsx`.
 * - Given `dev-server.mjs` on Windows (`win32`), when building the Node CLI arguments for the
 *   server entry, then it uses Node's native `--watch` with `--import <tsx loader URL>` instead
 *   of `tsx/cli watch` (which stalls on Windows before binding port 7368).
 * - Given `dev-server.mjs` on POSIX (`linux` or `darwin`), when building the Node CLI arguments
 *   for the server entry and data roots, then it runs `tsx/cli watch` with `--exclude` globs
 *   normalized to forward slashes for each root.
 * - Given `dev-prebuild.mjs`'s pnpm filter set, when resolved against the workspace, then it
 *   selects every workspace dependency declared by `packages/server`, `packages/cli`, and
 *   `packages/web` (including `@prismshadow/amsp` and `@prismshadow/penguin-library-*`) while
 *   excluding `@prismshadow/penguin-ui`, `@prismshadow/penguin-web`, and the native
 *   `@penguinharness/sandbox-*` backends.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { DEV_PREBUILD_FILTERS } from "../../../scripts/dev-prebuild.mjs";
import { devServerArgs } from "../../../scripts/dev-server.mjs";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliDir, "..", "..");

const readScripts = (pkgPath: string): Record<string, string> =>
  (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};

const cliPkg = JSON.parse(readFileSync(path.join(cliDir, "package.json"), "utf8")) as {
  bin: Record<string, string | undefined>;
};

const binEntry = cliPkg.bin.penguin;
if (binEntry === undefined) throw new Error("packages/cli/package.json declares no penguin bin");

/** `./dist/penguin.js` -> `penguin.ts`: the source file the bin is built from. */
const entrySource = `${path.basename(binEntry, ".js")}.ts`;

describe("dev runner entry", () => {
  it("is the source file the penguin bin is built from", () => {
    expect(entrySource).toBe("penguin.ts");
  });

  it.each([
    ["repo root", path.join(repoRoot, "package.json"), `packages/cli/src/${entrySource}`],
    ["packages/cli", path.join(cliDir, "package.json"), `src/${entrySource}`],
  ])("%s runs it through tsx", (_name, pkgPath, expected) => {
    const script = readScripts(pkgPath).penguin;
    expect(script).toBeDefined();
    expect(script).toContain(`tsx ${expected}`);
  });
});

describe("dev-server watcher arguments", () => {
  const fakeTsxLoader = "file:///C:/repo/node_modules/tsx/dist/loader.mjs";
  const fakeTsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const fakeResolve = (specifier: string): string =>
    specifier === "tsx" ? fakeTsxLoader : pathToFileURL(fakeTsxCliPath).href;

  it("uses Node's native --watch with --import tsx on Windows instead of tsx watch", () => {
    const args = devServerArgs(
      ["src/index.ts"],
      new Set(["C:\\Users\\dev\\.penguin\\dev-data"]),
      "win32",
      fakeResolve,
    );
    expect(args).toEqual(["--watch", "--import", fakeTsxLoader, "src/index.ts"]);
  });

  it.each(["linux", "darwin"] as const)(
    "runs tsx/cli watch with forward-slash data-root exclusions on %s",
    (platform) => {
      const args = devServerArgs(
        ["src/index.ts"],
        new Set(["/tmp/dev-data", "C:\\Users\\dev\\.penguin\\dev-data"]),
        platform,
        fakeResolve,
      );
      expect(args).toEqual([
        fakeTsxCliPath,
        "watch",
        "--exclude",
        "/tmp/dev-data/**",
        "--exclude",
        "C:/Users/dev/.penguin/dev-data/**",
        "src/index.ts",
      ]);
    },
  );
});

describe("dev-prebuild workspace selection", () => {
  it("builds every workspace dependency of server, cli, and web except ui and sandbox backends", () => {
    const selected = new Set(
      (
        JSON.parse(
          execFileSync(
            "pnpm",
            [...DEV_PREBUILD_FILTERS, "list", "--recursive", "--depth", "-1", "--json"],
            {
              cwd: repoRoot,
              encoding: "utf8",
              shell: process.platform === "win32",
            },
          ),
        ) as { name: string }[]
      ).map((project) => project.name),
    );

    expect(selected.has("@prismshadow/penguin-server")).toBe(true);
    expect(selected.has("@prismshadow/penguin-cli")).toBe(true);
    expect(selected.has("@prismshadow/penguin-web")).toBe(false);
    expect(selected.has("@prismshadow/penguin-ui")).toBe(false);

    for (const rel of [
      "packages/server/package.json",
      "packages/cli/package.json",
      "packages/web/package.json",
    ]) {
      const manifest = JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [dep, spec] of Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })) {
        if (!spec.startsWith("workspace:")) continue;
        if (dep === "@prismshadow/penguin-ui" || dep.startsWith("@penguinharness/sandbox-")) {
          expect(selected.has(dep), `${dep} should be excluded from dev-prebuild`).toBe(false);
        } else {
          expect(selected.has(dep), `${rel} workspace dependency ${dep} must be built`).toBe(true);
        }
      }
    }
  });
});

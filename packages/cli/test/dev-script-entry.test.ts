/**
 * Drift guard for the source entry the dev runners execute.
 *
 * Only `src/penguin.ts` runs the CLI: it calls `cli()` and sets the exit code, and tsup
 * builds it into the `penguin` bin. `src/index.ts` merely exports `cli()`, so a runner
 * pointed at it imports the module, executes nothing and exits 0 — indistinguishable, at
 * the terminal, from a CLI that started and printed nothing. Splitting the entry in #298
 * updated this package's own `penguin` script and left the repo root's behind, which is
 * exactly that silent no-op. If this test fails, point the failing script at the source
 * file matching the bin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

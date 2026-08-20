/**
 * `penguin version`: the two output modes, and the property that `-v` cannot drift from the
 * subcommand. Both render core's buildInfo() and add nothing, so the assertions compare
 * against that producer rather than against literals — the release workflow stamps core's
 * constants before it runs these tests, and a hardcoded version would only fail there.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import type { VersionReport } from "@prismshadow/penguin-core/interfaces";
import { versionReport } from "@prismshadow/penguin-server/version-report";
import { registerVersionCommand } from "../src/commands/version.js";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";

/** Collects everything `body` writes to stdout, alongside whatever it returns. */
async function captureStdout<T>(body: () => Promise<T>): Promise<{ out: string; result: T }> {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await body();
    return { out: written.join(""), result };
  } finally {
    process.stdout.write = original;
  }
}

/** Runs one argv through a bare program carrying only the version command; returns stdout. */
async function run(argv: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  registerVersionCommand(program, getMessages("en"));
  const { out } = await captureStdout(() => program.parseAsync(argv, { from: "user" }));
  return out;
}

describe("penguin version", () => {
  it("prints the one-line identity and nothing else", async () => {
    expect(await run(["version"])).toBe(`${buildInfo().describe}\n`);
  });

  it("prints the whole version report as JSON under --json", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-cli-version-"));
    try {
      const out = await run(["version", "--json", "--root", root]);
      expect(JSON.parse(out)).toEqual(await versionReport(root));
      // Indented, because a human reads this out of a bug report.
      expect(out).toContain("\n  ");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("reports the harness pushed to the root it was pointed at", async () => {
    // The one fact the version line cannot carry: a hot-pushed CLI bundle sits in no
    // checkout, so only the store's recorded provenance names the revision behind it.
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-cli-version-"));
    try {
      await fsp.mkdir(path.join(root, "hmr"), { recursive: true });
      await fsp.writeFile(
        path.join(root, "hmr", "harness.json"),
        JSON.stringify({
          cli: { bundle: "store/cli/abc123.mjs" },
          source: { repo: "https://example.com/penguin.git", revision: "v0.2.3-7-gabc1234-dirty" },
          pushedAt: "2026-08-20T10:15:00.000Z",
        }),
      );

      const report = JSON.parse(await run(["version", "--json", "--root", root])) as VersionReport;
      expect(report.harness?.source?.revision).toBe("v0.2.3-7-gabc1234-dirty");
      expect(report.harness?.pushedAt).toBe("2026-08-20T10:15:00.000Z");
      expect(report.harness?.bundles.cli).toBe("store/cli/abc123.mjs");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("omits a harness for a root with nothing pushed", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-cli-version-"));
    try {
      const report = JSON.parse(await run(["version", "--json", "--root", root])) as VersionReport;
      expect(report.harness).toBeNull();
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("describes this build in a form that names a version", async () => {
    const { version, describe: described } = buildInfo();
    expect(described.startsWith(`v${version}`)).toBe(true);
  });

  it("agrees with -v", async () => {
    const { out } = await captureStdout(() => cli(["-v"]));
    expect(out).toBe(`${buildInfo().describe}\n`);
  });

  it("is reachable as a subcommand of the real CLI", async () => {
    const { out, result } = await captureStdout(() => cli(["version"]));
    expect(result).toBe(0);
    expect(out).toBe(`${buildInfo().describe}\n`);
  });
});

/**
 * `penguin version`: the two output modes, and the property that `-v` cannot drift from the
 * subcommand. Both render core's buildInfo() and add nothing, so the assertions compare
 * against that producer rather than against literals — the release workflow stamps core's
 * constants before it runs these tests, and a hardcoded version would only fail there.
 */
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import type { VersionReport } from "@prismshadow/penguin-core";
import { serverLockPath } from "@prismshadow/penguin-server/lock";
import { versionReport } from "@prismshadow/penguin-server/version-report";
import { registerVersionCommand } from "../src/commands/version.js";
import { cli } from "../src/index.js";
import { getMessages } from "@prismshadow/penguin-server/cli";

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
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : undefined;
  let listener: net.Server | undefined;
  const prevFetch = globalThis.fetch;
  const prevUrl = process.env.PENGUIN_API_URL;
  if (root) {
    delete process.env.PENGUIN_API_URL;
    listener = net.createServer();
    await new Promise<void>((resolve) => listener!.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as net.AddressInfo).port;
    const baseUrl = `http://localhost:${port}`;
    await fsp.writeFile(
      serverLockPath(root),
      `${JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() })}\n`,
    );
    await fsp.writeFile(path.join(root, "api-token"), "test-version-token\n", { mode: 0o600 });
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(baseUrl) && new URL(url).pathname === "/api/version") {
        const body = JSON.stringify(await versionReport(root));
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return prevFetch(input, init);
    }) as typeof globalThis.fetch;
  }
  try {
    const program = new Command();
    program.exitOverride();
    registerVersionCommand(program.command("version"), getMessages("en"));
    const { out } = await captureStdout(() => program.parseAsync(argv, { from: "user" }));
    return out;
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.PENGUIN_API_URL;
    else process.env.PENGUIN_API_URL = prevUrl;
    if (listener) {
      await new Promise<void>((resolve) => listener!.close(() => resolve()));
    }
  }
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
    // What the version line cannot carry: the store describes the ROOT, not this process,
    // so it still answers when the packaged CLI runs on a machine holding a pushed one.
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
    // Not `v${version}`: git's tag description names the nearest reachable tag, which lags
    // the constant for the whole of release preparation. `v` and a digit is the guarantee.
    expect(buildInfo().describe).toMatch(/^v\d/);
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

/**
 * `penguin cost` formatting against a stand-in usage endpoint: verifies that sub-tenth-cent
 * non-zero costs keep four significant digits (matching the Web App's `formatMoney`) instead of
 * rounding to `$0.0000`, while zero, `$0.001+`, and unpriced entries keep their existing display.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import type { UsageResponse } from "@prismshadow/penguin-library-observability";
import { registerCostCommand } from "../../src/cli/commands/cost.js";
import { getMessages } from "../../src/cli/i18n.js";

let server: http.Server;
let base: string;
let home: string;
let prevHome: string | undefined;
let usagePayload: UsageResponse;

function bucket(overrides: Partial<UsageResponse["summary"]["today"]> = {}) {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    total: 100,
    requests: 1,
    toolRequests: 0,
    toolCost: null,
    cost: 0,
    hasUncosted: false,
    ...overrides,
  };
}

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cost-cli-"));
  process.env.PENGUIN_HOME = home;
  usagePayload = {
    summary: {
      today: bucket({ cost: 0.0000123 }),
      last7d: bucket({ cost: 0.00045678, hasUncosted: true }),
      total: bucket({ cost: 0.001 }),
    },
    groupBy: "model",
    groups: [
      {
        key: "m-tiny",
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 10,
        requests: 1,
        cost: 0.00000005,
        hasUncosted: false,
      },
      {
        key: "m-zero",
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 0,
        requests: 0,
        cost: 0,
        hasUncosted: false,
      },
      {
        key: "m-zero-uncosted",
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 50,
        requests: 1,
        cost: 0,
        hasUncosted: true,
      },
      {
        key: "m-regular",
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 2048,
        requests: 4,
        cost: 1.25,
        hasUncosted: false,
      },
      {
        key: "m-unpriced",
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 500,
        requests: 2,
        cost: null,
        hasUncosted: true,
      },
    ],
    granularity: "day",
    series: [],
    byAgentSeries: [],
    byModelSeries: [],
    agentIds: [],
    models: [],
    tools: [],
    errors: { total: 0, unexpected: 0, topCode: null, recent: [], rows: 0 },
  };
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && /^\/api\/projects\/[^/]+\/usage$/.test(url.pathname)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(usagePayload));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "Not found." } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  process.exitCode = undefined;
});

async function runCost(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = "";
  let stderr = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const root = new Command().exitOverride();
    const costCmd = root.command("cost");
    registerCostCommand(costCmd, getMessages("en"));
    await root.parseAsync(["cost", ...args, "--server", base], { from: "user" });
    return { stdout, stderr, code: Number(process.exitCode ?? 0) };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("penguin cost formatting", () => {
  it("formats sub-tenth-cent non-zero costs with four significant digits in the summary card", async () => {
    const res = await runCost([]);
    expect(res.code).toBe(0);
    expect(res.stderr).toBe("");
    expect(res.stdout).toMatch(/today\s+100\s+1\s+\$0\.0000123\b/);
    expect(res.stdout).not.toMatch(/\$0\.0000\b/);
    expect(res.stdout).toMatch(/last 7 days\s+100\s+1\s+\$0\.0004568\+/);
    expect(res.stdout).toMatch(/total\s+100\s+1\s+\$0\.0010\b/);
  });

  it("preserves sub-tenth-cent precision without scientific notation and keeps zero, regular, and unpriced rows", async () => {
    const res = await runCost(["--by", "model"]);
    expect(res.code).toBe(0);
    expect(res.stderr).toBe("");
    expect(res.stdout).toContain("$0.00000005");
    expect(res.stdout).not.toContain("e-");
    expect(res.stdout).toMatch(/m-zero\s+0\s+0\s+\$0\.0000\b/);
    expect(res.stdout).toMatch(/m-zero-uncosted\s+50\s+1\s+\$0\.0000\+/);
    expect(res.stdout).toMatch(/m-regular\s+2k\s+4\s+\$1\.2500/);
    expect(res.stdout).toMatch(/m-unpriced\s+500\s+2\s+-/);
  });
});

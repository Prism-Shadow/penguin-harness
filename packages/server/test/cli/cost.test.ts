/**
 * penguin cost displays the usage response in two forms:
 * - In a summary, small charges retain significant digits and a partially priced total keeps its +.
 * - In a grouped table, tiny charges stay legible alongside zero, regular, and unpriced rows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import type { UsageResponse } from "@prismshadow/penguin-library-observability";
import { registerCostCommand } from "../../src/cli/commands/cost.js";
import { getMessages } from "../../src/cli/i18n.js";
import { jsonResponse, stubFetch } from "../fixtures/fetch.js";

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

const usagePayload: UsageResponse = {
  summary: {
    today: bucket({ cost: 0.0000123 }),
    last7d: bucket({ cost: 0.00045678, hasUncosted: true }),
    total: bucket({ cost: 0.001 }),
  },
  groupBy: "model",
  groups: [
    { key: "m-tiny", ...bucket({ total: 10, cost: 0.00000005 }) },
    { key: "m-zero", ...bucket({ total: 0, requests: 0 }) },
    { key: "m-zero-uncosted", ...bucket({ total: 50, hasUncosted: true }) },
    { key: "m-regular", ...bucket({ total: 2048, requests: 4, cost: 1.25 }) },
    { key: "m-unpriced", ...bucket({ total: 500, requests: 2, cost: null, hasUncosted: true }) },
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function runCost(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  vi.stubEnv("PENGUIN_API_TOKEN", "test-token");
  stubFetch(({ url, method }) => {
    if (method !== "GET" || new URL(url).pathname !== "/api/projects/test/usage") {
      throw new Error(`Unexpected request: ${method} ${url}`);
    }
    return jsonResponse(usagePayload);
  });
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
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
    await root.parseAsync(
      ["cost", ...args, "--server", "http://localhost", "--project-id", "test"],
      { from: "user" },
    );
    return { stdout, stderr, code: Number(process.exitCode ?? 0) };
  } finally {
    process.exitCode = previousExitCode;
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
    expect(res.stdout).toMatch(/m-tiny\s+10\s+1\s+\$0\.00000005\b/);
    expect(res.stdout).toMatch(/m-zero\s+0\s+0\s+\$0\.0000\b/);
    expect(res.stdout).toMatch(/m-zero-uncosted\s+50\s+1\s+\$0\.0000\+/);
    expect(res.stdout).toMatch(/m-regular\s+2k\s+4\s+\$1\.2500/);
    expect(res.stdout).toMatch(/m-unpriced\s+500\s+2\s+-/);
  });
});

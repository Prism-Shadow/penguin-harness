/**
 * `penguin storage` against a stand-in server on a loopback port: what the command asks for,
 * what it removes, and what it prints.
 *
 * - Given a review with two ticked items and one unticked, `clean` lists all three, marks the two,
 *   says how to remove them, and sends no removal.
 * - With `--yes` it removes the two ticked ones in the review's idle age; with `--all --yes
 *   --older-than 30` it reviews at 30 days and removes all three.
 * - Given a measurement under way, `penguin storage` waits for it to end and prints its figures.
 * - Given a removal the server refuses for want of a person's sign-in, it says what to do and
 *   exits 1.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import type { StorageCleanupItem, StorageCleanupReview, StorageUsage } from "../src/types.js";
import { registerStorageCommand } from "../src/cli/storage.js";
import { storageEn, type StorageMessages } from "../src/cli/storage.messages.js";

const MB = 1024 ** 2;
const ZERO = {
  traces: 0,
  agentState: 0,
  workspaces: 0,
  scratchpads: 0,
  caches: 0,
  logs: 0,
  plugins: 0,
  other: 0,
};

function item(id: string, kind: StorageCleanupItem["kind"], selected: boolean): StorageCleanupItem {
  return {
    id,
    kind,
    reason: kind === "agentCache" ? "idle" : "orphan",
    projectId: "default_project",
    projectName: "Default",
    agentId: "default_agent",
    agentName: "General Agent",
    name: kind === "scratchpad" ? "s-1" : `${kind}-dir`,
    bytes: 2 * MB,
    lastModifiedAt: "2026-11-01T08:00:00.000Z",
    selected,
  };
}

const ITEMS = [
  item("scratchpad/1", "scratchpad", true),
  item("workspace/1", "workspace", true),
  item("agentCache/1", "agentCache", false),
];

/** A stand-in for the CLI host's bundle: only what the storage command reads of it. */
const messages: StorageMessages = {
  language: "en",
  common: { json: "json", server: "server" },
  client: new Proxy({} as StorageMessages["client"], {
    get: (_target, key) => () => `client: ${String(key)}`,
  }),
  ...storageEn,
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

let server: http.Server;
let base: string;
let sent: Sent[];
let home: string;
let prevHome: string | undefined;
/** The answer to a removal; a function of the request body. */
let removal: (body: { items: string[] }) => { status: number; body: unknown };
/** The usage reads still to answer as measuring. */
let measuringReads: number;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-storage-cli-"));
  process.env.PENGUIN_HOME = home;
  sent = [];
  measuringReads = 0;
  removal = (body) => ({
    status: 200,
    body: { removed: body.items.length, bytes: body.items.length * 2 * MB, skipped: [] },
  });
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body: unknown = raw === "" ? undefined : JSON.parse(raw);
      sent.push({ method: req.method ?? "", url: req.url ?? "", body });
      const answer = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/api/me/storage/cleanup") {
        const review: StorageCleanupReview = {
          measuredAt: "2026-11-20T08:00:00.000Z",
          olderThanDays: Number(url.searchParams.get("olderThanDays") ?? 7),
          items: ITEMS,
        };
        return answer(200, review);
      }
      if (req.method === "POST" && url.pathname === "/api/me/storage/cleanup") {
        const { status, body: value } = removal(body as { items: string[] });
        return answer(status, value);
      }
      if (req.method === "GET" && url.pathname === "/api/me/storage") {
        const measuring = measuringReads > 0;
        if (measuring) measuringReads -= 1;
        const usage: StorageUsage = {
          measuredAt: measuring ? null : "2026-11-20T08:00:00.000Z",
          measuring,
          bytes: measuring ? 0 : 6 * MB,
          categories: measuring ? ZERO : { ...ZERO, traces: 4 * MB, scratchpads: 2 * MB },
          projects: [],
          reveal: false,
        };
        return answer(200, usage);
      }
      answer(404, { error: { code: "not_found", message: "Not found." } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
});

/** Runs `penguin storage …`, capturing stdout, stderr and the exit code. */
async function run(args: string[]): Promise<{ out: string; err: string; code: number }> {
  const program = new Command();
  program.exitOverride();
  registerStorageCommand(program.command("storage"), messages);
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(["node", "penguin", "storage", ...args, "--server", base]);
    return { out: out.join(""), err: err.join(""), code: Number(process.exitCode ?? 0) };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExitCode;
  }
}

const removals = () => sent.filter((r) => r.method === "POST");

describe("penguin storage clean", () => {
  it("lists the review, marks what a removal would take, and removes nothing", async () => {
    const { out, err, code } = await run(["clean"]);
    expect(code, err).toBe(0);
    const rows = out.split("\n").filter((line) => line.includes("General Agent"));
    expect(rows).toHaveLength(3);
    expect(rows.filter((line) => line.startsWith("x "))).toHaveLength(2);
    expect(out).toContain(storageEn.storage.wouldRemove(2, "4 MB", 3));
    expect(removals()).toEqual([]);
  });

  it("removes the ticked items with --yes, in the review's idle age", async () => {
    const { out, err, code } = await run(["clean", "--yes"]);
    expect(code, err).toBe(0);
    expect(removals().map((r) => r.body)).toEqual([
      { items: ["scratchpad/1", "workspace/1"], olderThanDays: 7 },
    ]);
    expect(out).toContain(storageEn.storage.removed(2, "4 MB", 0, 0));
  });

  it("reviews at the age asked and removes every item with --all --yes", async () => {
    await run(["clean", "--all", "--yes", "--older-than", "30"]);
    expect(sent[0]?.url).toBe("/api/me/storage/cleanup?olderThanDays=30");
    expect(removals().map((r) => r.body)).toEqual([
      { items: ["scratchpad/1", "workspace/1", "agentCache/1"], olderThanDays: 30 },
    ]);
  });

  it("says what a person does when the server wants their sign-in", async () => {
    removal = () => ({
      status: 403,
      body: { error: { code: "human_required", message: "This takes a person's sign-in." } },
    });
    const { err, code } = await run(["clean", "--yes"]);
    expect(code).toBe(1);
    expect(err).toContain("error: human_required:");
    expect(err).toContain("penguin auth login");
  });
});

describe("penguin storage", () => {
  it("waits for the measurement under way and prints its figures", async () => {
    measuringReads = 2;
    const { out, err, code } = await run([]);
    expect(code, err).toBe(0);
    expect(sent.filter((r) => r.url === "/api/me/storage")).toHaveLength(3);
    const traces = out
      .split("\n")
      .find((line) => line.startsWith(storageEn.storage.categories.traces));
    expect(traces).toMatch(/\b4 MB$/);
    expect(out).toContain("6 MB");
    expect(out).not.toContain(storageEn.storage.measuringNote);
  });
});

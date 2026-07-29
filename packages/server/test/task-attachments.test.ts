/**
 * Integration tests for composer file attachments (POST /api/sessions/:id/tasks with a
 * `{type:"file"}` input part):
 *   - the bytes land in the Session scratchpad and the Prompt gains an
 *     `[attached file: <path>]` line, so the model reaches the file by path;
 *   - a files-only Prompt still reaches the model (the lines become the message);
 *   - two uploads of the same name coexist instead of overwriting each other;
 *   - malformed parts are 400s, an oversize file is a 413, and goal mode rejects
 *     attachments before anything is written.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, scratchpadDir } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { MAX_ATTACHMENT_BYTES } from "../src/services/task-attachments.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-29-10-00-00-aabb0001";
const PROJECT_ID = "attacher-default_project";

/** Fake Session that records each run's input and finishes immediately (no LLM, no approvals). */
function recordingFakeSession(sessionId: string, runs: OmniMessage[][]): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(input: OmniMessage[]) {
      runs.push(input);
      yield assistantText("done");
    },
    async *compact() {},
  };
}

/** Base64 data URL of some bytes, the shape the composer submits. */
function dataUrl(content: string, mime = "application/octet-stream"): string {
  return `data:${mime};base64,${Buffer.from(content).toString("base64")}`;
}

/** All text of a recorded Prompt, joined the way the model would read it. */
function promptText(input: OmniMessage[]): string {
  return input
    .map((m) => (m.payload as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n");
}

describe("task input file attachments", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let runs: OmniMessage[][];
  let dir: string;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "attacher");
    api = apiClient(t.app, cookie);
    const row: SessionRow = {
      sessionId: SID,
      projectId: PROJECT_ID,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    runs = [];
    t.deps.manager.adopt(row, recordingFakeSession(SID, runs));
    dir = path.join(scratchpadDir(t.root, PROJECT_ID, "default_agent"), SID);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("writes the file into the session scratchpad and appends the marker line to the text", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "look at this" },
        { type: "file", fileName: "report.pdf", dataUrl: dataUrl("PDF-BYTES") },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const text = promptText(runs[0]!);
    const marker = /\[attached file: (.+)\]/.exec(text);
    expect(marker).not.toBeNull();
    const filePath = marker![1]!;
    expect(filePath).toBe(path.join(dir, "report.pdf"));
    expect(await fs.readFile(filePath, "utf8")).toBe("PDF-BYTES");
    // The line trails the user's own text — it must not replace or reframe the message.
    expect(text.startsWith("look at this")).toBe(true);
    // One text message carries both (no extra message per file).
    expect(runs[0]!).toHaveLength(1);
  });

  it("files-only input becomes a message of attachment lines; same names do not overwrite", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "file", fileName: "notes.txt", dataUrl: dataUrl("first") },
        { type: "file", fileName: "notes.txt", dataUrl: dataUrl("second") },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const paths = [...promptText(runs[0]!).matchAll(/\[attached file: (.+)\]/g)].map((m) => m[1]!);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(path.join(dir, "notes.txt"));
    // The second upload gets a random suffix rather than clobbering the first.
    expect(paths[1]).not.toBe(paths[0]);
    expect(path.basename(paths[1]!)).toMatch(/^notes-[0-9a-f]{6}\.txt$/);
    expect(await fs.readFile(paths[0]!, "utf8")).toBe("first");
    expect(await fs.readFile(paths[1]!, "utf8")).toBe("second");
  });

  it("unsafe characters in the name are sanitized, keeping the extension", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "file", fileName: "my report (final).csv", dataUrl: dataUrl("a,b") }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    const filePath = /\[attached file: (.+)\]/.exec(promptText(runs[0]!))![1]!;
    expect(path.basename(filePath)).toBe("my-report--final-.csv");
    expect(await fs.readFile(filePath, "utf8")).toBe("a,b");
  });

  it("accepts a data URL whose media type carries parameters", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        {
          type: "file",
          fileName: "notes.txt",
          dataUrl: dataUrl("hello", "text/plain;charset=utf-8"),
        },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    const filePath = /\[attached file: (.+)\]/.exec(promptText(runs[0]!))![1]!;
    expect(await fs.readFile(filePath, "utf8")).toBe("hello");
  });

  it("malformed parts are 400s and write nothing", async () => {
    const bad = [
      { type: "file", dataUrl: dataUrl("x") }, // no fileName
      { type: "file", fileName: "", dataUrl: dataUrl("x") },
      { type: "file", fileName: "../escape.txt", dataUrl: dataUrl("x") },
      { type: "file", fileName: "sub/dir.txt", dataUrl: dataUrl("x") },
      { type: "file", fileName: "a.txt", dataUrl: "https://example.com/a.txt" },
      { type: "file", fileName: "a.txt", dataUrl: "data:text/plain,not-base64" },
      { type: "file", fileName: "a.txt" }, // no dataUrl
      { type: "blob", fileName: "a.txt", dataUrl: dataUrl("x") }, // unknown part type
    ];
    for (const part of bad) {
      const res = await api.post(`/api/sessions/${SID}/tasks`, { input: [part] });
      expect(res.status, JSON.stringify(part)).toBe(400);
    }
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("a file over the per-file cap is a 413", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        {
          type: "file",
          fileName: "big.bin",
          dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(
            MAX_ATTACHMENT_BYTES + 1,
          ).toString("base64")}`,
        },
      ],
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("file_too_large");
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it("goal mode rejects attachments before anything is written", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "ship the report" },
        { type: "file", fileName: "spec.md", dataUrl: dataUrl("# spec") },
      ],
      goal: {},
    });
    expect(res.status).toBe(400);
    await expect(fs.access(dir)).rejects.toThrow();
  });
});

/**
 * Integration tests for composer file attachments (POST /api/sessions/:id/tasks with a
 * `{type:"file"}` input part):
 *   - the bytes land in the Session scratchpad and the Prompt gains an
 *     `[attached file: <path>]` line, so the model reaches the file by path;
 *   - a files-only Prompt still reaches the model (the lines become the message), including
 *     when the only text message is a `[handoff_from]` origin block that must stay parseable;
 *   - two uploads of the same name coexist instead of overwriting each other;
 *   - malformed parts are 400s, an oversize file / too many files / too many bytes are 413s,
 *     and goal mode rejects attachments before anything is written;
 *   - nothing survives a request that does not end up starting a Task, and a scratchpad
 *     directory that resolves outside the Agent's scratchpad root is refused outright.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  buildHandoffMessage,
  modelVisiblePath,
  parseHandoffMessage,
  scratchpadDir,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { MAX_ATTACHMENT_COUNT } from "../src/services/attachment-limits.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-29-10-00-00-aabb0001";
const PROJECT_ID = "attacher-default_project";

/**
 * Deliberately tiny limits for the cap tests (see beforeEach), in whole MB and in bytes. The
 * total is kept below twice the per-file cap so that "two individually legal files that together
 * cross the aggregate" is expressible — with total >= 2x per-file, each half would trip the
 * per-file check first and the aggregate cap would never be the thing under test.
 */
const TEST_MAX_MB = 2;
const TEST_TOTAL_MB = 3;
const TEST_MAX_BYTES = TEST_MAX_MB * 1024 * 1024;
const TEST_TOTAL_BYTES = TEST_TOTAL_MB * 1024 * 1024;

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

/** Fake Session whose run parks until `until` resolves, so the Session stays busy while the test posts. */
function parkingFakeSession(sessionId: string, until: Promise<void>): RuntimeSession {
  return {
    ...recordingFakeSession(sessionId, []),
    async *run() {
      await until;
      yield assistantText("done");
    },
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
  let row: SessionRow;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "attacher");
    api = apiClient(t.app, cookie);
    row = {
      sessionId: SID,
      projectId: PROJECT_ID,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    runs = [];
    t.deps.manager.adopt(row, recordingFakeSession(SID, runs));
    dir = path.join(scratchpadDir(t.root, PROJECT_ID, "default_agent"), SID);
    // The shipped defaults are 100MB/120MB — allocating buffers that size to prove a cap works
    // would cost hundreds of megabytes per assertion. The caps are read from the settings repo
    // per request, so the tests turn them down instead: that also makes these the tests of the
    // *configured* limit rather than of a compiled-in constant.
    t.deps.serverSettingsRepo.setAttachmentMaxMb(TEST_MAX_MB);
    t.deps.serverSettingsRepo.setAttachmentTotalMb(TEST_TOTAL_MB);
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
    // Marker lines carry the model-visible spelling (forward slashes on Windows).
    expect(filePath).toBe(modelVisiblePath(path.join(dir, "report.pdf")));
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
    expect(paths[0]).toBe(modelVisiblePath(path.join(dir, "notes.txt")));
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

  it("keeps a non-ASCII name instead of flattening it, and caps the stem by UTF-8 bytes", async () => {
    // A CJK character costs three bytes: 40 of them are 120 bytes, well past the 80-byte cap,
    // so the name is cut on a character boundary rather than mid-character (a split would leave
    // an invalid sequence on disk and an unopenable path in the message).
    const long = "报".repeat(40);
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "file", fileName: "报告 2026.pdf", dataUrl: dataUrl("cjk") },
        { type: "file", fileName: `${long}.txt`, dataUrl: dataUrl("long") },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const paths = [...promptText(runs[0]!).matchAll(/\[attached file: (.+)\]/g)].map((m) => m[1]!);
    // The words survive; only the space (shell-hostile, and ASCII) is replaced.
    expect(path.basename(paths[0]!)).toBe("报告-2026.pdf");
    expect(await fs.readFile(paths[0]!, "utf8")).toBe("cjk");
    const capped = path.basename(paths[1]!);
    expect(capped).toBe(`${"报".repeat(26)}.txt`);
    expect(Buffer.byteLength(capped.slice(0, capped.length - 4))).toBeLessThanOrEqual(80);
    expect(await fs.readFile(paths[1]!, "utf8")).toBe("long");
  });

  it("prefixes a Windows device name and falls back when the stem sanitizes away", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "file", fileName: "con.txt", dataUrl: dataUrl("device") },
        // Zero-width joiner only (spelled by code point — an invisible character in the source
        // would read as an empty string): category C, so nothing is left to name the file with.
        {
          type: "file",
          fileName: `${String.fromCodePoint(0x200d)}.bin`,
          dataUrl: dataUrl("invisible"),
        },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const paths = [...promptText(runs[0]!).matchAll(/\[attached file: (.+)\]/g)].map((m) => m[1]!);
    expect(path.basename(paths[0]!)).toBe("_con.txt");
    expect(path.basename(paths[1]!)).toBe("file.bin");
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
            TEST_MAX_BYTES + 1,
          ).toString("base64")}`,
        },
      ],
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("file_too_large");
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it("what /api/me advertises is exactly what the upload path enforces", async () => {
    // The composer refuses an oversize pick using the number this endpoint hands it, so the two
    // must agree on the boundary itself, not merely be "about the same". A file of exactly the
    // advertised limit has to be accepted and one byte more has to be refused — if the server
    // were stricter by a byte, the composer would upload a file the server then rejects, which is
    // precisely the failure the client-side check exists to prevent.
    const me = (await api.get("/api/me")).clone();
    const { uploadLimits } = (await me.json()) as {
      uploadLimits: { attachmentMaxMb: number; attachmentTotalMb: number; imageMaxMb: number };
    };
    expect(uploadLimits.attachmentMaxMb).toBe(TEST_MAX_MB);
    expect(uploadLimits.attachmentTotalMb).toBe(TEST_TOTAL_MB);

    const atLimit = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        {
          type: "file",
          fileName: "exact.bin",
          dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(
            uploadLimits.attachmentMaxMb * 1024 * 1024,
          ).toString("base64")}`,
        },
      ],
    });
    expect(atLimit.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const overLimit = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        {
          type: "file",
          fileName: "over.bin",
          dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(
            uploadLimits.attachmentMaxMb * 1024 * 1024 + 1,
          ).toString("base64")}`,
        },
      ],
    });
    expect(overLimit.status).toBe(413);
  });

  it("an inline image over its own cap is a 413, and the cap does not follow the attachment limit", async () => {
    // Images are bounded separately and far lower: they enter the conversation and the Trace,
    // where the bytes are paid again on every history page and every resume. Raising the
    // attachment ceiling must not raise this one — so the image here is well under the
    // attachment cap that the surrounding suite configured, and still refused.
    const me = (await api.get("/api/me")).clone();
    const { uploadLimits } = (await me.json()) as { uploadLimits: { imageMaxMb: number } };
    const oversize = Buffer.alloc(uploadLimits.imageMaxMb * 1024 * 1024 + 1).toString("base64");
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "image_url", imageUrl: `data:image/png;base64,${oversize}` }],
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("image_too_large");
    expect(runs).toHaveLength(0);
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

  it("files with only a handoff origin block: the block stays parseable, the lines get their own message", async () => {
    // The composer's "attachments, no text, staged /agent handoff" shape. `[handoff_from]` only
    // parses when the block is the WHOLE message, so appending the marker line to it would put
    // the raw block in a user bubble instead of a one-line banner.
    const block = buildHandoffMessage({ agentId: "alpha", agentName: "Alpha", sessionId: "s0" });
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: block },
        { type: "file", fileName: "notes.txt", dataUrl: dataUrl("hi") },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const texts = runs[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(block);
    expect(parseHandoffMessage(texts[0]!)?.agentId).toBe("alpha");
    expect(texts[1]).toBe(`[attached file: ${modelVisiblePath(path.join(dir, "notes.txt"))}]`);
  });

  it("more than the per-request file count is a 413 and writes nothing", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, (_, i) => ({
        type: "file",
        fileName: `f${i}.txt`,
        dataUrl: dataUrl("x"),
      })),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("too_many_files");
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("more than the per-request total size is a 413 and writes nothing", async () => {
    // Two files, each individually legal, that together cross the aggregate cap: the per-file
    // check alone would let this through and land both on disk.
    const half = Buffer.alloc(Math.floor(TEST_TOTAL_BYTES / 2) + 1).toString("base64");
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        {
          type: "file",
          fileName: "a.bin",
          dataUrl: `data:application/octet-stream;base64,${half}`,
        },
        {
          type: "file",
          fileName: "b.bin",
          dataUrl: `data:application/octet-stream;base64,${half}`,
        },
      ],
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("a busy session without queueIfBusy 409s before the upload is written", async () => {
    // Without the pre-check the files land first and the 409 comes after, so the user's retry
    // (the Web keeps the chips on failure) would deposit a second copy of every one of them.
    let release = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, parkingFakeSession(SID, parked));
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "busy" }] });
    await waitFor(() => t.deps.manager.statusOf(SID) === "running");

    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "file", fileName: "late.txt", dataUrl: dataUrl("bytes") }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("task_in_progress");
    await expect(fs.access(dir)).rejects.toThrow();
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });
});

describe("task attachments are removed when the Task never starts", () => {
  const FAIL_SID = "session-2026-07-29-11-00-00-aabb0002";
  const PID = "failer-default_project";
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let dir: string;

  beforeEach(async () => {
    // Never adopted into the active table, so startTask goes through the loader — which throws
    // here. That is the window the route's cleanup exists for: the pre-check cannot see a
    // session it hasn't loaded, so the files are already on disk when the failure happens.
    t = await createTestApp({
      loader: {
        load: async () => {
          throw new Error("loader unavailable");
        },
      },
    });
    const { cookie } = await provisionUser(t.app, "failer");
    api = apiClient(t.app, cookie);
    t.deps.sessionsRepo.insert({
      sessionId: FAIL_SID,
      projectId: PID,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    dir = path.join(scratchpadDir(t.root, PID, "default_agent"), FAIL_SID);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a failure after the write leaves no orphaned bytes behind", async () => {
    const res = await api.post(`/api/sessions/${FAIL_SID}/tasks`, {
      input: [
        { type: "file", fileName: "a.txt", dataUrl: dataUrl("first") },
        { type: "file", fileName: "b.txt", dataUrl: dataUrl("second") },
      ],
    });
    expect(res.status).toBe(500);
    // The directory may remain (it is the Session's own and is deleted with it); the point is
    // that a retry cannot find a stale `a-<hex>.txt` next to its own upload.
    expect(await fs.readdir(dir).catch(() => [])).toEqual([]);
  });
});

describe("scratchpad directory containment", () => {
  const LINK_SID = "session-2026-07-29-12-00-00-aabb0003";
  const PID = "linker-default_project";
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outside: string;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "linker");
    api = apiClient(t.app, cookie);
    t.deps.sessionsRepo.insert({
      sessionId: LINK_SID,
      projectId: PID,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    t.deps.manager.adopt(
      t.deps.sessionsRepo.findById(LINK_SID)!,
      recordingFakeSession(LINK_SID, []),
    );
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-outside-"));
  });
  afterEach(async () => {
    await fs.rm(outside, { recursive: true, force: true });
    await t.cleanup();
  });

  // Symlink creation needs a privilege or developer mode on Windows; the containment rule
  // itself is platform-independent.
  it.skipIf(process.platform === "win32")(
    "a session directory symlinked out of the scratchpad root is refused, not written through",
    async () => {
      const root = scratchpadDir(t.root, PID, "default_agent");
      await fs.mkdir(root, { recursive: true });
      // `fs.mkdir(dir, {recursive:true})` succeeds silently on an existing symlink-to-directory,
      // so without the realpath check the upload would land in `outside`.
      await fs.symlink(outside, path.join(root, LINK_SID), "dir");
      const res = await api.post(`/api/sessions/${LINK_SID}/tasks`, {
        input: [{ type: "file", fileName: "escape.txt", dataUrl: dataUrl("bytes") }],
      });
      expect(res.status).toBe(500);
      expect(await fs.readdir(outside)).toEqual([]);
    },
  );
});

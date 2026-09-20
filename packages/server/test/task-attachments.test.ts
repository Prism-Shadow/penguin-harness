/**
 * Composer file attachments: POST /api/sessions/:id/tasks with `{type:"file"}` input parts.
 *
 * - The bytes land in the Session's scratchpad and the Prompt gains an `[attached file: <path>]`
 *   line after the user's text, so the model reaches the file by path.
 * - A files-only Prompt still reaches the model (the lines become the message), and a Prompt
 *   whose only text is a `[handoff_from]` origin block keeps that block parseable.
 * - Two uploads of one name coexist; unsafe names are sanitized (keeping the extension,
 *   non-ASCII kept, the stem capped by UTF-8 bytes, Windows device names prefixed).
 * - A media type with parameters is accepted; malformed parts are 400s and write nothing.
 * - More files than one message may name is a 413 that writes nothing. There is no size limit
 *   to test: a file's bytes go to disk and come back through the model's own file tools.
 * - Goal mode, and a busy Session without queueIfBusy, refuse before anything is written.
 * - A Task that never starts leaves no orphaned bytes, and a scratchpad directory resolving
 *   outside the Agent's scratchpad root is refused, not written through.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { MAX_ATTACHMENT_COUNT } from "../src/services/task-attachments.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT_ID = "attacher-default_project";

/** Fake Session that records each run's input and finishes immediately (no LLM, no approvals). */
function recordingFakeSession(sessionId: string, runs: OmniMessage[][]): RuntimeSession {
  return fakeSession(sessionId, {
    async *run(input: OmniMessage[]) {
      runs.push(input);
      yield assistantText("done");
    },
  });
}

/** Fake Session whose run parks until `until` resolves, so the Session stays busy while the test posts. */
function parkingFakeSession(sessionId: string, until: Promise<void>): RuntimeSession {
  return fakeSession(sessionId, {
    async *run() {
      await until;
      yield assistantText("done");
    },
  });
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
  let SID: string;
  let runs: OmniMessage[][];
  let dir: string;
  let row: SessionRow;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "attacher")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    row = adoptSession(t.deps, recordingFakeSession(SID, runs), { projectId: PROJECT_ID });
    dir = path.join(scratchpadDir(t.root, PROJECT_ID, "default_agent"), SID);
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

  it("a large inline image is accepted: the browser shrinks it, the server does not refuse it", async () => {
    // The 20MB refusal is gone with the rest of the size limits. What keeps an inline image from
    // becoming a Session that reopens slowly is the composer's compression, applied before the
    // upload — not a number here, which would also have bound the API clients that have no
    // composer to compress with.
    const big = Buffer.alloc(24 * 1024 * 1024).toString("base64");
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "image_url", imageUrl: `data:image/png;base64,${big}` }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
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

  // Symlink creation needs a privilege or developer mode on Windows; the containment rule
  // itself is platform-independent.
  it.skipIf(process.platform === "win32")(
    "a session directory symlinked out of the scratchpad root is refused, not written through",
    async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-outside-"));
      try {
        await fs.mkdir(path.dirname(dir), { recursive: true });
        // `fs.mkdir(dir, {recursive:true})` succeeds silently on an existing symlink-to-directory,
        // so without the realpath check the upload would land in `outside`.
        await fs.symlink(outside, dir, "dir");
        const res = await api.post(`/api/sessions/${SID}/tasks`, {
          input: [{ type: "file", fileName: "escape.txt", dataUrl: dataUrl("bytes") }],
        });
        expect(res.status).toBe(500);
        expect(await fs.readdir(outside)).toEqual([]);
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    },
  );
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
    t.deps.sessionsRepo.insert(sessionRow(FAIL_SID, { projectId: PID }));
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

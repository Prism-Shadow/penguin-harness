/**
 * Whole-request gzip for attachment-bearing requests (#521).
 *
 * The composer may send the identical task/steer JSON body gzipped
 * (`Content-Type: application/json` plus `Content-Encoding: gzip`); the server inflates it
 * before parsing, under bounds derived from the CURRENT per-request admin attachment
 * budget. These tests post real gzip bodies at the HTTP layer and require:
 * - byte fidelity: an attachment that goes in gzipped lands on disk identical;
 * - task AND steer routes decode; ordinary (uncompressed) clients are untouched;
 * - only single `gzip` is decoded (anything else stacked or named is a 415);
 * - corrupt, truncated, or empty gzip is a 400 with nothing written and no run started;
 * - an inflated body past the derived bound is a 413, enforced DURING decompression
 *   (a decompression bomb), and the compressed wire bytes stay under the body cap;
 * - attachment validation still sees the inflated bytes (a gzipped over-budget file is
 *   still a 413, not a smuggled write).
 *
 * Budgets are turned to their floor like the attachment suite does, so the derived caps
 * stay cheap to reach and these remain tests of the configured limits, not constants.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, scratchpadDir } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { bodyLimitBytes, MIN_ATTACHMENT_MB } from "../src/services/attachment-limits.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-29-13-00-00-aabb0004";
// Project convention the access check relies on: provisionUser("gzipper") owns
// "gzipper-default_project" (same <user>-default_project shape the other suites use).
const PROJECT_ID = "gzipper-default_project";
const AGENT_ID = "default_agent";
const MB = 1024 * 1024;

/** Base64 data URL of some text, the shape the composer submits. */
function dataUrl(content: string, mime = "text/plain"): string {
  return `data:${mime};base64,${Buffer.from(content).toString("base64")}`;
}

/** Fake Session that records each run's input and finishes immediately. */
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

/**
 * Fake Session whose run parks until released, so the Session stays busy for steering,
 * and whose steer hook accepts, the way a real running Session does.
 */
function steerableParkingSession(sessionId: string, until: Promise<void>): RuntimeSession {
  return {
    ...recordingFakeSession(sessionId, []),
    steer: () => true,
    async *run() {
      await until;
      yield assistantText("done");
    },
  };
}

function promptText(input: OmniMessage[]): string {
  return input
    .map((m) => (m.payload as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n");
}

describe("gzipped task and steer requests", () => {
  let t: TestApp;
  let cookie: string;
  let runs: OmniMessage[][];
  let dir: string;
  let row: SessionRow;
  /** The inflated bound implied by the floor budget set in beforeEach. */
  let inflatedCap: number;

  const postGzip = (
    urlPath: string,
    jsonBody: unknown,
    extraHeaders: Record<string, string> = {},
  ) => {
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(jsonBody), "utf8"));
    return t.app.request(urlPath, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "content-encoding": "gzip",
        ...extraHeaders,
      },
      body: gzipped,
    });
  };

  const postRawGzip = (urlPath: string, raw: Uint8Array, encoding = "gzip") =>
    t.app.request(urlPath, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "content-encoding": encoding },
      body: raw,
    });

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "gzipper"));
    row = {
      sessionId: SID,
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
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
    dir = path.join(scratchpadDir(t.root, PROJECT_ID, AGENT_ID), SID);
    t.deps.serverSettingsRepo.setAttachmentMaxMb(MIN_ATTACHMENT_MB);
    t.deps.serverSettingsRepo.setAttachmentTotalMb(MIN_ATTACHMENT_MB);
    inflatedCap = bodyLimitBytes({
      attachmentMaxMb: MIN_ATTACHMENT_MB,
      attachmentTotalMb: MIN_ATTACHMENT_MB,
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a gzipped task attachment lands byte-identical with its marker line", async () => {
    const content = "INFO start\n".repeat(20000);
    const res = await postGzip(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "read these logs" },
        { type: "file", fileName: "server.log", dataUrl: dataUrl(content) },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);

    const text = promptText(runs[0]!);
    const marker = /\[attached file: (.+)\]/.exec(text);
    expect(marker).not.toBeNull();
    expect(await fs.readFile(marker![1]!, "utf8")).toBe(content);
    expect(text.startsWith("read these logs")).toBe(true);
  });

  it("a gzipped text-only task decodes: the encoding, not the attachments, selects the path", async () => {
    const res = await postGzip(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "plain hello" }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    expect(promptText(runs[0]!)).toContain("plain hello");
  });

  it("an ordinary uncompressed task is untouched by the gzip path", async () => {
    const api = apiClient(t.app, cookie);
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "look at this" },
        { type: "file", fileName: "notes.txt", dataUrl: dataUrl("plain-bytes") },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    expect(await fs.readFile(path.join(dir, "notes.txt"), "utf8")).toBe("plain-bytes");
  });

  it("explicit identity behaves like no encoding", async () => {
    // Identity labels a PLAIN body: the server must parse it as ordinary JSON.
    const res = await t.app.request(`/api/sessions/${SID}/tasks`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "content-encoding": "identity",
      },
      body: JSON.stringify({ input: [{ type: "text", text: "identity hello" }] }),
    });
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    expect(promptText(runs[0]!)).toContain("identity hello");
  });

  it("a gzipped steer with files queues on the running task with identical bytes", async () => {
    let release = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, steerableParkingSession(SID, parked));
    try {
      const started = await apiClient(t.app, cookie).post(`/api/sessions/${SID}/tasks`, {
        input: [{ type: "text", text: "busy" }],
      });
      expect(started.status).toBe(202);

      const content = "TRACE 1\n".repeat(20000);
      const res = await postGzip(`/api/sessions/${SID}/steer`, {
        text: "while you are at it",
        files: [{ fileName: "trace.log", dataUrl: dataUrl(content) }],
      });
      expect(res.status).toBe(202);
      expect(await fs.readFile(path.join(dir, "trace.log"), "utf8")).toBe(content);
    } finally {
      release();
    }
  });

  it("a gzipped text-only steer queues", async () => {
    let release = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, steerableParkingSession(SID, parked));
    try {
      const started = await apiClient(t.app, cookie).post(`/api/sessions/${SID}/tasks`, {
        input: [{ type: "text", text: "busy" }],
      });
      expect(started.status).toBe(202);
      const res = await postGzip(`/api/sessions/${SID}/steer`, { text: "nudge nudge" });
      expect(res.status).toBe(202);
    } finally {
      release();
    }
  });

  it("corrupt gzip is a 400 and writes nothing", async () => {
    const res = await postRawGzip(
      `/api/sessions/${SID}/tasks`,
      Buffer.from("this is not gzip at all"),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("truncated gzip is a 400 and writes nothing", async () => {
    const full = zlib.gzipSync(
      Buffer.from(JSON.stringify({ input: [{ type: "text", text: "half" }] }), "utf8"),
    );
    const res = await postRawGzip(`/api/sessions/${SID}/tasks`, full.subarray(0, 10));
    expect(res.status).toBe(400);
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("an empty body under a gzip encoding is a 400, not a crash", async () => {
    const res = await postRawGzip(`/api/sessions/${SID}/tasks`, new Uint8Array(0));
    expect(res.status).toBe(400);
    expect(runs).toHaveLength(0);
  });

  it("valid gzip of a non-object is a 400 like the plain path", async () => {
    const res = await postGzip(`/api/sessions/${SID}/tasks`, [1, 2, 3]);
    expect(res.status).toBe(400);
    expect(runs).toHaveLength(0);
  });

  it("an unsupported coding is a 415", async () => {
    const body = zlib.gzipSync(Buffer.from(JSON.stringify({ input: [] }), "utf8"));
    for (const encoding of ["br", "deflate", "gzip, br"]) {
      const res = await postRawGzip(`/api/sessions/${SID}/tasks`, body, encoding);
      expect(res.status).toBe(415);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unsupported_media_type",
      );
    }
    expect(runs).toHaveLength(0);
  });

  it("a decompression bomb past the derived bound is a 413 with nothing written", async () => {
    // Tens of megabytes of zeros compress to kilobytes: tiny on the wire, past the
    // inflated bound on the way out. The bound must bite DURING decompression.
    const bomb = zlib.gzipSync(Buffer.alloc(inflatedCap + 4 * MB, "z"));
    expect(bomb.length).toBeLessThan(MB);
    const res = await postRawGzip(`/api/sessions/${SID}/tasks`, bomb);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("attachment validation still sees the inflated bytes", async () => {
    // A 2MB file against a 1MB per-file budget, gzipped small: the compressed size must
    // not smuggle it past validation.
    const content = "A".repeat(2 * MB);
    const res = await postGzip(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "file", fileName: "big.bin", dataUrl: dataUrl(content) }],
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("file_too_large");
    await expect(fs.access(dir)).rejects.toThrow();
    expect(runs).toHaveLength(0);
  });

  it("compressed wire bytes past the body cap are refused before decoding", async () => {
    // Incompressible filler under a gzip label: the body cap counts compressed bytes, so
    // this dies in the middleware without ever reaching the inflater.
    const fill = inflatedCap + MB;
    const chunk = Buffer.alloc(64 * 1024, 7);
    let sent = 0;
    let tailWritten = false;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= fill) {
          if (tailWritten) {
            controller.close();
            return;
          }
          tailWritten = true;
          controller.enqueue(chunk.subarray(0, 1));
          return;
        }
        const size = Math.min(chunk.length, fill - sent);
        sent += size;
        controller.enqueue(size === chunk.length ? chunk : chunk.subarray(0, size));
      },
    });
    const res = await t.app.request(`/api/sessions/${SID}/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "content-encoding": "gzip" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
    expect(runs).toHaveLength(0);
  });
});

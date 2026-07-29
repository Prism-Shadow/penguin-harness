/**
 * Global request body cap (`/api/*`, 20MB).
 *
 * The cap used to read `content-length` only, which a chunked request simply does not carry —
 * `Number(undefined ?? 0)` is 0, so a body of any size passed straight through to the sinks
 * behind it (task input images, file attachments, Trace import). These tests post a body with
 * **no declared length** and require the same 413 `payload_too_large` a declared one gets, plus
 * an under-cap streamed body still arriving intact (the cap has to re-feed what it counted).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-29-13-00-00-aabb0004";
const PROJECT_ID = "streamer-default_project";
const MB = 1024 * 1024;

/**
 * A `{"input":[{"type":"text","text":"aaa…"}]}` body delivered as a stream with no
 * `content-length`, `fill` bytes of filler inside the text. Valid JSON on purpose: if the cap
 * ever stops working the request is a plain 202, exactly the shape the review reproduced —
 * not a 400 that would pass a "was rejected" assertion for the wrong reason. Chunks are
 * produced on demand, so the cap aborting mid-body costs only what it actually read.
 */
function streamedTaskBody(fill: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunk = enc.encode("a".repeat(64 * 1024));
  let sent = 0;
  let tailWritten = false;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode('{"input":[{"type":"text","text":"'));
    },
    pull(controller) {
      if (sent >= fill) {
        if (tailWritten) {
          controller.close();
          return;
        }
        tailWritten = true;
        controller.enqueue(enc.encode('"}]}'));
        return;
      }
      const size = Math.min(chunk.length, fill - sent);
      sent += size;
      controller.enqueue(size === chunk.length ? chunk : chunk.subarray(0, size));
    },
  });
}

describe("request body cap", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let cookie: string;
  let runs: OmniMessage[][];

  const postStream = (fill: number) =>
    t.app.request(`/api/sessions/${SID}/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: streamedTaskBody(fill),
      // Required by fetch for a streaming request body; it is also what keeps the request
      // free of a content-length header, which is the case under test.
      duplex: "half",
    } as RequestInit);

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "streamer"));
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
    const session: RuntimeSession = {
      sessionId: SID,
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
    t.deps.manager.adopt(row, session);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a body with no declared length is still capped", async () => {
    const res = await postStream(24 * MB);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
    expect(runs).toHaveLength(0);
  });

  it("a declared over-cap content-length short-circuits before the body is read", async () => {
    // The header fast path, which the streaming case above deliberately cannot reach: the
    // length is declared and the (tiny, valid) body is never looked at.
    const res = await t.app.request(`/api/sessions/${SID}/tasks`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "content-length": String(21 * MB),
      },
      body: JSON.stringify({ input: [{ type: "text", text: "small" }] }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
    expect(runs).toHaveLength(0);
  });

  it("an under-cap streamed body is passed through intact", async () => {
    const res = await postStream(MB);
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    const text = (runs[0]![0]!.payload as { text: string }).text;
    expect(text.length).toBe(MB);
  });
});

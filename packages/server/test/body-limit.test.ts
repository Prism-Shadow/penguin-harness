/**
 * The global request-body cap on `/api/*`.
 *
 * The cap used to read `content-length` only, which a chunked request does not carry, so a
 * body of any size passed straight through to the sinks behind it (task input images, file
 * attachments, Trace import). The cap is derived from the admin-set attachment budget
 * (bodyLimitBytes), so these cases set that budget to its floor and compute the expected cap
 * with the server's own helper — a hardcoded byte count would stop testing the cap the moment
 * the defaults moved.
 *
 * - A streamed body with no declared length over the cap is refused 413 `payload_too_large`,
 *   and no Task starts.
 * - A declared over-cap length is refused before the body is read.
 * - An under-cap streamed body passes through intact (the cap re-feeds what it counted).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { bodyLimitBytes, MIN_ATTACHMENT_MB } from "../src/services/attachment-limits.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

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
  let cookie: string;
  let SID: string;
  let runs: OmniMessage[][];
  /** The body cap implied by the smallest budget an admin can set. */
  let cap: number;

  const postStream = (fill: number) =>
    t.app.request(`/api/sessions/${SID}/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: streamedTaskBody(fill),
      // Required by fetch for a streaming request body; it is also what keeps the request
      // free of a content-length header, which is the case under test.
      duplex: "half",
    } as RequestInit);

  beforeAll(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "streamer"));
    // Smallest budget an admin can set, so the derived cap is as low as it goes and the
    // over-cap body these tests have to stream stays cheap to produce.
    t.deps.serverSettingsRepo.setAttachmentMaxMb(MIN_ATTACHMENT_MB);
    t.deps.serverSettingsRepo.setAttachmentTotalMb(MIN_ATTACHMENT_MB);
    cap = bodyLimitBytes({
      attachmentMaxMb: MIN_ATTACHMENT_MB,
      attachmentTotalMb: MIN_ATTACHMENT_MB,
    });
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    const session = fakeSession(SID, {
      async *run(input: OmniMessage[]) {
        runs.push(input);
        yield assistantText("done");
      },
    });
    adoptSession(t.deps, session, { projectId: "streamer-default_project" });
  });

  it("a body with no declared length is still capped", async () => {
    const res = await postStream(cap + 2 * MB);
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
        "content-length": String(cap + MB),
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

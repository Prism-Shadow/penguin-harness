/**
 * The composer half of `Content-Encoding: gzip` (issue #521): the task and steer posts offer
 * their body gzipped, and `gzipRequestBody` gzips it when gzip makes it smaller.
 *
 * - A large, log-shaped body comes back gzip'd with the `Content-Encoding: gzip` header, and
 *   the bytes decompress back to exactly the original string (lossless — a file attachment
 *   cannot lose a byte, so this is transport coding only, unlike the image path's re-encode).
 * - A small body (the ordinary control call: `{}`, approvals, aborts) is returned untouched.
 * - A body gzip would not shrink is returned untouched: paying a compress pass to add bytes
 *   is worth nothing.
 * - The opt-in sits on the task/steer senders: their fetch defers by the compress pass, no
 *   other call's does.
 */
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { TaskCreateRequest } from "@prismshadow/penguin-server/api";
import { gzipRequestBody } from "../src/api/client";
import { postSteer, postTask } from "../src/api/endpoints";

/** Log-shaped JSON body like a task request carrying file attachments — compresses ~10:1. */
function logishBody(bytes: number): string {
  const parts: string[] = [];
  for (let i = 0; parts.join("").length < bytes; i++) {
    parts.push(
      `{"type":"text","text":"2026-10-15 10:00:${String(i % 60).padStart(2, "0")} INFO req=${i} ok"},`,
    );
  }
  return `{"input":[${parts.join("")}]}`;
}

describe("gzipRequestBody", () => {
  it("gzips a large compressible body, losslessly, and names the encoding", async () => {
    const body = logishBody(256 * 1024);
    const init = await gzipRequestBody({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(init.headers).toMatchObject({ "Content-Encoding": "gzip" });
    const gzipped = init.body as Uint8Array;
    expect(gzipped.byteLength).toBeLessThan(body.length);
    // The point of the feature: the inflated form is the original request, byte for byte.
    expect(gunzipSync(gzipped).toString("utf8")).toBe(body);
  });

  it("returns a small body untouched", async () => {
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: [{ type: "text", text: "hi" }] }),
    };
    expect(await gzipRequestBody(init)).toBe(init);
  });

  it("returns a body untouched when gzip does not make it smaller", async () => {
    // An attached archive of already-compressed bytes (.zip, .jpg, .mp4) comes out of gzip the
    // same size or larger, and the plain body must win then. No string content is reliably
    // incompressible for real (every byte range expressible as text carries redundancy — a
    // uniform random ASCII string still gives up its 2 unused bits), so the transform is held
    // at identity: what this test pins is the size comparison and the plain-body fallback,
    // not zlib.
    vi.stubGlobal(
      "CompressionStream",
      // An identity transform: bytes in, the same bytes out — so the compressed result equals
      // the plain body and the not-smaller branch must fire.
      class {
        t = new TransformStream();
        readable = this.t.readable;
        writable = this.t.writable;
      },
    );
    const body = logishBody(256 * 1024);
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    expect(await gzipRequestBody(init)).toBe(init);
  });
});

describe("the task and steer senders opt in", () => {
  /** Captures what the caller handed to fetch, answering a minimal task-shaped 200. */
  async function capturePost(post: () => Promise<unknown>): Promise<RequestInit> {
    const inits: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      inits.push(init);
      return new Response(JSON.stringify({ sessionId: "s1" }), {
        headers: { "content-type": "application/json" },
      });
    });
    await post();
    expect(inits).toHaveLength(1);
    return inits[0]!;
  }

  it("a large postTask body travels gzip'd and inflates back to the sent JSON", async () => {
    const text = logishBody(64 * 1024);
    const request: TaskCreateRequest = { input: [{ type: "text", text }] };
    const init = await capturePost(() => postTask("s1", request));
    expect((init.headers as Record<string, string>)["Content-Encoding"]).toBe("gzip");
    const sent = JSON.parse(gunzipSync(init.body as Uint8Array).toString("utf8")) as {
      input: { text: string }[];
    };
    expect(sent.input[0]!.text).toBe(text);
  });

  it("a small postTask body stays a plain JSON string, no encoding named", async () => {
    const request: TaskCreateRequest = { input: [{ type: "text", text: "hi" }] };
    const init = await capturePost(() => postTask("s1", request));
    expect((init.headers as Record<string, string>)["Content-Encoding"]).toBeUndefined();
    expect(init.body).toBe(JSON.stringify(request));
  });

  it("a large postSteer body travels gzip'd too (its files parts are the same shape)", async () => {
    const text = logishBody(64 * 1024);
    const init = await capturePost(() => postSteer("s1", { text }));
    expect((init.headers as Record<string, string>)["Content-Encoding"]).toBe("gzip");
    const sent = JSON.parse(gunzipSync(init.body as Uint8Array).toString("utf8")) as {
      text: string;
    };
    expect(sent.text).toBe(text);
  });
});

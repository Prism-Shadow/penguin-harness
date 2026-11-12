// @vitest-environment jsdom
/**
 * The install stream's SSE parser (`sseEvents`, through the real `installPluginStream`):
 * - Named events arrive in order with their joined data payloads.
 * - An event with no name (a comment or a keep-alive) is skipped and the stream keeps going —
 *   the parser never spins on a cut that no longer moves.
 * - An event split across two chunks lands whole.
 * - A stream that ends without a `result` is a network error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "./helpers/fetch";

const { installPluginStream } = await import("../src/api/endpoints");

const encoder = new TextEncoder();

/** A live `text/event-stream` answer the test pushes frames into. */
function streamResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) }),
    { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
  return {
    response,
    send(text: string) {
      controller.enqueue(encoder.encode(text));
    },
    close() {
      controller.close();
    },
  };
}

describe("the install stream's SSE events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an event with no name is skipped and the named events after it still arrive", async () => {
    const stream = stubFetch(() => {
      const live = streamResponse();
      queueMicrotask(() => {
        // A comment and a keep-alive with no event name; then a real event.
        live.send(": ping\n\n");
        live.send("\n");
        live.send("event: download\ndata: {\"received\":10,\"total\":null}\n\n");
        live.send(": again\n\n");
        live.send("event: result\ndata: {\"plugins\":[],\"shipped\":[]}\n\n");
        live.close();
      });
      return live.response;
    });

    const progress: Array<[number, number | null]> = [];
    const result = await installPluginStream("A", "@acme/plugin", null, (received, total) =>
      progress.push([received, total]),
    );
    expect(result).toEqual({ plugins: [], shipped: [] });
    expect(progress).toEqual([[10, null]]);
    expect(stream.requests[0]!.path).toBe("/api/projects/A/plugins");
  });

  it("an event split across two chunks lands whole", async () => {
    stubFetch(() => {
      const live = streamResponse();
      queueMicrotask(() => {
        live.send("event: down");
        live.send("load\ndata: {\"rece");
        live.send("ived\":5,\"total\":50}\n\n");
        live.send("event: result\ndata: {\"plugins\":[],\"shipped\":[]}\n\n");
        live.close();
      });
      return live.response;
    });

    const progress: Array<[number, number | null]> = [];
    await installPluginStream("A", "@acme/plugin", null, (received, total) =>
      progress.push([received, total]),
    );
    expect(progress).toEqual([[5, 50]]);
  });

  it("a stream that ends with no result is a network error", async () => {
    stubFetch(() => {
      const live = streamResponse();
      queueMicrotask(() => {
        live.send("event: npm\ndata: {}\n\n");
        live.close();
      });
      return live.response;
    });

    await expect(installPluginStream("A", "@acme/plugin", null, () => {})).rejects.toMatchObject({
      status: 0,
      code: "network_error",
    });
  });
});

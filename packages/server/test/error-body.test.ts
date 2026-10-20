/**
 * Provider error bodies the OpenAI SDK cannot read, normalized for it.
 *
 * The case that matters is a gateway answering `{ code, message, traceId }` — no top-level
 * `error` — to an image the endpoint refused. The SDK collapses that to
 * `"400 status code (no body)"`, and `isImageRejection` then cannot see "unsupported image",
 * so a model that definitively refuses images is recorded as merely `failed` and its switch
 * stays on. The adapter must therefore rewrite exactly that shape and nothing else.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installErrorBodyNormalizer, normalizeErrorBodyResponse } from "../src/net/error-body.js";

const json = (body: unknown, status = 400, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    statusText: status === 400 ? "Bad Request" : "Internal Server Error",
    headers: { "content-type": "application/json", ...headers },
  });

interface ErrorBody {
  error: { message: string; type?: string; code?: string };
  /** The gateway's own fields, which the adapter keeps beside `error`. */
  code?: string;
  message?: string;
  traceId?: string;
}
/** `Response.json()` is typed `unknown` here; the adapter's contract is the OpenAI error shape. */
const bodyOf = async (response: Response): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const LITELLM_BODY = {
  code: "LITELLM_ERROR",
  message:
    ".messages[0].image[0]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg, and gif.",
  traceId: "trace_abc123",
};

describe("normalizeErrorBodyResponse", () => {
  it("gives a gateway's { code, message } body the OpenAI shape the SDK reads", async () => {
    const response = await normalizeErrorBodyResponse(json(LITELLM_BODY));

    expect(response.status).toBe(400);
    expect(response.statusText).toBe("Bad Request");
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await bodyOf(response);
    expect(body.error.message).toBe(LITELLM_BODY.message);
    expect(body.error.code).toBe("LITELLM_ERROR");
    expect(body.error.type).toBe("LITELLM_ERROR");
    // The original fields stay: protocol-detect already reads `message` off this shape.
    expect(body.code).toBe("LITELLM_ERROR");
    expect(body.message).toBe(LITELLM_BODY.message);
    expect(body.traceId).toBe("trace_abc123");
  });

  it("keeps the message reachable to isImageRejection — the verdict, not just the wording", async () => {
    const { isImageRejection } = await import("../src/services/vision-detect.js");
    const response = await normalizeErrorBodyResponse(json(LITELLM_BODY));
    const body = await bodyOf(response);
    expect(isImageRejection(body.error.message)).toBe(true);
  });

  it("drops the provider's content-length, which describes the body it replaced", async () => {
    const response = await normalizeErrorBodyResponse(
      json(LITELLM_BODY, 400, { "content-length": "999" }),
    );
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("leaves an error already in OpenAI's shape untouched", async () => {
    const original = json({ error: { message: "bad key", type: "invalid_request_error" } }, 401);
    expect(await normalizeErrorBodyResponse(original)).toBe(original);
    expect(await original.json()).toEqual({
      error: { message: "bad key", type: "invalid_request_error" },
    });
  });

  it("leaves a success untouched", async () => {
    const original = json({ code: "NOT_AN_ERROR", message: "fine" }, 200);
    expect(await normalizeErrorBodyResponse(original)).toBe(original);
  });

  it("leaves a non-JSON error untouched, without consuming its body", async () => {
    const original = new Response("<html>502</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    expect(await normalizeErrorBodyResponse(original)).toBe(original);
    expect(await original.text()).toBe("<html>502</html>");
  });

  it("leaves a JSON array untouched — it is not an error object", async () => {
    const original = json([{ message: "nope" }]);
    expect(await normalizeErrorBodyResponse(original)).toBe(original);
  });

  it("falls back to the serialized body when the provider names no string message", async () => {
    const response = await normalizeErrorBodyResponse(json({ code: "X", detail: { why: "no" } }));
    const body = await bodyOf(response);
    expect(body.error.message).toBe(JSON.stringify({ code: "X", detail: { why: "no" } }));
  });
});

describe("installErrorBodyNormalizer", () => {
  let server: ReturnType<typeof createServer>;
  let fetchBefore: typeof fetch;

  beforeAll(async () => {
    fetchBefore = globalThis.fetch;
    server = createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify(LITELLM_BODY));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    // `isolate: false`: the wrapper is process-wide, so it must not outlive this file.
    globalThis.fetch = fetchBefore;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("installs once and leaves the body readable to a real caller", async () => {
    installErrorBodyNormalizer();
    const installed = globalThis.fetch;
    installErrorBodyNormalizer();
    expect(globalThis.fetch).toBe(installed);

    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`);
    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect(body.error.message).toBe(LITELLM_BODY.message);
  });
});

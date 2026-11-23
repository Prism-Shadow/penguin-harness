/**
 * Protocol auto-detection: which wire protocol a typed base URL speaks.
 *
 * - A probe treats 404/405 as a missing route. Messages requires the Anthropic envelope on
 *   errors. OpenAI auth errors require a structured API error, while validation errors may
 *   use FastAPI's `detail`. HTML, non-JSON and a 2xx without protocol markers are junk.
 * - A Google endpoint is detected from its model list, even when its router returns JSON
 *   errors on other paths. A Google relay without the listing yields no detection.
 * - The Google listing follows a limited number of same-origin redirects. A redirect to
 *   another origin never receives a request from the probe.
 * - A credentialed Messages probe follows the Fetch method and body rules for same-origin
 *   redirects. A cross-origin Messages redirect cannot intercept a Google key or prevent
 *   the detector from recognizing the Google model list.
 * - Service account JSON is never sent as a header by any probe, whether it is supplied
 *   explicitly or read from the Gemini credential environment variable.
 * - A Chat Completions validation reply can have a numeric error code. A Google RPC error
 *   with a numeric code and status does not identify either OpenAI protocol.
 * - A typed URL expands to candidates covering one `/v1` too many, one too few and a whole
 *   endpoint URL pasted in (the longest endpoint path stripped, repeats collapsed, the rest kept
 *   exactly as typed), joined to protocol paths the way the wrapped SDKs do.
 * - Probes run Responses → Messages → Chat Completions → Google GenAI, candidate by candidate, stop at the
 *   first served protocol and report the base URL it was served on; a probe that fails or
 *   floods (abandoned at the body cap) does not stop the sequence. MMSP is selected manually.
 * - Auth headers mirror MMSP's clients (Bearer for the OpenAI protocols; x-api-key, Bearer
 *   and anthropic-version for ant-messages; x-goog-api-key for Google GenAI); the key never
 *   reaches a URL or the reported probes.
 * - With no key typed or stored, each probe takes what MMSP's client for its protocol reads at
 *   the probed URL: the protocol's variable only for that client's own default endpoint,
 *   never for any other URL, one
 *   `*_BASE_URL` names included; unset and blank are absent, and a typed key wins.
 * - POST /api/projects/:p/models/detect validates the URL, falls back to the stored key of the
 *   paired reference unless clearApiKey says not to — the model's own key, else its group's —
 *   takes a group alone (the group settings dialog) and probes with the group's key unless
 *   clearApiKey clears it, never echoes the key, and never sends vendor environment keys to
 *   the Penguin Go relay.
 *
 * No test reaches the network except against a loopback server of its own: the probed endpoint
 * is the suite's fetch fake.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelProtocolDetectResponse, ModelsResponse } from "../src/api/types.js";
import {
  MAX_PROBE_BODY_BYTES,
  candidateBaseUrls,
  classifyProbeResponse,
  detectModelProtocol,
  envApiKeyForProtocol,
  isHttpUrl,
  probeUrl,
} from "../src/services/protocol-detect.js";
import { fakeFetch } from "./fixtures/fetch.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

// ---------------------------------------------------------------------------
// Pure classification
// ---------------------------------------------------------------------------

const OPENAI_ERROR = JSON.stringify({
  error: { message: "you must provide a model parameter", type: "invalid_request_error" },
});
const ANTHROPIC_ERROR = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "messages: Field required" },
});
const GOOGLE_MODELS = JSON.stringify({
  models: [{ name: "models/gemini-3.5-flash" }],
});
const GOOGLE_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  private_key: "fixture-signing-material",
});

describe("classifyProbeResponse", () => {
  it("404/405 mean route-missing by status alone — even in protocol-shaped JSON (OpenAI wraps unknown paths in its error shape; the {} probe carries no model id, so 404 can never mean model-not-found)", () => {
    expect(classifyProbeResponse("openai-responses", 404, OPENAI_ERROR)).toBe("route_missing");
    expect(classifyProbeResponse("ant-messages", 404, ANTHROPIC_ERROR)).toBe("route_missing");
    expect(classifyProbeResponse("openai-chat", 405, '{"detail":"Method Not Allowed"}')).toBe(
      "route_missing",
    );
  });

  it("4xx with an API-error JSON shape means the route exists (served) — auth failures included", () => {
    expect(classifyProbeResponse("openai-responses", 401, OPENAI_ERROR)).toBe("served");
    expect(classifyProbeResponse("openai-responses", 400, OPENAI_ERROR)).toBe("served");
    expect(classifyProbeResponse("ant-messages", 401, ANTHROPIC_ERROR)).toBe("served");
    expect(classifyProbeResponse("openai-chat", 403, OPENAI_ERROR)).toBe("served");
    expect(classifyProbeResponse("openai-chat", 429, OPENAI_ERROR)).toBe("served");
    // vLLM / FastAPI dialects: 422 {"detail": …} validation errors and the flat
    // {"object":"error"} shape are real API answers from an existing route.
    expect(classifyProbeResponse("openai-chat", 422, '{"detail":[{"loc":["body","model"]}]}')).toBe(
      "served",
    );
    expect(
      classifyProbeResponse(
        "openai-chat",
        400,
        '{"object":"error","message":"model is required","type":"BadRequestError"}',
      ),
    ).toBe("served");
    // Gateways answering a bare {"error": "..."} string still count.
    expect(classifyProbeResponse("openai-responses", 400, '{"error":"missing model"}')).toBe(
      "served",
    );
  });

  it("a generic or OpenAI error does not identify a Messages route", () => {
    expect(classifyProbeResponse("ant-messages", 401, '{"error":"Invalid relay API key"}')).toBe(
      "junk",
    );
    expect(classifyProbeResponse("ant-messages", 400, OPENAI_ERROR)).toBe("junk");
    expect(classifyProbeResponse("ant-messages", 403, '{"type":"error","error":{}}')).toBe("junk");
  });

  it("accepts numeric OpenAI-compatible error codes and rejects Google's RPC error envelope", () => {
    expect(
      classifyProbeResponse(
        "openai-chat",
        400,
        '{"error":{"code":400,"message":"Model is required"}}',
      ),
    ).toBe("served");
    expect(
      classifyProbeResponse(
        "openai-responses",
        400,
        '{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"Model is required"}}',
      ),
    ).toBe("junk");
  });

  it("a Google probe needs a successful model list with Google resource names", () => {
    expect(classifyProbeResponse("google-genai", 200, GOOGLE_MODELS)).toBe("served");
    expect(classifyProbeResponse("google-genai", 200, '{"models":[]}')).toBe("served");
    expect(classifyProbeResponse("google-genai", 200, '{"models":[{"id":"other"}]}')).toBe("junk");
    expect(classifyProbeResponse("google-genai", 200, '{"models":[{"name":"other"}]}')).toBe(
      "junk",
    );
    expect(classifyProbeResponse("google-genai", 403, OPENAI_ERROR)).toBe("junk");
  });

  it("HTML and non-JSON bodies are junk regardless of status (edge/login walls are not the protocol route)", () => {
    expect(classifyProbeResponse("openai-responses", 200, "<!doctype html><html></html>")).toBe(
      "junk",
    );
    expect(
      classifyProbeResponse("openai-chat", 401, "<html>401 Authorization Required</html>"),
    ).toBe("junk");
    expect(classifyProbeResponse("ant-messages", 400, "Bad Request")).toBe("junk");
    expect(classifyProbeResponse("openai-chat", 200, '"just a string"')).toBe("junk");
  });

  it("2xx needs protocol success markers (catch-all gateways that 200 every path are junk)", () => {
    expect(classifyProbeResponse("openai-responses", 200, '{"ok":true}')).toBe("junk");
    expect(
      classifyProbeResponse("openai-responses", 200, '{"object":"response","output":[]}'),
    ).toBe("served");
    expect(classifyProbeResponse("openai-chat", 200, '{"object":"chat.completion"}')).toBe(
      "served",
    );
    expect(classifyProbeResponse("openai-chat", 200, '{"choices":[]}')).toBe("served");
    expect(
      classifyProbeResponse("ant-messages", 200, '{"type":"message","role":"assistant"}'),
    ).toBe("served");
    // Chat markers on the responses path do not make the Responses protocol served.
    expect(classifyProbeResponse("openai-responses", 200, '{"choices":[]}')).toBe("junk");
  });

  it("5xx proves nothing about the path (gateways emit it for any URL), so it is server_error, not served", () => {
    expect(classifyProbeResponse("openai-responses", 500, OPENAI_ERROR)).toBe("server_error");
    expect(classifyProbeResponse("openai-chat", 503, OPENAI_ERROR)).toBe("server_error");
    expect(classifyProbeResponse("ant-messages", 502, "<html>bad gateway</html>")).toBe("junk");
  });

  it("4xx JSON that matches no API-error shape is junk", () => {
    expect(classifyProbeResponse("openai-chat", 400, '{"status":"bad"}')).toBe("junk");
  });

  it("a FastAPI-style `detail` only proves the route when it carries a message (null / empty say nothing)", () => {
    expect(classifyProbeResponse("openai-chat", 400, '{"detail":"field required"}')).toBe("served");
    expect(classifyProbeResponse("openai-chat", 400, '{"detail":[{"loc":["body"]}]}')).toBe(
      "served",
    );
    expect(classifyProbeResponse("openai-chat", 400, '{"detail":null}')).toBe("junk");
    expect(classifyProbeResponse("openai-chat", 400, '{"detail":""}')).toBe("junk");
  });
});

describe("isHttpUrl / probeUrl", () => {
  it("accepts absolute http(s) URLs only", () => {
    expect(isHttpUrl("https://api.example.com/v1")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:8000/v1")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("api.example.com/v1")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  it("joins base URL and protocol path the way the wrapped SDKs do (trailing slashes stripped)", () => {
    expect(probeUrl("https://api.example.com/v1", "/responses")).toBe(
      "https://api.example.com/v1/responses",
    );
    expect(probeUrl("https://api.example.com/v1/", "/responses")).toBe(
      "https://api.example.com/v1/responses",
    );
    expect(probeUrl("https://api.example.com/anthropic/", "/v1/messages")).toBe(
      "https://api.example.com/anthropic/v1/messages",
    );
  });
});

describe("candidateBaseUrls", () => {
  it("covers the three ways a base URL is mistyped: one /v1 too many, one too few, a whole endpoint URL", () => {
    expect(candidateBaseUrls("https://host/v1/v1")).toEqual(["https://host/v1", "https://host"]);
    expect(candidateBaseUrls("https://host")).toEqual(["https://host", "https://host/v1"]);
    expect(candidateBaseUrls("https://host/v1/chat/completions")).toEqual([
      "https://host/v1",
      "https://host",
    ]);
    expect(candidateBaseUrls("https://host/v1/responses")).toEqual([
      "https://host/v1",
      "https://host",
    ]);
    expect(candidateBaseUrls("https://host/v1/messages")).toEqual([
      "https://host",
      "https://host/v1",
    ]);
  });

  it("strips the longest endpoint path, not its tail (/chat/completions before /completions, /v1/messages before /messages)", () => {
    expect(candidateBaseUrls("https://host/v1/completions")).toEqual([
      "https://host/v1",
      "https://host",
    ]);
    expect(candidateBaseUrls("https://host/messages")).toEqual(["https://host", "https://host/v1"]);
    expect(candidateBaseUrls("https://host/api/chat/completions")).toEqual([
      "https://host/api",
      "https://host/api/v1",
    ]);
  });

  it("a URL that is already right still gets its neighbour, and a plain host gets /v1", () => {
    expect(candidateBaseUrls("https://api.example.com/v1")).toEqual([
      "https://api.example.com/v1",
      "https://api.example.com",
    ]);
    expect(candidateBaseUrls("http://127.0.0.1:8000")).toEqual([
      "http://127.0.0.1:8000",
      "http://127.0.0.1:8000/v1",
    ]);
  });

  it("trims whitespace, drops trailing slashes, query and fragment", () => {
    expect(candidateBaseUrls("  https://host/v1/  ")).toEqual(["https://host/v1", "https://host"]);
    expect(candidateBaseUrls("https://host/v1/chat/completions?key=abc")).toEqual([
      "https://host/v1",
      "https://host",
    ]);
    expect(candidateBaseUrls("https://host/v1#section")).toEqual([
      "https://host/v1",
      "https://host",
    ]);
  });

  it("collapses a run of repeated /v1 segments, endpoint path included", () => {
    expect(candidateBaseUrls("https://host/v1/v1/v1")).toEqual(["https://host/v1", "https://host"]);
    expect(candidateBaseUrls("https://host/v1/v1/responses")).toEqual([
      "https://host/v1",
      "https://host",
    ]);
  });

  it("leaves the host's case and every other path segment exactly as typed", () => {
    expect(candidateBaseUrls("https://API.Example.COM/v1")).toEqual([
      "https://API.Example.COM/v1",
      "https://API.Example.COM",
    ]);
    expect(candidateBaseUrls("https://host/OpenAI/Compat")).toEqual([
      "https://host/OpenAI/Compat",
      "https://host/OpenAI/Compat/v1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Probe ordering and header shapes (mocked fetch)
// ---------------------------------------------------------------------------

interface SeenCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * The endpoint under probe, over the suite's fetch fake: fixed answers by pathname, and an
 * OpenAI-style JSON 404 for any other path (like real OpenAI-compatible servers). Each request
 * lands in `seen` with its headers as a lower-cased record, so an absent one reads undefined.
 */
function gateway(
  routes: Record<string, { status: number; body: string }>,
  seen?: SeenCall[],
): typeof fetch {
  return fakeFetch((call) => {
    seen?.push({
      url: call.url,
      method: call.method,
      headers: Object.fromEntries(call.headers),
      body: call.body,
    });
    const route = routes[new URL(call.url).pathname];
    return new Response(route?.body ?? OPENAI_ERROR, {
      status: route?.status ?? 404,
      headers: { "content-type": "application/json" },
    });
  }).fetch;
}

describe("detectModelProtocol (order and stop-at-first)", () => {
  const BASE = "https://gw.example.com/v1";

  it("openai-responses wins when served, and later probes never run", async () => {
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: BASE,
      apiKey: "sk-unit",
      fetchImpl: gateway(
        {
          "/v1/responses": { status: 401, body: OPENAI_ERROR },
          "/v1/v1/messages": { status: 401, body: ANTHROPIC_ERROR },
          "/v1/chat/completions": { status: 401, body: OPENAI_ERROR },
        },
        seen,
      ),
    });
    expect(res.detected).toBe("openai-responses");
    // A base URL that needed no fixing is still reported, so callers compare rather than guess.
    expect(res.baseUrl).toBe(BASE);
    expect(res.probes.map((p) => p.outcome)).toEqual(["served"]);
    expect(seen.map((c) => c.url)).toEqual(["https://gw.example.com/v1/responses"]);
  });

  it("falls through to ant-messages when /responses is missing", async () => {
    const res = await detectModelProtocol({
      baseUrl: BASE,
      fetchImpl: gateway({
        "/v1/v1/messages": { status: 401, body: ANTHROPIC_ERROR },
        "/v1/chat/completions": { status: 401, body: OPENAI_ERROR },
      }),
    });
    expect(res.detected).toBe("ant-messages");
    expect(res.probes.map((p) => [p.clientType, p.outcome])).toEqual([
      ["openai-responses", "route_missing"],
      ["ant-messages", "served"],
    ]);
    expect(res.probes[1]!.status).toBe(401);
  });

  it("detects Chat Completions after Responses and Messages miss", async () => {
    const res = await detectModelProtocol({
      baseUrl: BASE,
      fetchImpl: gateway({
        "/v1/chat/completions": { status: 400, body: OPENAI_ERROR },
      }),
    });
    expect(res.detected).toBe("openai-chat");
    expect(res.probes.map((p) => p.outcome)).toEqual(["route_missing", "route_missing", "served"]);
  });

  it("finds Google GenAI behind a relay that returns a generic error on the Messages path", async () => {
    const baseUrl = "https://go.penguin.ooo/api/google";
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: `${baseUrl}/v1beta/models`,
      apiKey: "relay-key",
      fetchImpl: gateway(
        {
          "/api/google/v1/messages": { status: 403, body: '{"error":"Model is not available"}' },
          "/api/google/v1beta/models": { status: 200, body: GOOGLE_MODELS },
        },
        seen,
      ),
    });
    expect(res.detected).toBe("google-genai");
    expect(res.baseUrl).toBe(baseUrl);
    expect(res.probes.find((probe) => probe.clientType === "ant-messages")?.outcome).toBe("junk");
    expect(seen.at(-1)).toMatchObject({
      url: `${baseUrl}/v1beta/models?pageSize=1`,
      method: "GET",
      headers: { "x-goog-api-key": "relay-key" },
      body: "",
    });
    expect(JSON.stringify(res)).not.toContain("relay-key");
  });

  it("detects the Google catalog after a same-origin redirect, using the original base URL", async () => {
    const baseUrl = "https://relay.example/api/google";
    const fetcher = fakeFetch((call) => {
      const { pathname } = new URL(call.url);
      if (pathname === "/api/google/v1beta/models") {
        return new Response(null, { status: 308, headers: { location: "models/?pageSize=1" } });
      }
      if (pathname === "/api/google/v1beta/models/") {
        return new Response(GOOGLE_MODELS);
      }
      return new Response(null, { status: 404 });
    });
    const res = await detectModelProtocol({
      baseUrl,
      apiKey: "relay-key",
      fetchImpl: fetcher.fetch,
    });
    expect(res).toMatchObject({ detected: "google-genai", baseUrl });
    const getCalls = fetcher.calls.filter((call) => call.method === "GET");
    expect(getCalls.map((call) => call.url)).toEqual([
      `${baseUrl}/v1beta/models?pageSize=1`,
      `${baseUrl}/v1beta/models/?pageSize=1`,
    ]);
    expect(getCalls.every((call) => call.headers.get("x-goog-api-key") === "relay-key")).toBe(true);
    expect(getCalls.every((call) => call.init?.redirect === "manual")).toBe(true);
    expect(getCalls[1]?.init?.signal).toBe(getCalls[0]?.init?.signal);
  });

  it("does not send a Google probe to a redirected origin", async () => {
    const fetcher = fakeFetch((call) =>
      call.method === "GET"
        ? new Response(null, { status: 307, headers: { location: "https://other.example/models" } })
        : new Response(null, { status: 404 }),
    );
    const res = await detectModelProtocol({
      baseUrl: "https://relay.example",
      apiKey: "relay-key",
      fetchImpl: fetcher.fetch,
    });
    expect(res.detected).toBeUndefined();
    expect(
      fetcher.calls.every((call) => new URL(call.url).origin === "https://relay.example"),
    ).toBe(true);
  });

  it.each([
    { status: 301, method: "GET", body: "" },
    { status: 302, method: "GET", body: "" },
    { status: 303, method: "GET", body: "" },
    { status: 307, method: "POST", body: "{}" },
    { status: 308, method: "POST", body: "{}" },
  ])("follows a same-origin Messages $status redirect with $method semantics", async (scenario) => {
    const baseUrl = "https://relay.example";
    const fetcher = fakeFetch((call) => {
      const { pathname } = new URL(call.url);
      if (pathname === "/v1/messages") {
        return new Response(null, { status: scenario.status, headers: { location: "messages/" } });
      }
      if (pathname === "/v1/messages/") return new Response(ANTHROPIC_ERROR, { status: 401 });
      return new Response(null, { status: 404 });
    });
    const result = await detectModelProtocol({
      baseUrl,
      apiKey: "relay-key",
      fetchImpl: fetcher.fetch,
    });
    expect(result).toMatchObject({ detected: "ant-messages", baseUrl });
    const redirected = fetcher.calls.find((call) => call.url === `${baseUrl}/v1/messages/`);
    expect(redirected).toMatchObject({ method: scenario.method, body: scenario.body });
    expect(redirected?.headers.get("x-api-key")).toBe("relay-key");
    expect(redirected?.headers.get("authorization")).toBe("Bearer relay-key");
    expect(redirected?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(redirected?.headers.get("content-type")).toBe(
      scenario.method === "POST" ? "application/json" : null,
    );
  });

  it("stops following a circular Google list redirect", async () => {
    const fetcher = fakeFetch((call) =>
      call.method === "GET"
        ? new Response(null, { status: 302, headers: { location: call.url } })
        : new Response(null, { status: 404 }),
    );
    const res = await detectModelProtocol({
      baseUrl: "https://relay.example",
      fetchImpl: fetcher.fetch,
      env: {},
    });
    expect(res.detected).toBeUndefined();
    const gets = fetcher.calls.filter((call) => call.method === "GET");
    expect(gets).toHaveLength(8);
  });

  it.each([401, 403])(
    "a Google relay without a list stays undetected when it returns %i on any versioned path",
    async (status) => {
      const baseUrl = "https://go.penguin.ooo/api/google";
      const fetcher = fakeFetch((call) =>
        new URL(call.url).pathname.startsWith("/api/google/v1")
          ? Response.json(
              { error: status === 401 ? "Invalid relay API key" : "Model is not available" },
              { status },
            )
          : Response.json({ error: "API route not found" }, { status: 404 }),
      );
      const res = await detectModelProtocol({ baseUrl, env: {}, fetchImpl: fetcher.fetch });
      expect(res.detected).toBeUndefined();
      expect(res.baseUrl).toBeUndefined();
      expect(res.probes.find((probe) => probe.clientType === "google-genai")?.status).toBe(status);
    },
  );

  it("nothing matches: no detected protocol, no base URL, and every candidate's probes reported", async () => {
    const res = await detectModelProtocol({ baseUrl: BASE, fetchImpl: gateway({}) });
    expect(res.detected).toBeUndefined();
    expect(res.baseUrl).toBeUndefined();
    expect(res.probes).toHaveLength(candidateBaseUrls(BASE).length * 4);
    expect(res.probes.every((p) => p.outcome === "route_missing")).toBe(true);
    // The whole first candidate is exhausted before the second one is tried.
    expect(res.probes.map((p) => p.url)).toEqual([
      "https://gw.example.com/v1/responses",
      "https://gw.example.com/v1/v1/messages",
      "https://gw.example.com/v1/chat/completions",
      "https://gw.example.com/v1/v1beta/models?pageSize=1",
      "https://gw.example.com/responses",
      "https://gw.example.com/v1/messages",
      "https://gw.example.com/chat/completions",
      "https://gw.example.com/v1beta/models?pageSize=1",
    ]);
  });

  it("an MMSP server is not detected through the other protocols", async () => {
    // An MMSP server answers its /v1/stream like any API (a JSON 400 for the {} probe) and 404s
    // other routes, or answers with an unrelated error.
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: "http://127.0.0.1:25752/v1",
      fetchImpl: gateway(
        {
          "/v1/stream": {
            status: 400,
            body: JSON.stringify({ error: { type: "InvalidRequestError", message: "no model" } }),
          },
          "/v1/v1beta/models": { status: 400, body: OPENAI_ERROR },
        },
        seen,
      ),
    });
    expect(res.detected).toBeUndefined();
    expect(seen.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/responses",
      "/v1/v1/messages",
      "/v1/chat/completions",
      "/v1/v1beta/models",
      "/responses",
      "/v1/messages",
      "/chat/completions",
      "/v1beta/models",
    ]);
  });

  it("a pasted endpoint URL detects on the base it strips down to, and reports that base back", async () => {
    const res = await detectModelProtocol({
      baseUrl: "https://gw.example.com/v1/chat/completions",
      fetchImpl: gateway({ "/v1/chat/completions": { status: 401, body: OPENAI_ERROR } }),
    });
    expect(res.detected).toBe("openai-chat");
    expect(res.baseUrl).toBe("https://gw.example.com/v1");
    // The two misses before it are the same candidate's earlier protocols, not another base.
    expect(res.probes.map((p) => [p.clientType, p.outcome, p.url])).toEqual([
      ["openai-responses", "route_missing", "https://gw.example.com/v1/responses"],
      ["ant-messages", "route_missing", "https://gw.example.com/v1/v1/messages"],
      ["openai-chat", "served", "https://gw.example.com/v1/chat/completions"],
    ]);
  });

  it("a base URL typed without /v1 falls through to the /v1 candidate and reports it", async () => {
    const res = await detectModelProtocol({
      baseUrl: "https://gw.example.com",
      fetchImpl: gateway({ "/v1/responses": { status: 400, body: OPENAI_ERROR } }),
    });
    expect(res.detected).toBe("openai-responses");
    expect(res.baseUrl).toBe("https://gw.example.com/v1");
    expect(res.probes.map((p) => p.outcome)).toEqual([
      "route_missing",
      "route_missing",
      "route_missing",
      "route_missing",
      "served",
    ]);
    expect(res.probes.at(-1)?.url).toBe("https://gw.example.com/v1/responses");
  });

  it("probe failures do not stop the sequence: a timeout on /responses still finds chat completions", async () => {
    const timeoutOnResponses = fakeFetch((call) => {
      const path = new URL(call.url).pathname;
      if (path === "/v1/responses") {
        throw new DOMException("The operation timed out", "TimeoutError");
      }
      if (path === "/v1/v1/messages") {
        throw new TypeError("fetch failed"); // connection refused / DNS style failure
      }
      return new Response(OPENAI_ERROR, {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }).fetch;
    const res = await detectModelProtocol({ baseUrl: BASE, fetchImpl: timeoutOnResponses });
    expect(res.detected).toBe("openai-chat");
    expect(res.probes.map((p) => p.outcome)).toEqual(["timeout", "network_error", "served"]);
  });

  it("an oversized response body is abandoned at the cap and counts as junk, so a flooding endpoint neither detects nor buffers", async () => {
    // Streams well past MAX_PROBE_BODY_BYTES; the reader must stop at the cap rather than
    // materialize the whole thing, and the probe must not be credited as served.
    let pushed = 0;
    const flooder = fakeFetch((call) => {
      const path = new URL(call.url).pathname;
      if (path === "/v1/v1/messages") {
        return new Response(OPENAI_ERROR, {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (path !== "/v1/responses") {
        return new Response(OPENAI_ERROR, {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      const chunk = new Uint8Array(8 * 1024).fill(0x20); // 8 KiB of spaces per pull
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pushed += chunk.byteLength;
            // Far more than the cap if it were ever drained in full.
            if (pushed > MAX_PROBE_BODY_BYTES * 100) {
              controller.close();
              return;
            }
            controller.enqueue(chunk);
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }).fetch;
    const res = await detectModelProtocol({ baseUrl: BASE, fetchImpl: flooder });
    expect(res.probes[0]?.outcome).toBe("junk");
    expect(res.detected).toBe("openai-chat");
    // Read stopped near the cap instead of draining the stream (the producer runs a chunk
    // or two ahead of the reader, so this is "the cap plus slack", not the exact cap —
    // what matters is that it is nowhere near the 100x the stream would have emitted).
    expect(pushed).toBeLessThanOrEqual(MAX_PROBE_BODY_BYTES * 2);
  });

  it("sends credentials in each protocol's headers and only the POST probes send a body", async () => {
    const seen: SeenCall[] = [];
    await detectModelProtocol({
      baseUrl: `${BASE}/`, // trailing slash must not double up
      apiKey: "sk-secret-key",
      fetchImpl: gateway({}, seen),
    });
    // Nothing serves, so both candidates are probed; the header shapes are asserted on the
    // first candidate's four calls.
    expect(seen).toHaveLength(8);
    const [responses, messages, chat, google] = seen as [SeenCall, SeenCall, SeenCall, SeenCall];
    expect(responses.url).toBe("https://gw.example.com/v1/responses");
    expect(messages.url).toBe("https://gw.example.com/v1/v1/messages");
    expect(chat.url).toBe("https://gw.example.com/v1/chat/completions");
    for (const call of seen.filter((call) => call.method === "POST")) {
      expect(call.body).toBe("{}");
      expect(call.headers.authorization).toBe("Bearer sk-secret-key");
    }
    for (const call of seen) expect(call.url).not.toContain("sk-secret-key");
    expect(responses.headers["x-api-key"]).toBeUndefined();
    expect(chat.headers["x-api-key"]).toBeUndefined();
    expect(messages.headers["x-api-key"]).toBe("sk-secret-key");
    expect(messages.headers["anthropic-version"]).toBe("2023-06-01");
    expect(google.headers["x-goog-api-key"]).toBe("sk-secret-key");
    expect(google.headers.authorization).toBeUndefined();
  });

  it("keyless probes send no credential headers (anthropic-version stays), so a 401 in protocol shape still detects", async () => {
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: BASE,
      // Empty env: no key from anywhere, so this stays the genuinely keyless case
      // regardless of what the machine running the suite happens to export.
      env: {},
      fetchImpl: gateway({ "/v1/responses": { status: 401, body: OPENAI_ERROR } }, seen),
    });
    expect(res.detected).toBe("openai-responses");
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.headers["x-api-key"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Environment-variable fallback (no key typed, none stored)
// ---------------------------------------------------------------------------

describe("envApiKeyForProtocol", () => {
  const OPENAI = "https://api.openai.com/v1";
  const ANTHROPIC = "https://api.anthropic.com";

  it("maps each protocol to the variable its MMSP client actually reads, for the vendor's own endpoint", () => {
    const env = {
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GEMINI_API_KEY: "sk-gemini",
    };
    expect(envApiKeyForProtocol("openai-responses", OPENAI, env)).toBe("sk-openai");
    expect(envApiKeyForProtocol("openai-chat", OPENAI, env)).toBe("sk-openai");
    // The whole point of resolving per protocol: this one is NOT an OPENAI_* reader.
    expect(envApiKeyForProtocol("ant-messages", ANTHROPIC, env)).toBe("sk-anthropic");
    expect(
      envApiKeyForProtocol("google-genai", "https://generativelanguage.googleapis.com", env),
    ).toBe("sk-gemini");
  });

  it("lends nothing to a URL that is not the vendor's own, even one OPENAI_BASE_URL names", () => {
    const env = { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-anthropic" };
    // A gateway, a private server: the user's vendor key must not be sent there.
    expect(envApiKeyForProtocol("openai-chat", "https://gw.example.com/v1", env)).toBeUndefined();
    expect(envApiKeyForProtocol("ant-messages", "http://127.0.0.1:8000", env)).toBeUndefined();
    // Only the client's default endpoint takes the key when a URL is given: naming the URL in
    // OPENAI_BASE_URL does not make it one.
    expect(
      envApiKeyForProtocol("openai-chat", "https://gw.example.com/v1", {
        ...env,
        OPENAI_BASE_URL: "https://gw.example.com/v1/",
      }),
    ).toBeUndefined();
  });

  it("treats unset and blank as absent", () => {
    expect(envApiKeyForProtocol("openai-chat", OPENAI, {})).toBeUndefined();
    expect(envApiKeyForProtocol("openai-chat", OPENAI, { OPENAI_API_KEY: "   " })).toBeUndefined();
    expect(
      envApiKeyForProtocol("ant-messages", ANTHROPIC, { OPENAI_API_KEY: "sk-openai" }),
    ).toBeUndefined();
  });
});

describe("detectModelProtocol env fallback", () => {
  const BASE = "https://gw.example.com/v1";

  it("does not send requests when given an explicit service account credential", async () => {
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: BASE,
      apiKey: GOOGLE_SERVICE_ACCOUNT,
      fetchImpl: gateway({}, seen),
    });
    expect(res.detected).toBeUndefined();
    expect(res.probes).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it("skips Google's catalog probe when its environment credential is a service account", async () => {
    const seen: SeenCall[] = [];
    const official = "https://generativelanguage.googleapis.com";
    const res = await detectModelProtocol({
      baseUrl: official,
      env: { GEMINI_API_KEY: GOOGLE_SERVICE_ACCOUNT },
      fetchImpl: gateway({}, seen),
    });
    expect(res.detected).toBeUndefined();
    expect(seen.some((call) => call.url === `${official}/v1beta/models?pageSize=1`)).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("fixture-signing-material");
  });

  it("probes a URL that is not a vendor's own anonymously, whatever vendor keys are set", async () => {
    const seen: SeenCall[] = [];
    await detectModelProtocol({
      baseUrl: BASE,
      // OPENAI_BASE_URL naming the URL changes nothing: environment keys are for official
      // endpoints only.
      env: {
        OPENAI_API_KEY: "sk-openai",
        OPENAI_BASE_URL: BASE,
        ANTHROPIC_API_KEY: "sk-anthropic",
        GEMINI_API_KEY: "sk-gemini",
      },
      fetchImpl: gateway({}, seen), // every path 404s, so both candidates run all probes
    });
    expect(seen).toHaveLength(8);
    for (const call of seen) {
      expect(call.headers.authorization).toBeUndefined();
      expect(call.headers["x-api-key"]).toBeUndefined();
      expect(call.headers["x-goog-api-key"]).toBeUndefined();
    }
  });

  it("authenticates each probe of a vendor's own URL from the env var for the protocol THAT probe speaks", async () => {
    const seen: SeenCall[] = [];
    await detectModelProtocol({
      baseUrl: "https://api.openai.com/v1",
      env: { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-anthropic" },
      fetchImpl: gateway({}, seen),
    });
    expect(seen).toHaveLength(8);
    const [responses, messages, chat] = seen as [SeenCall, SeenCall, SeenCall];
    expect(responses.headers.authorization).toBe("Bearer sk-openai");
    expect(chat.headers.authorization).toBe("Bearer sk-openai");
    // OpenAI's host is not Anthropic's endpoint: the Messages probe stays anonymous there.
    expect(messages.headers.authorization).toBeUndefined();
    expect(messages.headers["x-api-key"]).toBeUndefined();
    // The neighbouring /v1-less candidate is not the official endpoint either.
    const [responses2, messages2, chat2] = seen.slice(4) as [SeenCall, SeenCall, SeenCall];
    expect(responses2.headers.authorization).toBeUndefined();
    expect(messages2.headers["x-api-key"]).toBeUndefined();
    expect(chat2.headers.authorization).toBeUndefined();
    // Whatever the source, the credential never reaches a URL.
    for (const call of seen) {
      expect(call.url).not.toContain("sk-openai");
      expect(call.url).not.toContain("sk-anthropic");
    }
  });

  it("an explicit key wins over the environment for every probe", async () => {
    const seen: SeenCall[] = [];
    await detectModelProtocol({
      baseUrl: BASE,
      apiKey: "sk-typed",
      env: { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-anthropic" },
      fetchImpl: gateway({}, seen),
    });
    for (const call of seen.filter((call) => call.method === "POST")) {
      expect(call.headers.authorization).toBe("Bearer sk-typed");
    }
    expect((seen[1] as SeenCall).headers["x-api-key"]).toBe("sk-typed");
    expect((seen[3] as SeenCall).headers["x-goog-api-key"]).toBe("sk-typed");
  });

  it("falls back per protocol, so a half-configured environment still authenticates its own probe", async () => {
    const seen: SeenCall[] = [];
    await detectModelProtocol({
      baseUrl: "https://api.anthropic.com",
      env: { ANTHROPIC_API_KEY: "sk-anthropic" },
      fetchImpl: gateway({}, seen),
    });
    const [responses, messages, chat] = seen as [SeenCall, SeenCall, SeenCall];
    expect(responses.headers.authorization).toBeUndefined();
    expect(chat.headers.authorization).toBeUndefined();
    expect(messages.headers["x-api-key"]).toBe("sk-anthropic");
  });

  it("never echoes an env-sourced key into the reported probes", async () => {
    const res = await detectModelProtocol({
      baseUrl: "https://api.openai.com/v1",
      env: { OPENAI_API_KEY: "sk-openai", ANTHROPIC_API_KEY: "sk-anthropic" },
      fetchImpl: gateway({ "/v1/responses": { status: 401, body: OPENAI_ERROR } }),
    });
    expect(res.detected).toBe("openai-responses");
    expect(JSON.stringify(res)).not.toContain("sk-openai");
    expect(JSON.stringify(res)).not.toContain("sk-anthropic");
  });
});

// ---------------------------------------------------------------------------
// Route integration
// ---------------------------------------------------------------------------

/** Local endpoint serving only the Anthropic Messages path; records each request's path and auth headers. */
function antOnlyServer(seen: Array<{ path: string; auth?: string; xApiKey?: string }>): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen.push({
        path: req.url ?? "",
        ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
        ...(typeof req.headers["x-api-key"] === "string"
          ? { xApiKey: req.headers["x-api-key"] }
          : {}),
      });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/messages") {
        res.statusCode = 401;
        res.end(ANTHROPIC_ERROR);
      } else {
        res.statusCode = 404;
        res.end(OPENAI_ERROR);
      }
    });
  });
}

describe("POST /api/projects/:p/models/detect", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const detectUrl = () => `/api/projects/${projectId}/models/detect`;

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "diana");
    api = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await api.post("/api/projects", {
        projectId: `diana-detect_${projects}`,
        name: "Detect project",
      })
    ).json()) as { project: { projectId: string } };
    projectId = created.project.projectId;
  });

  it("validates baseUrl: required and absolute http(s)", async () => {
    expect((await api.post(detectUrl(), {})).status).toBe(400);
    expect((await api.post(detectUrl(), { baseUrl: "ftp://example.com" })).status).toBe(400);
    expect((await api.post(detectUrl(), { baseUrl: "not a url" })).status).toBe(400);
  });

  it("protects an entered Google key from a cross-origin Messages redirect and still detects Google", async () => {
    const apiKey = "local-google-test-key";
    let otherOriginRequests = 0;
    const other = createServer((_req, res) => {
      otherOriginRequests++;
      res.writeHead(401, { "content-type": "application/json" }).end(ANTHROPIC_ERROR);
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    let sentMessagesKey: string | string[] | undefined;
    const relay = createServer((req, res) => {
      if (req.url === "/v1/messages") {
        sentMessagesKey = req.headers["x-api-key"];
        res.writeHead(307, { location: `${otherOrigin}/v1/messages` }).end();
      } else if (
        req.url === "/v1beta/models?pageSize=1" &&
        req.method === "GET" &&
        req.headers["x-goog-api-key"] === apiKey
      ) {
        res.writeHead(200, { "content-type": "application/json" }).end(GOOGLE_MODELS);
      } else {
        res.writeHead(404).end();
      }
    });
    try {
      await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
      const baseUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
      const res = await api.post(detectUrl(), { baseUrl, apiKey });
      expect(res.status).toBe(200);
      const result = (await res.json()) as ModelProtocolDetectResponse;
      expect(result.detected).toBe("google-genai");
      expect(result.probes.find((probe) => probe.clientType === "ant-messages")).toMatchObject({
        outcome: "junk",
        status: 307,
      });
      expect(sentMessagesKey).toBe(apiKey);
      expect(otherOriginRequests).toBe(0);
      expect(JSON.stringify(result)).not.toContain(apiKey);
    } finally {
      await Promise.all(
        [relay, other].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    }
  });

  it("detects ant-messages on a live endpoint (404 on /responses, protocol-shaped 401 on /v1/messages) and never echoes the key", async () => {
    const seen: Array<{ path: string; auth?: string; xApiKey?: string }> = [];
    const server = antOnlyServer(seen);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await api.post(detectUrl(), {
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "sk-local-detect",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ModelProtocolDetectResponse;
      expect(body.detected).toBe("ant-messages");
      expect(body.probes.map((p) => [p.clientType, p.outcome])).toEqual([
        ["openai-responses", "route_missing"],
        ["ant-messages", "served"],
      ]);
      expect(body.probes[1]!.status).toBe(401);
      // The key travels only in headers, and the response carries no secret.
      expect(JSON.stringify(body)).not.toContain("sk-local-detect");
      expect(seen.map((c) => c.path)).toEqual(["/responses", "/v1/messages"]);
      expect(seen[1]!.xApiKey).toBe("sk-local-detect");
      expect(seen[1]!.auth).toBe("Bearer sk-local-detect");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("the paired reference falls back to the stored key (probe before the frontend ever sees a plaintext key); clearApiKey suppresses that fallback, and a private URL is not lent the env var", async () => {
    const seen: Array<{ path: string; auth?: string; xApiKey?: string }> = [];
    const server = antOnlyServer(seen);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const put = await api.put(`/api/projects/${projectId}/models`, {
        models: [
          {
            provider: "custom",
            modelId: "stored-key-model",
            apiKey: "sk-stored-secret",
            baseUrl: `http://127.0.0.1:${port}`,
          },
        ],
      });
      expect(put.status).toBe(200);
      expect(((await put.json()) as ModelsResponse).models).toHaveLength(1);

      const res = await api.post(detectUrl(), {
        baseUrl: `http://127.0.0.1:${port}`,
        provider: "custom",
        modelId: "stored-key-model",
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ModelProtocolDetectResponse).detected).toBe("ant-messages");
      const messagesProbe = seen.find((c) => c.path === "/v1/messages");
      expect(messagesProbe?.xApiKey).toBe("sk-stored-secret");

      // clearApiKey drops the STORED key. What backs the probe then is whatever the saved
      // model itself would run on — and a private server is allowed no env var — so this
      // asserts both halves, with the environment pinned (the real one must never reach a
      // probe, and the suite must not depend on what the developer exports).
      const savedAnthropic = process.env.ANTHROPIC_API_KEY;
      const savedOpenai = process.env.OPENAI_API_KEY;
      const savedAnthropicBase = process.env.ANTHROPIC_BASE_URL;
      try {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_BASE_URL;
        seen.length = 0;
        const cleared = await api.post(detectUrl(), {
          baseUrl: `http://127.0.0.1:${port}`,
          provider: "custom",
          modelId: "stored-key-model",
          clearApiKey: true,
        });
        expect(cleared.status).toBe(200);
        // Route-shape 401s still detect the protocol, but no credential was sent.
        expect(((await cleared.json()) as ModelProtocolDetectResponse).detected).toBe(
          "ant-messages",
        );
        const keyless = seen.find((c) => c.path === "/v1/messages");
        expect(keyless?.xApiKey).toBeUndefined();
        expect(keyless?.auth).toBeUndefined();

        // Same request with the env var present — and even with ANTHROPIC_BASE_URL naming
        // this very server: the stored key stays suppressed, and the local server is not
        // Anthropic's endpoint, so the Anthropic key is NOT lent to it and the probe stays
        // anonymous. Only the client's own default endpoint takes the environment key.
        process.env.ANTHROPIC_API_KEY = "sk-env-anthropic";
        process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
        seen.length = 0;
        const withheld = await api.post(detectUrl(), {
          baseUrl: `http://127.0.0.1:${port}`,
          provider: "custom",
          modelId: "stored-key-model",
          clearApiKey: true,
        });
        expect(withheld.status).toBe(200);
        expect(((await withheld.json()) as ModelProtocolDetectResponse).detected).toBe(
          "ant-messages",
        );
        const withheldProbe = seen.find((c) => c.path === "/v1/messages");
        expect(withheldProbe?.xApiKey).toBeUndefined();
        expect(withheldProbe?.auth).toBeUndefined();
      } finally {
        if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = savedAnthropic;
        if (savedOpenai === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = savedOpenai;
        if (savedAnthropicBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
        else process.env.ANTHROPIC_BASE_URL = savedAnthropicBase;
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("a group alone probes with the group's key, and so does a model with no key of its own; clearApiKey on the group probes keyless", async () => {
    const seen: Array<{ path: string; auth?: string; xApiKey?: string }> = [];
    const server = antOnlyServer(seen);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const put = await api.put(`/api/projects/${projectId}/models`, {
        providers: { "my-lab": { baseUrl, apiKey: "sk-lab-group-0001" } },
        models: [{ provider: "my-lab", modelId: "lab-model", clientType: "openai-chat" }],
      });
      expect(put.status).toBe(200);
      const messagesKey = () => seen.find((c) => c.path === "/v1/messages")?.xApiKey;

      for (const body of [
        { baseUrl, provider: "my-lab" },
        { baseUrl, provider: "my-lab", modelId: "lab-model" },
        // Clearing the model's own key leaves it on its group's.
        { baseUrl, provider: "my-lab", modelId: "lab-model", clearApiKey: true },
      ]) {
        seen.length = 0;
        const res = await api.post(detectUrl(), body);
        expect(res.status).toBe(200);
        expect(JSON.stringify(await res.json())).not.toContain("sk-lab-group-0001");
        expect(messagesKey(), JSON.stringify(body)).toBe("sk-lab-group-0001");
      }

      // The group dialog's "clear the group key": the probe is the draft's, so it is keyless.
      seen.length = 0;
      const cleared = await api.post(detectUrl(), {
        baseUrl,
        provider: "my-lab",
        clearApiKey: true,
      });
      expect(((await cleared.json()) as ModelProtocolDetectResponse).detected).toBe("ant-messages");
      expect(messagesKey()).toBeUndefined();

      // A model id still needs its group.
      expect((await api.post(detectUrl(), { baseUrl, modelId: "lab-model" })).status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("a Penguin Go probe sends no environment key to the relay endpoint, the retired relay variable included", async () => {
    const seen: Array<{ path: string; auth?: string; xApiKey?: string }> = [];
    const server = antOnlyServer(seen);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const saved = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      penguin: process.env.PENGUIN_GO_API_KEY,
    };
    process.env.ANTHROPIC_API_KEY = "vendor-anthropic-must-not-cross";
    process.env.OPENAI_API_KEY = "vendor-openai-must-not-cross";
    // Penguin Go takes keys from the config alone: the variable it once read is ignored.
    process.env.PENGUIN_GO_API_KEY = "relay-env-must-not-cross";
    try {
      const response = await api.post(detectUrl(), {
        baseUrl: `http://127.0.0.1:${port}`,
        provider: "penguin-go",
        modelId: "deepseek-flash",
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as ModelProtocolDetectResponse).detected).toBe(
        "ant-messages",
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((request) => request.auth === undefined)).toBe(true);
      expect(seen.every((request) => request.xApiKey === undefined)).toBe(true);
    } finally {
      if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved.anthropic;
      if (saved.openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved.openai;
      if (saved.penguin === undefined) delete process.env.PENGUIN_GO_API_KEY;
      else process.env.PENGUIN_GO_API_KEY = saved.penguin;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

/**
 * Protocol auto-detection tests: classification of probe answers (route-exists vs
 * route-missing 404/405 vs HTML/gateway junk vs 5xx), the required probe order
 * (openai-responses → ant-messages → openai-chat, stop at the first served protocol),
 * auth header shapes per protocol (Bearer for the OpenAI protocols; x-api-key +
 * Bearer + anthropic-version for ant-messages, mirroring AgentHub's clients), and the
 * POST /api/projects/:p/models/detect route (validation, stored-key fallback via the
 * paired reference, and that the key never appears in the response).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelProtocolDetectResponse, ModelsResponse } from "../src/api/types.js";
import {
  classifyProbeResponse,
  detectModelProtocol,
  isHttpUrl,
  probeUrl,
} from "../src/services/protocol-detect.js";
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

// ---------------------------------------------------------------------------
// Probe ordering and header shapes (mocked fetch)
// ---------------------------------------------------------------------------

interface SeenCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Fake fetch serving fixed answers by pathname; unknown paths get an OpenAI-style JSON 404 (like real OpenAI-compatible servers). */
function fakeFetch(
  routes: Record<string, { status: number; body: string }>,
  seen?: SeenCall[],
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    seen?.push({ url, headers, body: String(init?.body ?? "") });
    const route = routes[new URL(url).pathname];
    if (!route) {
      return new Response(OPENAI_ERROR, {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(route.body, {
      status: route.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("detectModelProtocol (order and stop-at-first)", () => {
  const BASE = "https://gw.example.com/v1";

  it("openai-responses wins when served, and later probes never run", async () => {
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: BASE,
      apiKey: "sk-unit",
      fetchImpl: fakeFetch(
        {
          "/v1/responses": { status: 401, body: OPENAI_ERROR },
          "/v1/v1/messages": { status: 401, body: ANTHROPIC_ERROR },
          "/v1/chat/completions": { status: 401, body: OPENAI_ERROR },
        },
        seen,
      ),
    });
    expect(res.detected).toBe("openai-responses");
    expect(res.probes.map((p) => p.outcome)).toEqual(["served"]);
    expect(seen.map((c) => c.url)).toEqual(["https://gw.example.com/v1/responses"]);
  });

  it("falls through to ant-messages when /responses is missing", async () => {
    const res = await detectModelProtocol({
      baseUrl: BASE,
      fetchImpl: fakeFetch({
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

  it("openai-chat is the last resort", async () => {
    const res = await detectModelProtocol({
      baseUrl: BASE,
      fetchImpl: fakeFetch({
        "/v1/chat/completions": { status: 400, body: OPENAI_ERROR },
      }),
    });
    expect(res.detected).toBe("openai-chat");
    expect(res.probes.map((p) => p.outcome)).toEqual(["route_missing", "route_missing", "served"]);
  });

  it("nothing matches: no detected protocol, all three probes reported", async () => {
    const res = await detectModelProtocol({ baseUrl: BASE, fetchImpl: fakeFetch({}) });
    expect(res.detected).toBeUndefined();
    expect(res.probes).toHaveLength(3);
    expect(res.probes.every((p) => p.outcome === "route_missing")).toBe(true);
  });

  it("probe failures do not stop the sequence: a timeout on /responses still finds chat completions", async () => {
    const timeoutOnResponses: typeof fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const path = new URL(String(input)).pathname;
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
    }) as typeof fetch;
    const res = await detectModelProtocol({ baseUrl: BASE, fetchImpl: timeoutOnResponses });
    expect(res.detected).toBe("openai-chat");
    expect(res.probes.map((p) => p.outcome)).toEqual(["timeout", "network_error", "served"]);
  });

  it("auth headers mirror the AgentHub clients: Bearer for the OpenAI protocols; x-api-key + Bearer + anthropic-version for ant-messages; the {} body and key-free URLs everywhere", async () => {
    const seen: SeenCall[] = [];
    await detectModelProtocol({
      baseUrl: `${BASE}/`, // trailing slash must not double up
      apiKey: "sk-secret-key",
      fetchImpl: fakeFetch({}, seen),
    });
    expect(seen).toHaveLength(3);
    const [responses, messages, chat] = seen as [SeenCall, SeenCall, SeenCall];
    expect(responses.url).toBe("https://gw.example.com/v1/responses");
    expect(messages.url).toBe("https://gw.example.com/v1/v1/messages");
    expect(chat.url).toBe("https://gw.example.com/v1/chat/completions");
    for (const call of seen) {
      expect(call.body).toBe("{}");
      expect(call.url).not.toContain("sk-secret-key");
      expect(call.headers.authorization).toBe("Bearer sk-secret-key");
    }
    expect(responses.headers["x-api-key"]).toBeUndefined();
    expect(chat.headers["x-api-key"]).toBeUndefined();
    expect(messages.headers["x-api-key"]).toBe("sk-secret-key");
    expect(messages.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("keyless probes send no credential headers (anthropic-version stays), so a 401 in protocol shape still detects", async () => {
    const seen: SeenCall[] = [];
    const res = await detectModelProtocol({
      baseUrl: BASE,
      fetchImpl: fakeFetch({ "/v1/responses": { status: 401, body: OPENAI_ERROR } }, seen),
    });
    expect(res.detected).toBe("openai-responses");
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.headers["x-api-key"]).toBeUndefined();
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

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "diana");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "diana-detect", name: "Detect project" })
    ).json()) as { project: { projectId: string } };
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("validates baseUrl: required and absolute http(s)", async () => {
    expect((await api.post(detectUrl(), {})).status).toBe(400);
    expect((await api.post(detectUrl(), { baseUrl: "ftp://example.com" })).status).toBe(400);
    expect((await api.post(detectUrl(), { baseUrl: "not a url" })).status).toBe(400);
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

  it("the paired reference falls back to the stored key (probe before the frontend ever sees a plaintext key); clearApiKey suppresses the fallback", async () => {
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

      seen.length = 0;
      const cleared = await api.post(detectUrl(), {
        baseUrl: `http://127.0.0.1:${port}`,
        provider: "custom",
        modelId: "stored-key-model",
        clearApiKey: true,
      });
      expect(cleared.status).toBe(200);
      // Route-shape 401s still detect the protocol, but no credential was sent.
      expect(((await cleared.json()) as ModelProtocolDetectResponse).detected).toBe("ant-messages");
      const keyless = seen.find((c) => c.path === "/v1/messages");
      expect(keyless?.xApiKey).toBeUndefined();
      expect(keyless?.auth).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

/**
 * App attribution: the headers that name PenguinHarness to the gateways that read one, decided
 * by the endpoint host alone (core's one gateway special case, PRN-021). Whether GenerativeModel
 * sends them is proved in generative-model-attribution.test.ts.
 *
 * - Given an OpenRouter or TokenDance base URL — preset or typed, any subdomain, a trailing
 *   dot — the app's attribution headers; a session id leaves them as they were.
 * - Given an OpenCode base URL, the session header: the Session's id, else a fresh random id.
 * - Given any other endpoint, a lookalike host, or a blank or unparseable base URL, nothing.
 */
import { describe, expect, it } from "vitest";
import { attributionHeaders } from "../src/llm/app-attribution.js";

describe("attributionHeaders (how the harness names itself to the gateways that read it)", () => {
  it("OpenRouter gets its three attribution headers, on the preset base URL and on any custom one", () => {
    const expected = {
      "HTTP-Referer": "https://penguin.ooo/",
      "X-OpenRouter-Title": "PenguinHarness",
      "X-OpenRouter-Categories": "cli-agent,personal-agent",
    };
    expect(attributionHeaders("https://openrouter.ai/api/v1")).toEqual(expected);
    // The host decides, not a provider group: an entry filed under custom that points at the
    // same gateway is the same app calling it.
    expect(attributionHeaders("https://openrouter.ai/api/v1/")).toEqual(expected);
    // `URL` keeps a fully-qualified trailing dot in `hostname`; it names the same server.
    expect(attributionHeaders("https://openrouter.ai./api/v1")).toEqual(expected);
    // OpenRouter accepts at most two categories per request and drops anything unrecognised.
    expect(expected["X-OpenRouter-Categories"].split(",")).toHaveLength(2);
  });

  it("TokenDance gets the single X-App-URL header", () => {
    expect(attributionHeaders("https://tokendance.space/gateway/v1")).toEqual({
      "X-App-URL": "https://penguin.ooo/",
    });
  });

  it("OpenCode always gets the session header: the Session's id, or a fresh random one", () => {
    const sessionId = "session-2026-09-14-10-30-00-a1b2c3d4";
    expect(attributionHeaders("https://opencode.ai/zen/v1", sessionId)).toEqual({
      "x-opencode-session": sessionId,
    });
    // Same suffix-anchored host rule as the other two: a subdomain is the same gateway.
    expect(attributionHeaders("https://api.opencode.ai/v1", sessionId)).toEqual({
      "x-opencode-session": sessionId,
    });
    // No id — a connectivity test, a vision probe — still names a conversation, since the
    // gateway refuses a request that names none: a fresh random id each time, never one
    // constant that would file every such request under a single session.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const first = attributionHeaders("https://opencode.ai/zen/v1")?.["x-opencode-session"];
    const second = attributionHeaders("https://opencode.ai/zen/v1", "")?.["x-opencode-session"];
    expect(first).toMatch(uuid);
    expect(second).toMatch(uuid);
    expect(first).not.toBe(second);
    // A host outside the scheme gets nothing, whatever path it serves: third-party mirrors of
    // a gateway are not part of the built-in attribution, and naming one here would put it in
    // the repository just as surely as listing it would.
    expect(attributionHeaders("https://gateway.example.com/zen/go", sessionId)).toBeUndefined();
  });

  it("a session id leaves the app-attribution gateways exactly as they were", () => {
    const sessionId = "session-2026-09-14-10-30-00-a1b2c3d4";
    expect(attributionHeaders("https://openrouter.ai/api/v1", sessionId)).toEqual({
      "HTTP-Referer": "https://penguin.ooo/",
      "X-OpenRouter-Title": "PenguinHarness",
      "X-OpenRouter-Categories": "cli-agent,personal-agent",
    });
    expect(attributionHeaders("https://tokendance.space/gateway/v1", sessionId)).toEqual({
      "X-App-URL": "https://penguin.ooo/",
    });
  });

  it("every other endpoint gets no extra headers, and a blank or unparseable base URL is inert", () => {
    expect(attributionHeaders("https://api.deepseek.com")).toBeUndefined();
    expect(attributionHeaders("https://api.siliconflow.cn/v1")).toBeUndefined();
    expect(attributionHeaders(undefined)).toBeUndefined();
    expect(attributionHeaders("   ")).toBeUndefined();
    expect(attributionHeaders("not a url")).toBeUndefined();
    // Suffix-anchored host matching: a lookalike domain is not the gateway.
    expect(attributionHeaders("https://notopenrouter.ai/api/v1")).toBeUndefined();
    expect(attributionHeaders("https://tokendance.space.example.com/v1")).toBeUndefined();
    // Stripping the trailing dot must not widen that anchoring.
    expect(attributionHeaders("https://openrouter.ai.attacker.com./v1")).toBeUndefined();
  });
});

/**
 * Server error → display text (`apiErrorText`), and the error the api client builds. The
 * server's messages are English-only by design, so the UI derives its text from the error code;
 * a code missing from the table falls through to the raw English message.
 *
 * - The three "cannot compact" refusals stay three distinct explanations, in both languages.
 * - The Chinese UI shows Chinese text for the errors an ordinary session can surface.
 * - A code nobody mapped still falls back to the server's message; a non-ApiError reads as the
 *   generic failure.
 * - A numeric Retry-After header survives onto the ApiError.
 * - A machine that did not answer (`machine_no_answer`: the hub's lookup, or any machine read the
 *   socket gave up on — files, lists, settings) is said about the machine, not a conversation.
 * - An answer that is not the server's (no JSON) says what answered instead of blaming the
 *   server: a web page from a dev server or reverse proxy that did not forward the request, or a
 *   proxy's gateway answer. For a machine's Agents, that is the sentence the new-chat page shows.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, apiFetch } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";
import { remoteAgentsEmpty } from "../src/lib/machine-link";
import { S, setActiveStrings, zh as ZH } from "../src/lib/strings";
import { en as EN } from "../src/lib/strings-en";
import { apiError, stubFetch } from "./helpers/fetch";

/** The English message the server actually sends, so an unmapped code is visibly distinguishable. */
const serverError = (code: string): ApiError =>
  new ApiError(409, code, "RAW ENGLISH SERVER MESSAGE");

afterEach(() => {
  setActiveStrings(ZH);
});

describe("apiErrorText", () => {
  it("says a machine that did not answer about the machine, whatever was being read", () => {
    for (const dict of [ZH, EN]) {
      setActiveStrings(dict);
      const text = apiErrorText(new ApiError(0, "machine_no_answer", "RAW ENGLISH SERVER MESSAGE"));
      expect(text).not.toBe("RAW ENGLISH SERVER MESSAGE");
      expect(text).not.toMatch(/conversation|对话/i);
    }
  });

  it("localizes each compaction refusal separately in both locales", () => {
    const codes = ["compaction_not_configured", "nothing_to_compact", "already_compacted"];

    for (const dict of [ZH, EN]) {
      setActiveStrings(dict);
      const texts = codes.map((c) => apiErrorText(serverError(c)));
      // Mapped, so the raw server message never reaches the user.
      for (const t of texts) expect(t).not.toBe("RAW ENGLISH SERVER MESSAGE");
      // Three reasons, three explanations: telling someone who just compacted that they have
      // not spoken yet is the regression this guards.
      expect(new Set(texts).size).toBe(3);
    }
  });

  it("localizes each model-switch refusal separately in both locales", () => {
    const codes = [
      "same_model",
      "model_not_configured",
      "model_unavailable",
      "compaction_not_configured",
      "task_in_progress",
      "compacting",
    ];
    for (const dict of [ZH, EN]) {
      setActiveStrings(dict);
      const texts = codes.map((c) => apiErrorText(serverError(c)));
      for (const t of texts) expect(t).not.toBe("RAW ENGLISH SERVER MESSAGE");
      expect(new Set(texts).size).toBe(codes.length);
    }
  });

  it("gives the Chinese UI Chinese text for the errors it can surface", () => {
    setActiveStrings(ZH);
    // A representative slice of the codes an ordinary session can produce: compaction refusals,
    // stale-resource races, and the catch-all a server bug returns.
    const reachable = [
      "compaction_not_configured",
      "nothing_to_compact",
      "already_compacted",
      "session_not_found",
      "approval_not_found",
      "process_not_found",
      "process_running",
      "memory_file_not_found",
      "memory_scope_not_found",
      "trace_not_found",
      "platform_rate_limited",
      // The Workspace picker's "Allow access" in the desktop app: no shell, or no answer.
      "shell_unreachable",
      "timeout",
      "internal",
    ];
    for (const code of reachable) {
      const text = apiErrorText(serverError(code));
      expect(text, `${code} is not localized`).not.toBe("RAW ENGLISH SERVER MESSAGE");
      expect(text, `${code} has no Chinese text`).toMatch(/[一-鿿]/);
    }
  });

  it("still falls back to the server message for a code nobody has mapped", () => {
    setActiveStrings(ZH);
    expect(apiErrorText(serverError("some_code_from_the_future"))).toBe(
      "RAW ENGLISH SERVER MESSAGE",
    );
  });

  it("reports a non-ApiError as the generic failure, not a stray object", () => {
    setActiveStrings(ZH);
    expect(apiErrorText(new Error("boom"))).toBe(S.common.unknownError);
  });

  it("keeps a numeric Retry-After header on the ApiError", async () => {
    stubFetch(() => apiError(429, "platform_rate_limited", "slow down", { "retry-after": "7" }));

    await expect(apiFetch("/api/platform-rate-limit-test")).rejects.toMatchObject({
      status: 429,
      code: "platform_rate_limited",
      retryAfterSeconds: 7,
    });
  });
});

describe("an answer that is not the server's", () => {
  const page = (status: number, headers: Record<string, string> = {}) =>
    new Response("<!doctype html><html><head></head><body></body></html>", {
      status,
      headers: { "content-type": "text/html", ...headers },
    });
  /** What the new-chat page says when asking a connected machine for its Agents failed with `err`. */
  const composerLine = (err: unknown) => remoteAgentsEmpty("connected", apiErrorText(err));
  const failureOf = async (call: Promise<unknown>): Promise<ApiError> => {
    const err = await call.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  };

  it("names a web page in place of a machine's Agents, rather than a failure of the machine", async () => {
    // A dev server that does not forward /server/… serves the SPA's index.html, status 200. The
    // socket carries a text/* answer as its text (server/src/socket/serve.ts answerOnce), and the
    // client judges it by the same rule it judges a Response: a page answered, so the machine's
    // list never takes the page for the Agents it asked about.
    const fake = stubFetch(() => page(200));
    for (const [attempt, dict] of [ZH, EN].entries()) {
      setActiveStrings(dict);
      const err = await failureOf(
        apiFetch("/api/projects/default_project/agents", { server: "m1" }),
      );
      expect(fake.requests.at(-1)?.machine).toBe("m1");
      // One request per attempt: the answer rode the socket, nothing was asked again over HTTP.
      expect(fake.requests).toHaveLength(attempt + 1);
      expect(err).toMatchObject({ status: 200, code: "not_the_server" });
      expect(apiErrorText(err)).toBe(S.errors.notTheServer.page(200));
      expect(composerLine(err)).toBe(S.machines.composer.failed(S.errors.notTheServer.page(200)));
      expect(composerLine(err)).not.toContain(S.common.unknownError);
    }
  });

  it("says a proxy answered when a gateway status comes back without the server's JSON", async () => {
    // A gateway's own page is text/*, which the socket carries as text. A socket answer carries
    // no proxy header (only content-type, retry-after and etag), so the proxy is named by its
    // status alone there — every gateway status a proxy answers with, not just the first.
    for (const status of [502, 503, 504]) {
      const fake = stubFetch(() => page(status));
      setActiveStrings(ZH);
      const gateway = await failureOf(
        apiFetch("/api/projects/default_project/agents", { server: "m1" }),
      );
      expect(fake.requests).toHaveLength(1);
      expect(gateway).toMatchObject({ status, code: "not_the_server" });
      expect(apiErrorText(gateway)).toBe(S.errors.notTheServer.proxy(status));
    }

    // Any status, when the answer carries a proxy's own header — a header only an HTTP answer
    // has, read where the client reads the Response itself (`/api/me`).
    stubFetch(() => page(403, { via: "1.1 squid" }));
    const forbidden = await failureOf(apiFetch("/api/me"));
    expect(apiErrorText(forbidden)).toBe(S.errors.notTheServer.proxy(403));
  });

  it("names the status and type of anything else that is not JSON, an empty answer included", async () => {
    // Over HTTP the client reads the Response itself: an empty 404 is "not the server's answer".
    stubFetch(() => new Response(null, { status: 404 }));
    setActiveStrings(EN);
    const empty = await failureOf(apiFetch("/api/me"));
    expect(apiErrorText(empty)).toBe(S.errors.notTheServer.other(404, ""));

    // On the socket an empty body keeps its status with a null body instead (answerOnce), so a
    // 404 there is the server's own status without an envelope: the generic failure, no fetch.
    const socket = stubFetch(() => new Response(null, { status: 404 }));
    const carried = await failureOf(
      apiFetch("/api/projects/default_project/agents", { method: "POST" }),
    );
    expect(socket.requests).toHaveLength(1);
    expect(carried).toMatchObject({
      status: 404,
      code: "http_error",
      message: S.common.unknownError,
    });

    // A text body the socket does carry, of a type that names neither a page nor a gateway: the
    // status and the type are the answer's name, as on HTTP.
    const plainSocket = stubFetch(
      () =>
        new Response("upstream says no", {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    );
    const carriedPlain = await failureOf(apiFetch("/api/projects/default_project/agents"));
    expect(plainSocket.requests).toHaveLength(1);
    expect(apiErrorText(carriedPlain)).toBe(S.errors.notTheServer.other(400, "text/plain"));

    stubFetch(
      () =>
        new Response("upstream says no", {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    );
    const plain = await failureOf(apiFetch("/api/me"));
    expect(apiErrorText(plain)).toBe(S.errors.notTheServer.other(400, "text/plain"));
  });

  it("carries a JSON-labelled body it cannot parse as the text it is", async () => {
    // answerOnce parses a `json` content type, and keeps the raw text when that parse fails: the
    // answer still rides the socket once, without a second fetch.
    const fake = stubFetch(
      () =>
        new Response("not json", {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    setActiveStrings(EN);
    const carried = await failureOf(apiFetch("/api/projects/default_project/agents"));
    expect(fake.requests).toHaveLength(1);
    expect(carried).toMatchObject({
      status: 500,
      code: "http_error",
      message: S.common.unknownError,
    });
  });

  it("refuses a body of a type the socket cannot carry, and reads it over HTTP", async () => {
    // Not JSON, not text/*: a download. The socket answers 415 `unsupported_transport` and the
    // client asks the same URL over HTTP, where the answer to a non-JSON body is not the server's.
    const fake = stubFetch(
      () =>
        new Response("binary bytes", {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    setActiveStrings(EN);
    const refused = await failureOf(apiFetch("/api/projects/default_project/agents"));
    expect(fake.requests).toHaveLength(2);
    expect(refused).toMatchObject({ status: 200, code: "not_the_server" });
    expect(apiErrorText(refused)).toBe(
      S.errors.notTheServer.other(200, "application/octet-stream"),
    );
  });

  it("leaves the server's own errors as they were, JSON without an error code included", async () => {
    stubFetch(() => apiError(503, "not_connected", "No live forward to m1; connect to it first."));
    setActiveStrings(EN);
    const server = await failureOf(
      apiFetch("/api/projects/default_project/agents", { server: "m1" }),
    );
    expect(server).toMatchObject({ status: 503, code: "not_connected" });

    stubFetch(
      () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    );
    const bare = await failureOf(apiFetch("/api/me"));
    expect(bare).toMatchObject({ code: "http_error", message: S.common.unknownError });
  });
});

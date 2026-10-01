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
 */
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, apiFetch } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";
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

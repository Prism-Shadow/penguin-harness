/**
 * Server error → localized display text (`apiErrorText`).
 *
 * The server's error messages are English-only by design, so the UI derives its text from the
 * error **code**. Any code missing from the table falls through to the raw English message —
 * which is how English prose ends up in a Chinese UI. These tests pin the codes a user actually
 * meets, and pin that the three "cannot compact" reasons stay three distinct explanations
 * rather than collapsing into one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";
import { S, setActiveStrings } from "../src/lib/strings";
import { en as EN } from "../src/lib/strings-en";

/** The English message the server actually sends, so an unmapped code is visibly distinguishable. */
const serverError = (code: string): ApiError =>
  new ApiError(409, code, "RAW ENGLISH SERVER MESSAGE");

afterEach(() => {
  setActiveStrings(EN);
  vi.unstubAllGlobals();
});

describe("apiErrorText", () => {
  it("localizes all activity authoring and generation errors in English", () => {
    const codes = [
      "activity_invalid",
      "activity_exists",
      "activity_not_found",
      "activity_stopping",
      "collection_not_found",
      "draft_conflict",
      "spec_invalid",
      "description_required",
      "generation_running",
      "run_not_found",
      "project_deleting",
    ];
    for (const dict of [EN]) {
      setActiveStrings(dict);
      for (const code of codes) {
        const text = apiErrorText(serverError(code));
        expect(text, code).not.toBe("RAW ENGLISH SERVER MESSAGE");
        expect(text, code).not.toMatch(/[一-鿿]/);
      }
    }
  });
  it("localizes each compaction refusal separately in English", () => {
    const codes = ["compaction_not_configured", "nothing_to_compact", "already_compacted"];

    for (const dict of [EN]) {
      setActiveStrings(dict);
      const texts = codes.map((c) => apiErrorText(serverError(c)));
      // Mapped, so the raw server message never reaches the user.
      for (const t of texts) expect(t).not.toBe("RAW ENGLISH SERVER MESSAGE");
      // Three reasons, three explanations: telling someone who just compacted that they have
      // not spoken yet is the regression this guards.
      expect(new Set(texts).size).toBe(3);
    }
  });

  it("gives the UI English text for the errors it can surface", () => {
    setActiveStrings(EN);
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
      "internal",
    ];
    for (const code of reachable) {
      const text = apiErrorText(serverError(code));
      expect(text, `${code} is not localized`).not.toBe("RAW ENGLISH SERVER MESSAGE");
      expect(text, `${code} contains translated text`).not.toMatch(/[一-鿿]/);
    }
  });

  it("still falls back to the server message for a code nobody has mapped", () => {
    setActiveStrings(EN);
    expect(apiErrorText(serverError("some_code_from_the_future"))).toBe(
      "RAW ENGLISH SERVER MESSAGE",
    );
  });

  it("reports a non-ApiError as the generic failure, not a stray object", () => {
    setActiveStrings(EN);
    expect(apiErrorText(new Error("boom"))).toBe(S.common.unknownError);
  });

  it("keeps a numeric Retry-After header on the ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "platform_rate_limited", message: "slow down" } }),
            {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "7" },
            },
          ),
      ),
    );

    await expect(apiFetch("/api/platform-rate-limit-test")).rejects.toMatchObject({
      status: 429,
      code: "platform_rate_limited",
      retryAfterSeconds: 7,
    });
  });
});

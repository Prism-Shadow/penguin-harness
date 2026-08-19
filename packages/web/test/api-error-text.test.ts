/**
 * Server error → localized display text (`apiErrorText`).
 *
 * The server's error messages are English-only by design, so the UI derives its text from the
 * error **code**. Any code missing from the table falls through to the raw English message —
 * which is how English prose ends up in a Chinese UI. These tests pin the codes a user actually
 * meets, and pin that the three "cannot compact" reasons stay three distinct explanations
 * rather than collapsing into one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";
import { S, setActiveStrings, zh as ZH } from "../src/lib/strings";
import { en as EN } from "../src/lib/strings-en";

/** The English message the server actually sends, so an unmapped code is visibly distinguishable. */
const serverError = (code: string): ApiError =>
  new ApiError(409, code, "RAW ENGLISH SERVER MESSAGE");

afterEach(() => setActiveStrings(ZH));

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

  it("keeps the zh and en code tables in step", () => {
    // A code localized in one language and not the other is the same bug in the other
    // direction; the Strings type pins the key set, this pins that neither side is empty.
    expect(Object.keys(EN.errors.byCode)).toEqual(Object.keys(ZH.errors.byCode));
    for (const [code, text] of Object.entries(EN.errors.byCode)) {
      expect(text, `${code} has no English text`).not.toBe("");
      expect(ZH.errors.byCode[code as keyof typeof ZH.errors.byCode]).not.toBe("");
    }
  });

  it("reports a non-ApiError as the generic failure, not a stray object", () => {
    setActiveStrings(ZH);
    expect(apiErrorText(new Error("boom"))).toBe(S.common.unknownError);
  });
});

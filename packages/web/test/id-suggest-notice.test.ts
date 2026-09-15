/**
 * id-suggest-notice.ts unit tests: a model-made id says nothing, a transliteration gets the
 * quiet note, a placeholder gets the attention-toned one with the server's reason spelled out
 * in the reader's language, and a reason this build does not know still produces a sentence
 * rather than dropping the note that tells the user the box holds a placeholder.
 */
import { describe, expect, it } from "vitest";
import type {
  SemanticIdSuggestReason,
  SemanticIdSuggestResponse,
} from "@prismshadow/penguin-server/api";
import { idSuggestNotice } from "../src/features/company/id-suggest-notice";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const REASONS = Object.keys({
  no_default_model: true,
  model_failed: true,
  unusable_answer: true,
  no_ascii: true,
} satisfies Record<SemanticIdSuggestReason, true>) as SemanticIdSuggestReason[];

describe("the reason dictionaries", () => {
  for (const [locale, dict] of Object.entries({ zh, en })) {
    it(`${locale} carries a phrase for every reason the contract declares, and no other`, () => {
      expect(Object.keys(dict.company.idSuggest.reasons).sort()).toEqual([...REASONS].sort());
    });
  }
});

describe("idSuggestNotice", () => {
  it("says nothing about an id the model produced", () => {
    const res: SemanticIdSuggestResponse = { id: "co_research_lab", source: "model" };
    expect(idSuggestNotice(res, zh.company.idSuggest)).toBeNull();
    expect(idSuggestNotice(res, en.company.idSuggest)).toBeNull();
  });

  it("notes a transliteration quietly: nothing went wrong, it is just mechanical", () => {
    const res: SemanticIdSuggestResponse = { id: "co_plugin_marketplace", source: "fallback" };
    expect(idSuggestNotice(res, zh.company.idSuggest)).toEqual({
      tone: "muted",
      text: "按名称转写生成",
    });
    expect(idSuggestNotice(res, en.company.idSuggest)?.tone).toBe("muted");
  });

  it("asks for a real name when the id is a placeholder, and names the reason", () => {
    for (const reason of REASONS) {
      const res: SemanticIdSuggestResponse = {
        id: "co_org_20260909",
        source: "placeholder",
        reason,
      };
      const note = idSuggestNotice(res, zh.company.idSuggest);
      expect(note?.tone, reason).toBe("attention");
      expect(note?.text, reason).toContain(zh.company.idSuggest.reasons[reason]);
      expect(idSuggestNotice(res, en.company.idSuggest)?.text, reason).toContain(
        en.company.idSuggest.reasons[reason],
      );
    }
  });

  it("still tells the user it is a placeholder when the reason is one this build cannot read", () => {
    const newer = {
      id: "co_org_20260909",
      source: "placeholder",
      reason: "quota_exhausted",
    } as unknown as SemanticIdSuggestResponse;
    for (const dict of [zh, en]) {
      const note = idSuggestNotice(newer, dict.company.idSuggest);
      expect(note?.tone).toBe("attention");
      expect(note?.text).toContain(dict.company.idSuggest.reasonUnknown);
    }
  });

  it("names no reason it was not given (a placeholder with the field absent)", () => {
    const res = { id: "co_org_20260909", source: "placeholder" } as SemanticIdSuggestResponse;
    expect(idSuggestNotice(res, en.company.idSuggest)?.text).toContain(
      en.company.idSuggest.reasonUnknown,
    );
  });
});

import { describe, expect, it } from "vitest";
import type { ModuleDocument } from "@prismshadow/penguin-server/api";
import {
  assessmentItemCount,
  documentChanged,
  documentOrigin,
  documentText,
  parseDocument,
} from "../src/features/activities/module-document";

const document: ModuleDocument = {
  file: "configurations/words-12.json",
  value: { maxRounds: 3 },
  edited: false,
  stale: false,
  editable: true,
};

describe("a module document in the editor", () => {
  it("shows as indented JSON, and is unchanged until what it says changes", () => {
    const text = documentText({ maxRounds: 3 });
    expect(text).toBe('{\n  "maxRounds": 3\n}');
    expect(documentChanged(text, { maxRounds: 3 })).toBe(false);
    expect(documentChanged('{"maxRounds":3}', { maxRounds: 3 })).toBe(false);
    expect(documentChanged('{"maxRounds":4}', { maxRounds: 3 })).toBe(true);
    expect(documentChanged("{", { maxRounds: 3 })).toBe(true);
  });

  it("parses to an object, or says why it cannot be saved", () => {
    expect(parseDocument('{"a": 1}')).toEqual({ value: { a: 1 } });
    const broken = parseDocument("{ a: 1 }");
    expect("error" in broken && broken.error).toMatch(/^This is not valid JSON: /);
    expect(parseDocument("[1, 2]")).toEqual({ error: "The document must be a JSON object." });
    expect(parseDocument("null")).toEqual({ error: "The document must be a JSON object." });
  });

  it("says where it came from", () => {
    expect(documentOrigin("checkout", document)).toBe(
      "configurations/words-12.json, from the module in the WAF checkout.",
    );
    expect(documentOrigin("run", document)).toBe(
      "configurations/words-12.json, from the module this activity assembled.",
    );
    expect(documentOrigin("draft", { ...document, edited: true })).toBe(
      "Edited in this activity; no module has been assembled yet.",
    );
  });

  it("counts an assessment's items", () => {
    expect(assessmentItemCount({ items: [{}, {}] })).toBe(2);
    expect(assessmentItemCount({ maxRounds: 3 })).toBeNull();
    expect(assessmentItemCount(null)).toBeNull();
  });
});

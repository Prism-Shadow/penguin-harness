/**
 * The llm module's export surface, audited and pinned
 * (ticket 2026-09-25-core-llm-audit-the-export-surface).
 *
 * The audit walked every export of `src/llm` and named the test that covers it; that list lives in
 * the ticket's `## Result`. Every *behaviour* turned out to be covered by an existing test. What
 * nothing watched is the surface itself and one number on it, both measured by mutation:
 *
 *   1. `src/llm/index.ts`. Its unit tests reach the context-limits, list-models and tool-call-id
 *      entry points by deep file path, and only four of the index's symbols are imported from the
 *      index by production code, so an entry point dropped from the index — a real regression of
 *      the module's contract for every consumer — left the whole suite and the typecheck green.
 *      Removing `resolveContextWindow` from `index.ts` failed no test file before this one existed.
 *   2. `DEFAULT_CONTEXT_WINDOW`'s value. Every assertion about it elsewhere is relational
 *      (`DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM`, "greater than the other default"), so the
 *      assumed window of a model entry with no usable `context_window` could change silently. The
 *      module's own doc makes the number contract: it mirrors the web app's display default
 *      (`packages/web/src/lib/context.ts`, `DEFAULT_CONTEXT_WINDOW`) precisely so that every
 *      consumer of an unknown window reasons from the same number.
 *
 * Deliberately not pinned here: `OUTPUT_SAFETY_MARGIN`, the module's single tunable — the other
 * tests pin the relations its two derived numbers must satisfy — and nothing else, since every
 * entry point's behaviour already has a covering test in this suite.
 */
import { describe, expect, it } from "vitest";
import * as contextLimits from "../src/llm/context-limits.js";
import * as generativeModel from "../src/llm/generative-model.js";
import * as llm from "../src/llm/index.js";
import * as listModels from "../src/llm/list-models.js";
import * as toolCallIds from "../src/llm/tool-call-ids.js";

type ModuleSurface = Record<string, unknown>;
type EntryKind = "class" | "function" | "value";

interface AuditedEntry {
  /** The published name, as a consumer writes it. */
  name: string;
  /** What the name must be at runtime. */
  kind: EntryKind;
  /** The module the index re-exports it from — the implementation it must still be identical to. */
  source: ModuleSurface;
}

/**
 * Every runtime entry point `src/llm/index.ts` publishes, in the audit's order.
 *
 * The type-only export `ListEndpointModelsOptions` cannot appear here — it exists only in the
 * typecheck, which covers it through `listEndpointModels`'s signature. Two further exports of the
 * module are file-level only and deliberately outside the index: `describeError`
 * (`generative-model.ts`) and `MIN_USABLE_CONTEXT_WINDOW` (`context-limits.ts`); both are covered
 * by their own tests (`describe-error.test.ts`, `context-limits.test.ts`).
 */
const AUDITED: AuditedEntry[] = [
  { name: "GenerativeModel", kind: "class", source: generativeModel },
  { name: "EventTranslator", kind: "class", source: generativeModel },
  { name: "groupHistoryToUniMessages", kind: "function", source: generativeModel },
  { name: "mergeOmniToUniMessage", kind: "function", source: generativeModel },
  { name: "translateEvents", kind: "function", source: generativeModel },
  { name: "usageToTokenCounts", kind: "function", source: generativeModel },
  { name: "isMalformedJsonParseError", kind: "function", source: generativeModel },
  { name: "isIncompleteStreamError", kind: "function", source: generativeModel },
  { name: "isFatalProviderRejection", kind: "function", source: generativeModel },
  { name: "isAuthenticationError", kind: "function", source: generativeModel },
  { name: "isFastModeUnsupportedError", kind: "function", source: generativeModel },
  { name: "FAST_MODE_UNSUPPORTED_GUIDANCE", kind: "value", source: generativeModel },
  { name: "mapThinkingLevel", kind: "function", source: generativeModel },
  { name: "toolDefinitionsToSchemas", kind: "function", source: generativeModel },
  { name: "buildUniConfig", kind: "function", source: generativeModel },
  { name: "listEndpointModels", kind: "function", source: listModels },
  { name: "ToolCallIdAllocator", kind: "class", source: toolCallIds },
  { name: "stripToolCallIdSuffix", kind: "function", source: toolCallIds },
  { name: "DEFAULT_CONTEXT_WINDOW", kind: "value", source: contextLimits },
  { name: "DEFAULT_MAX_CONTEXT_LENGTH", kind: "value", source: contextLimits },
  { name: "OUTPUT_SAFETY_MARGIN", kind: "value", source: contextLimits },
  { name: "MIN_OUTPUT_TOKENS", kind: "value", source: contextLimits },
  { name: "COMPACTION_HEADROOM", kind: "value", source: contextLimits },
  { name: "resolveContextWindow", kind: "function", source: contextLimits },
  { name: "approximateTokens", kind: "function", source: contextLimits },
  { name: "approximateMessagesTokens", kind: "function", source: contextLimits },
  { name: "effectiveMaxOutputTokens", kind: "function", source: contextLimits },
  { name: "effectiveMaxContextLength", kind: "function", source: contextLimits },
];

function kindOf(value: unknown): EntryKind | "missing" {
  if (value === undefined) return "missing";
  if (typeof value === "function") {
    return /^class[\s{]/.test(Function.prototype.toString.call(value)) ? "class" : "function";
  }
  return "value";
}

describe("src/llm/index.ts export surface", () => {
  it("publishes exactly the audited entry points, nothing silently dropped or unaudited", () => {
    expect(
      Object.keys(llm).sort(),
      "src/llm/index.ts changed: add the new entry point to AUDITED together with the test that " +
        "covers its behaviour, or put the removed one back",
    ).toEqual(AUDITED.map((entry) => entry.name).sort());
  });

  it.each(AUDITED)("publishes $name as the audited $kind", ({ name, kind, source }) => {
    const published = llm as unknown as ModuleSurface;
    expect(kindOf(published[name]), `${name} is not a ${kind} on the index`).toBe(kind);
    // Identity, not just presence: the index must not quietly point a consumer at a different
    // implementation than the audited one.
    expect(published[name], `${name} on the index is not the audited export`).toBe(source[name]);
  });
});

describe("the default the surface publishes", () => {
  it("assumes 128000 tokens for a model entry with no usable context_window", () => {
    // See the file header: every other assertion uses this constant relationally, and the value is
    // what makes an unknown-window model compaction the same on the SDK side and in the web app's
    // display — change it there and here, in one deliberate commit, or not at all.
    expect(contextLimits.DEFAULT_CONTEXT_WINDOW).toBe(128_000);
  });
});

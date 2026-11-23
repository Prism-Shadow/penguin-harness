/**
 * What a folded call's arguments show until the whole arrives (lib/history/elided-preview.ts
 * `elidedArgumentsPreview`), over records folded by the core's own rule (`elideHistoryRecord`).
 *
 * - Given a call whose file content came folded, the content reads head, gap, tail where it sits
 *   in the arguments, and every other argument reads as it was: a folded argument is never
 *   mistaken for the whole of it.
 * - Given a key that needs escaping in a JSON Pointer (`a/b`), its value is found and cut too.
 * - Given arguments that are not JSON, folded whole, they are cut as plain text.
 * - Given nothing folded, the arguments are shown exactly as they came.
 */
import { describe, expect, it } from "vitest";
import { toolCall } from "@prismshadow/amsp";
import type { ToolCallPayload } from "@prismshadow/amsp";
import { ELIDE_PREVIEW, elideHistoryRecord } from "@prismshadow/penguin-core/interfaces";
import { elidedArgumentsPreview } from "../src/lib/history/elided-preview";
import type { ElidedRecord } from "../src/lib/amsp/stream-model";

const SOURCE = { agentId: "a1", sessionId: "s1", fileIndex: 1, ordinal: 4 };
const GAP = "\n…\n";

/** A call with `args` as its arguments, folded as a history window folds it. */
function folded(args: string): { text: string; elided: ElidedRecord | undefined } {
  const { record, elided } = elideHistoryRecord(
    toolCall({ name: "write_file", arguments: args, toolCallId: "w1" }),
    SOURCE,
  );
  return {
    text: (record.payload as ToolCallPayload).arguments,
    elided: elided.length > 0 ? { record, entries: elided } : undefined,
  };
}

const content = Array.from({ length: 900 }, (_, i) => `line ${i}: ${"z".repeat(40)}`).join("\n");

describe("a folded call's arguments as shown", () => {
  it("cut the folded content visibly where it sits, and leave every other argument as it was", () => {
    const { text, elided } = folded(JSON.stringify({ file_path: "/w/big.txt", content }));
    const shown = JSON.parse(elidedArgumentsPreview(text, elided, GAP)) as Record<string, string>;
    expect(shown.file_path).toBe("/w/big.txt");
    const head = content.slice(0, ELIDE_PREVIEW.head);
    const tail = content.slice(-ELIDE_PREVIEW.tail);
    expect(shown.content).toBe(`${head}${GAP}${tail}`);
  });

  it("find a value under a key a JSON Pointer escapes", () => {
    const { text, elided } = folded(JSON.stringify({ edits: { "a/b": content } }));
    const shown = JSON.parse(elidedArgumentsPreview(text, elided, GAP)) as {
      edits: Record<string, string>;
    };
    expect(shown.edits["a/b"]).toContain(GAP);
  });

  it("cut arguments that are not JSON as plain text", () => {
    const raw = `not json ${content}`;
    const { text, elided } = folded(raw);
    expect(elided?.entries.map((e) => e.path)).toEqual(["payload.arguments#"]);
    const shown = elidedArgumentsPreview(text, elided, GAP);
    expect(shown.startsWith(raw.slice(0, ELIDE_PREVIEW.head))).toBe(true);
    expect(shown.endsWith(raw.slice(-ELIDE_PREVIEW.tail))).toBe(true);
    expect(shown).toContain(GAP);
  });

  it("show arguments with nothing folded exactly as they came", () => {
    const args = '{ "file_path": "/w/small.txt",  "content": "hi" }';
    const { text, elided } = folded(args);
    expect(elided).toBeUndefined();
    expect(elidedArgumentsPreview(text, elided, GAP)).toBe(args);
  });
});

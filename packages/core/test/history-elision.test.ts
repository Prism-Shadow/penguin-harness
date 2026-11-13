/**
 * Folding a history record's bulky values (interfaces/history-elision.ts), the one rule a
 * server and the Web App share.
 *
 * - Given a tool output above the threshold, the record keeps the output's head and tail and
 *   one entry naming its path and full size; a value just under the threshold stays whole.
 * - Given a tool call whose argument holds a long string, that string folds while the arguments
 *   stay valid JSON and its short fields (the path a card shows) stay whole.
 * - Given a child record's inline screenshot, the image folds to nothing (half a data URL draws
 *   nothing); an image already served by reference is left alone.
 * - Given a long thinking block, it folds; given a small record, the same object comes back.
 * - Given a record already folded, folding it again changes nothing.
 * - Given an entry's ref, it names the record's line and path, and the whole value read at that
 *   path from the original record, put back, gives the original record.
 * - Given something that is not a ref — or a ref whose Agent or Session is not an id (`..`, a
 *   `/`), the shape a path traversal takes — nothing is decoded.
 */
import { describe, expect, it } from "vitest";
import { thinkingMessage, toolCall, toolCallOutput, userText } from "../src/index.js";
import type { AmspRecord } from "../src/index.js";
import {
  bodyAt,
  decodeBodyRef,
  encodeBodyRef,
  ELIDE_BYTES,
  ELIDE_PREVIEW,
  elideHistoryRecord,
  withElidedBody,
} from "../src/interfaces/index.js";
import type { BodySource, HistoryRecordLike } from "../src/interfaces/index.js";

const SOURCE: BodySource = { agentId: "worker", sessionId: "s-1", fileIndex: 2, ordinal: 17 };
const payload = (r: AmspRecord) => r.payload as unknown as Record<string, unknown>;

/** A long text with distinct lines, so a head and a tail are told apart. */
const longText = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `line ${i} ${"·".repeat(40)}`).join("\n");

describe("history elision", () => {
  it("a tool output above the threshold keeps its head and tail and one entry with its size", () => {
    const output = longText(800);
    const record = toolCallOutput({ output, toolCallId: "t1", status: "completed" });
    const { record: folded, elided } = elideHistoryRecord(record, SOURCE);
    expect(elided).toHaveLength(1);
    expect(elided[0]).toMatchObject({
      path: "payload.output",
      bytes: Buffer.byteLength(output),
      lines: 800,
      head: ELIDE_PREVIEW.head,
    });
    const preview = payload(folded).output as string;
    expect(preview).toBe(output.slice(0, ELIDE_PREVIEW.head) + output.slice(-ELIDE_PREVIEW.tail));
    expect((folded as HistoryRecordLike).elided).toEqual(elided);
    // The rest of the record is untouched.
    expect(payload(folded).status).toBe("completed");

    const under = toolCallOutput({
      output: "x".repeat(ELIDE_BYTES),
      toolCallId: "t2",
      status: "completed",
    });
    expect(elideHistoryRecord(under, SOURCE).record).toBe(under);
  });

  it("a long argument folds while the arguments stay JSON and the short fields stay whole", () => {
    const content = longText(600);
    const args = JSON.stringify({ file_path: "/w/src/big.ts", content, mode: "overwrite" });
    const record = toolCall({ name: "write_file", arguments: args, toolCallId: "t3" });
    const { record: folded, elided } = elideHistoryRecord(record, SOURCE);
    const parsed = JSON.parse(payload(folded).arguments as string) as Record<string, string>;
    expect(parsed.file_path).toBe("/w/src/big.ts");
    expect(parsed.mode).toBe("overwrite");
    expect(parsed.content!.length).toBe(ELIDE_PREVIEW.head + ELIDE_PREVIEW.tail);
    expect(elided.map((e) => e.path)).toEqual(["payload.arguments#/content"]);
  });

  it("a child's inline screenshot folds to nothing; an image by reference stays", () => {
    const shot = `data:image/png;base64,${"A".repeat(ELIDE_BYTES + 10)}`;
    const ref = "/api/sessions/s-1/trace-image?file=2&ordinal=17&i=1";
    const record = toolCallOutput({
      output: "two shots",
      toolCallId: "t4",
      status: "completed",
      images: [shot, ref],
    });
    const { record: folded, elided } = elideHistoryRecord(record, SOURCE);
    expect(payload(folded).images).toEqual(["", ref]);
    expect(elided).toEqual([expect.objectContaining({ path: "payload.images.0", head: 0 })]);
    expect(elided[0]!.lines).toBeUndefined();
  });

  it("a long thinking block folds; a small record comes back as the same object", () => {
    const { elided } = elideHistoryRecord(thinkingMessage(longText(700)), SOURCE);
    expect(elided.map((e) => e.path)).toEqual(["payload.thinking"]);
    const small = userText("hello");
    const result = elideHistoryRecord(small, SOURCE);
    expect(result.record).toBe(small);
    expect(result.elided).toEqual([]);
  });

  it("folding a folded record again changes nothing", () => {
    const record = toolCallOutput({ output: longText(900), toolCallId: "t5", status: "completed" });
    const once = elideHistoryRecord(record, SOURCE);
    const twice = elideHistoryRecord(once.record, SOURCE);
    expect(twice.record).toBe(once.record);
    expect(twice.elided).toEqual(once.elided);
  });

  it("a ref names the record's line and path, and the value read there restores the record", () => {
    const content = longText(500);
    const args = JSON.stringify({ path: "/w/a.md", edits: [{ new_string: content }] });
    const original = toolCall({ name: "edit_file", arguments: args, toolCallId: "t6" });
    const { record: folded, elided } = elideHistoryRecord(original, SOURCE);
    const entry = elided[0]!;
    expect(decodeBodyRef(entry.ref)).toEqual({
      ...SOURCE,
      path: "payload.arguments#/edits/0/new_string",
    });
    const value = bodyAt(original, entry.path);
    expect(value).toBe(content);
    const restored = withElidedBody(folded, entry.path, value!);
    expect(JSON.parse(payload(restored).arguments as string)).toEqual(JSON.parse(args));
    expect((restored as HistoryRecordLike).elided).toBeUndefined();

    const output = longText(800);
    const out = toolCallOutput({ output, toolCallId: "t7", status: "completed" });
    const foldedOut = elideHistoryRecord(out, SOURCE);
    const back = withElidedBody(foldedOut.record, "payload.output", bodyAt(out, "payload.output")!);
    expect(back).toEqual(out);
  });

  it("something that is not a ref decodes to nothing", () => {
    expect(decodeBodyRef("not a ref!")).toBeNull();
    for (const agentId of ["../../other/agents/a", "a/b", ".."]) {
      expect(decodeBodyRef(encodeBodyRef({ ...SOURCE, agentId }, "payload.output"))).toBeNull();
    }
    expect(
      decodeBodyRef(encodeBodyRef({ ...SOURCE, sessionId: "../s" }, "payload.output")),
    ).toBeNull();
    expect(decodeBodyRef(Buffer.from('{"a":"x"}').toString("base64url"))).toBeNull();
  });
});

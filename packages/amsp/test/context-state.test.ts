/**
 * Whether a Trace file's context is closed, as the records say (replay rule 1):
 *
 * - Given a completed compaction, when only the Session's own records follow it, then it is
 *   the closing one; once a request_begin follows, nothing closed the context.
 * - Given a session_update naming a model, when no request_begin follows it, then its model is
 *   pending — the last one wins; a record naming half a model names none.
 * - Given a stream that relays a child Session's records, then a child's request_begin reopens
 *   nothing: only the main Session's records count.
 */
import { describe, expect, it } from "vitest";
import {
  closingCompaction,
  compactionBegin,
  compactionEnd,
  pendingModel,
  requestBegin,
  requestEnd,
  sessionUpdate,
  taskBegin,
  taskEnd,
  updatedModel,
  userText,
  withOrigin,
} from "../src/records/index.js";

const B = { provider: "openai", model_id: "gpt-5.2" };

describe("closingCompaction", () => {
  it("names the completed compaction_end behind which only the Session's own records follow", () => {
    const end = compactionEnd({ reason: "manual", mode: "summarize", status: "completed" });
    const file = [
      compactionBegin({ reason: "manual", mode: "summarize", context: 10, turns: 1 }),
      end,
      taskEnd(),
      sessionUpdate(B),
      taskBegin(),
      userText("next?"),
    ];
    expect(closingCompaction(file)).toBe(end);
    expect(closingCompaction([...file, requestBegin()])).toBeUndefined();
  });

  it("names none for a compaction that kept the context", () => {
    const file = [
      compactionBegin({ reason: "manual", mode: "summarize", context: 10, turns: 1 }),
      compactionEnd({ reason: "manual", mode: "summarize", status: "aborted" }),
    ];
    expect(closingCompaction(file)).toBeUndefined();
  });
});

describe("pendingModel", () => {
  it("is the last model a session_update names, until a request_begin follows", () => {
    const file = [
      requestBegin(),
      requestEnd("completed"),
      sessionUpdate({ provider: "google", model_id: "gemini-3-pro" }),
      sessionUpdate(B),
    ];
    expect(pendingModel(file)).toEqual(B);
    expect(pendingModel([...file, requestBegin()])).toBeUndefined();
  });

  it("reads no model from a record that names half of one", () => {
    expect(updatedModel(sessionUpdate({ provider: "openai" }))).toBeUndefined();
    expect(pendingModel([sessionUpdate({ model_id: "gpt-5.2" })])).toBeUndefined();
  });

  it("counts only the main Session's records on a stream that relays a child's", () => {
    const child = "session-2026-11-19-10-00-00-child001";
    const stream = [sessionUpdate(B), withOrigin(requestBegin(), child)];
    expect(pendingModel(stream)).toEqual(B);
    expect(updatedModel(withOrigin(sessionUpdate(B), child))).toBeUndefined();
  });
});

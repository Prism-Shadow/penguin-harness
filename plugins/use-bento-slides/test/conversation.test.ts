import { describe, expect, it } from "vitest";
import {
  newConversation,
  readConversation,
  turnsFor,
} from "../workbenches/slides/ui/conversation.js";

describe("Slides conversation from SessionReader records", () => {
  it("keeps each step beneath its user, with the complete thought, arguments, output and answer once", () => {
    const model = newConversation();
    const emit = (payload: object, origin?: string[]) =>
      readConversation(model, { payload, origin });
    emit({ type: "task_begin" });
    emit({
      type: "text",
      role: "user",
      text: "Deck file: /internal\nTheir request: Add a slide\nUse the bento-slides skill. Edit the file.",
    });
    emit({ type: "task_begin" }, ["helper"]);
    emit({ type: "partial_thinking", event_type: "start", role: "assistant", thinking: "" });
    emit({ type: "partial_thinking", event_type: "delta", role: "assistant", thinking: "Read" });
    emit({ type: "thinking", role: "assistant", thinking: "Read the deck." });
    emit({ type: "tool_call", tool_call_id: "t", name: "read_file", arguments: '{"path":"deck"}' });
    emit({ type: "tool_call_output", tool_call_id: "t", output: "before" });
    emit({ type: "tool_call", tool_call_id: "t", name: "write_file", arguments: "new slide" });
    emit({ type: "tool_call_output", tool_call_id: "t", output: "saved" });
    emit({ type: "text", role: "assistant", text: "Added one slide." });
    emit({ type: "task_end" });
    expect(model.turns).toHaveLength(1);
    const turn = turnsFor([{ role: "user", text: "Add a slide" }], model).get(0);
    expect(turn.status).toBe("completed");
    expect(turn.parts.map((p) => p.kind)).toEqual(["thinking", "tool", "tool", "text"]);
    expect(turn.parts[0].text).toBe("Read the deck.");
    expect(turn.parts[1].output).toBe("before");
    expect(turn.parts[2].output).toBe("saved");
  });
  it("distinguishes a failed, interrupted and retried request; an older identical turn cannot take a queued prompt", () => {
    const model = newConversation();
    const emit = (payload: object, timestamp?: string) =>
      readConversation(model, { payload, timestamp });
    emit({ type: "task_begin" }, "2026-01-01T01:00:02Z");
    emit({ type: "text", role: "user", text: "Repeat" });
    emit({ type: "request_end", status: "failed", error_message: "could not read" });
    emit({ type: "task_end" });
    const msgs = [
      { role: "user", text: "Repeat", at: "2026-01-01T01:00:01Z" },
      { role: "user", text: "Repeat", at: "2026-01-01T01:01:01Z" },
    ];
    const linked = turnsFor(msgs, model);
    expect(linked.get(0)?.error).toBe("could not read");
    expect(linked.has(1)).toBe(false);
    emit({ type: "task_begin" }, "2026-01-01T01:01:02Z");
    emit({ type: "text", role: "user", text: "Repeat" });
    emit({ type: "abort", reason: "Stopped" });
    emit({ type: "task_end" });
    expect(turnsFor(msgs, model).get(1)?.status).toBe("interrupted");
  });
});

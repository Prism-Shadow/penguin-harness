// @vitest-environment jsdom
/**
 * A running slide task shows one status. A person can open its history and individual steps,
 * and a server refresh keeps that choice when it replaces the optimistic message timestamp.
 * Pending calls reveal their arguments and approval actions when opened. A failed turn can retry.
 */
import { expect, it, vi } from "vitest";
import { showConversation } from "../workbenches/slides/ui/conversation-view.js";
import { newConversation, readConversation } from "../workbenches/slides/ui/conversation.js";

function scenario() {
  const list = document.createElement("ul");
  const model = newConversation();
  const messages = [{ role: "user", text: "Check the page", at: "10:00:00.010" }];
  const options = { locale: "en", running: true, retry: vi.fn(), decide: vi.fn() };
  const emit = (payload: object) => readConversation(model, { payload, timestamp: "10:00:00.100" });
  const render = (patch = {}) => showConversation(list, messages, model, { ...options, ...patch });
  emit({ type: "task_begin" });
  emit({ type: "text", role: "user", text: "Check the page" });
  emit({ type: "thinking", role: "assistant", thinking: "Compare the figures." });
  emit({
    type: "tool_call",
    tool_call_id: "file",
    name: "read_file",
    arguments: { path: "notes" },
  });
  return { list, messages, emit, options, render };
}

it("keeps an opened step beneath its original prompt across the optimistic-to-saved refresh", () => {
  const { list, messages, emit, render } = scenario();
  render();
  const group = list.querySelector("details")!;
  expect(group.previousElementSibling?.textContent).toBe("Check the page");
  expect(group.open).toBe(false);
  expect(group.firstElementChild?.textContent).toBe("Reading a file");
  group.open = true;
  group.querySelector("details")!.open = true;
  messages[0]!.at = "10:00:00.060";
  emit({ type: "tool_call_output", tool_call_id: "file", output: "12" });
  emit({ type: "text", role: "assistant", text: "The totals match." });
  emit({ type: "task_end" });
  render({ running: false });
  const complete = list.querySelector("details")!;
  expect(complete.open).toBe(true);
  expect(complete.firstElementChild?.textContent).toBe("Completed");
  expect(complete.querySelectorAll("details[open]")).toHaveLength(1);
  expect(complete.nextElementSibling?.textContent).toBe("The totals match.");
  complete.open = false;
  render({ running: false });
  expect(list.querySelector("details")!.open).toBe(false);
});

it("puts pending decisions inside the status and leaves a failed turn's retry beside its error", () => {
  const { list, messages, emit, options, render } = scenario();
  messages.push({ role: "user", text: "Check the next page", at: "10:00:00.150" });
  render({
    approvals: [
      { tool_call: { tool_call_id: "file", name: "read_file", arguments: { path: "notes" } } },
    ],
  });
  const group = list.querySelector("details")!;
  expect(group.open).toBe(false);
  expect(group.firstElementChild?.textContent).toBe("Approval needed");
  expect(list.lastElementChild?.textContent).toBe("Check the next pageQueued");
  group.open = true;
  expect(group.querySelector("pre")?.textContent).toContain("notes");
  group.querySelector("button")!.click();
  expect(options.decide).toHaveBeenCalledWith("file", "allow");
  emit({ type: "request_end", status: "failed", error_message: "Disconnected" });
  emit({ type: "task_end" });
  render({ running: false });
  expect(list.querySelector(".turn-error")?.textContent).toBe("Disconnected");
  list.querySelector<HTMLButtonElement>(".turn-retry")!.click();
  expect(options.retry).toHaveBeenCalledWith("Check the page");
});

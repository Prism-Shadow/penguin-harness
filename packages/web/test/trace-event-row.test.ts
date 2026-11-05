// @vitest-environment jsdom
/**
 * A Trace event row (features/traces/trace-event-row.tsx), as a reader opens it.
 *
 * - The row's one pill names the record's kind, and the role where a kind's role varies:
 *   `text (user)`, `text (assistant)`, `inline_data (user)`; any other kind is bare. The text's
 *   summary is its text alone.
 * - The pill's tone tells the families apart: a `model_msg` neutral, an `event_msg` attention.
 * - Opened, the `session_meta` row lists the Session's fields, the provider among them.
 * - Opened, a record that completed carries no status badge; one that did not names its status.
 * - A summary the row's context computed (a thinking-level change) replaces the record's own.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AmspRecord } from "@prismshadow/amsp";
import { EventRow } from "../src/features/traces/trace-event-row";
import { click, mount, unmountAll } from "./helpers/dom";

const at = "2026-10-23T02:32:26.000Z";
const record = (
  type: "model_msg" | "event_msg" | "session_meta",
  payload: Record<string, unknown>,
): AmspRecord => ({ timestamp: at, type, payload }) as unknown as AmspRecord;

/** Renders one row per record and returns the rows, in order. */
async function rows(msgs: AmspRecord[], summary?: string): Promise<HTMLLIElement[]> {
  await mount(
    h(
      "ul",
      null,
      msgs.map((msg, i) =>
        h(EventRow, {
          key: i,
          msg,
          rowKey: `0-${i}`,
          matched: false,
          ...(summary !== undefined ? { summary } : {}),
        }),
      ),
    ),
  );
  return [...document.querySelectorAll<HTMLLIElement>("[data-trace-row]")];
}

/** The row's line, as read: the text of its toggle. */
const line = (row: HTMLLIElement): string => row.querySelector("button")?.textContent ?? "";

describe("a Trace event row", () => {
  afterEach(() => unmountAll());

  it("names the record's kind in its pill, with the role where the kind's role varies", async () => {
    const [user, assistant, image, thinking, call] = await rows([
      record("model_msg", { type: "text", role: "user", text: "list the files" }),
      record("model_msg", { type: "text", role: "assistant", text: "Done." }),
      record("model_msg", { type: "inline_data", role: "user", mime_type: "image/png", data: "" }),
      record("model_msg", { type: "thinking", role: "assistant", thinking: "Hmm." }),
      record("model_msg", { type: "tool_call", role: "assistant", name: "exec_command" }),
    ]);

    expect(line(user!)).toContain("text (user)list the files");
    expect(line(user!)).not.toContain("user:");
    expect(line(assistant!)).toContain("text (assistant)Done.");
    expect(line(image!)).toContain("inline_data (user)");
    expect(line(thinking!)).toContain("thinkingHmm.");
    expect(line(call!)).toContain("tool_callexec_command");
  });

  it("tones its pill by the record's family", async () => {
    const [model, event] = await rows([
      record("model_msg", { type: "text", role: "user", text: "hi" }),
      record("event_msg", { type: "request_begin" }),
    ]);
    const pill = (row: HTMLLIElement) => row.querySelector("button [class*='bg-tone-']")!.className;

    expect(pill(model!)).toContain("bg-tone-neutral-bg");
    expect(pill(event!)).toContain("bg-tone-attention-bg");
  });

  it("opened, the session_meta row lists the Session's fields", async () => {
    const [meta] = await rows([
      record("session_meta", {
        session_id: "s-1",
        source: "user",
        provider: "deepseek",
        model_id: "deepseek-v4",
        model_context_window: 1_000_000,
        agent_state: "/a",
        workspace: "/w",
        system_prompt: "",
      }),
    ]);
    await click(meta!.querySelector("button")!);

    for (const value of ["s-1", "deepseek", "deepseek-v4", "1000000", "/a", "/w"]) {
      expect(meta!.textContent).toContain(value);
    }
  });

  it("opened, shows a status badge only for a record that did not complete", async () => {
    const [done, nonZero, denied] = await rows([
      record("model_msg", {
        type: "tool_call_output",
        role: "user",
        tool_call_id: "c1",
        output: "a.txt",
        status: "completed",
      }),
      // A command that exited non-zero ran: its status is the output's last note, not a failure.
      record("model_msg", {
        type: "tool_call_output",
        role: "user",
        tool_call_id: "c2",
        output: "ls: cannot access\n[exit code: 2]",
        status: "completed",
      }),
      record("model_msg", {
        type: "tool_call_output",
        role: "user",
        tool_call_id: "c3",
        output: "denied",
        status: "aborted",
      }),
    ]);
    for (const row of [done!, nonZero!, denied!]) await click(row.querySelector("button")!);

    expect(done!.textContent).not.toContain("completed");
    expect(nonZero!.textContent).toContain("[exit code: 2]");
    expect(nonZero!.textContent).not.toContain("completed");
    expect(denied!.textContent).toContain("aborted");
  });

  it("takes a summary its context computed in place of the record's own", async () => {
    const [begin] = await rows(
      [record("event_msg", { type: "request_begin", thinking_level: "high" })],
      "thinking_level=medium → high",
    );
    expect(line(begin!)).toContain("request_beginthinking_level=medium → high");
  });
});

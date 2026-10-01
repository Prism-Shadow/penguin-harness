/**
 * ToolCallCard (src/components/chat/tool-call-card/tool-call-card.tsx) and the approval block it
 * holds (src/components/chat/approval-block/approval-block.tsx): the activity hook's markup, the
 * chevron named in the interface's words, and a waiting call's block — on screen while the card
 * is collapsed, with the preview, the payload and the two decisions in the caller's words.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ToolCallCard } from "../src/components/chat/tool-call-card/tool-call-card";
import type { ToolCallCardProps } from "../src/components/chat/tool-call-card/tool-call-card";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { renderStatic } from "../src/testing";

const zh = { ...DEFAULT_UI_STRINGS, expand: "展开", collapse: "折叠" };
const inZh = (element: ReactElement) =>
  renderStatic(createElement(UiStringsProvider, { strings: zh }, element));

const card = (props: Partial<ToolCallCardProps>) =>
  inZh(
    createElement(ToolCallCard, {
      state: "done",
      stateLabel: "Done",
      name: "Run command",
      nameTooltip: "exec_command",
      argumentsText: '{"cmd":"ls -la"}',
      ...props,
    }),
  );

describe("ToolCallCard", () => {
  it("is a tool step for the activity hook, its name the label slot", () => {
    const html = card({ state: "running", subtitle: "List the files" });
    expect(html).toMatch(/class="ui-activity [^"]*" data-kind="tool" data-state="running"/);
    expect(html).toMatch(/data-tooltip="exec_command"[^>]*data-slot="label"[^>]*>Run command</);
    expect(html).toMatch(/data-slot="detail"[^>]*>List the files</);
    expect(html).toContain('data-slot="progress"');
  });

  it("starts collapsed, its chevron named for what pressing it does", () => {
    const html = card({});
    expect(html).toContain('aria-expanded="false" aria-label="展开"');
    expect(html).not.toContain("ls -la");
  });

  it("reads a waiting call's approval as a running step, with no progress slot", () => {
    const html = card({ state: "waiting" });
    expect(html).toContain('data-state="running"');
    expect(html).not.toContain('data-slot="progress"');
  });

  it("shows a live clock with no known start as a still ellipsis", () => {
    const html = card({ state: "running", duration: { live: true } });
    expect(html).toMatch(/data-slot="detail"[^>]*>…</);
    expect(html).not.toContain("animate-pulse");
  });

  it("shows a waiting call's approval block while collapsed, in the caller's words", () => {
    const html = card({
      state: "waiting",
      pending: {
        preview: "$ ls -la",
        payload: "file_path: a.txt",
        onDecide: async () => {},
        labels: { allow: "允许", deny: "拒绝" },
      },
    });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">$ ls -la</span>");
    expect(html).toContain("file_path: a.txt</pre>");
    expect(html).toMatch(/<button[^>]*>允许<\/button>/);
    expect(html).toMatch(/<button[^>]*>拒绝<\/button>/);
  });

  it("holds the marker or the action at the row's end, and the footer below", () => {
    expect(card({ marker: "background" })).toContain(">background</span>");
    const html = card({
      action: { label: "Send to background", hint: "Keep it running", onClick: () => {} },
      footer: "subagent row",
    });
    expect(html).toMatch(/data-tooltip="Keep it running"[^>]*>Send to background<\/button>/);
    expect(html).toContain("subagent row");
  });
});

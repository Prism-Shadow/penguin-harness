/**
 * Notice (src/components/feedback/notice/notice.tsx) and the page to-do built on it
 * (src/components/feedback/todo-notice/todo-notice.tsx): the three variants are layouts of one
 * NoticeStrip, the parts sit in the hook's slots, and the action slots come in reading order
 * with the affirmative one last.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Notice } from "../src/components/feedback/notice/notice";
import type { NoticeVariant } from "../src/components/feedback/notice/notice";
import { TodoNotice } from "../src/components/feedback/todo-notice/todo-notice";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => {};

describe("Notice", () => {
  it("draws every variant through the notice strip, in the tone's words for the hook", () => {
    for (const variant of ["strip", "callout", "inline"] satisfies NoticeVariant[]) {
      const html = renderStatic(
        createElement(Notice, { tone: "attention", variant, children: "Heads up" }),
      );
      expect(classTokens(html), variant).toEqual(
        expect.arrayContaining(["ui-notice", "border-line", "bg-tone-attention-bg"]),
      );
      expect(html).toContain('data-tone="warning"');
    }
    const strip = classTokens(
      renderStatic(createElement(Notice, { tone: "danger", variant: "strip", children: "x" })),
    );
    expect(strip).toContain("border-b");
    expect(strip.some((t) => t.startsWith("rounded"))).toBe(false);
  });

  it("puts its parts in the hook's slots", () => {
    const html = renderStatic(
      createElement(Notice, {
        tone: "info",
        title: "Update",
        glyph: "M4 4h16",
        action: { label: "View", onClick: noop },
        children: "Version 0.3.0 is available.",
      }),
    );
    expect(html).toMatch(/data-slot="icon" aria-hidden="true"[^>]*><svg/);
    expect(html).toContain('<p data-slot="title" class="font-medium">Update</p>');
    expect(html).toContain('<div data-slot="body">Version 0.3.0 is available.</div>');
    expect(html).toMatch(/data-slot="actions"[\s\S]*>View<\/button>/);
  });

  it("orders the actions dismiss, retry, then the affirmative action", () => {
    const html = renderStatic(
      createElement(Notice, {
        tone: "danger",
        dismiss: { label: "Ignore", onClick: noop },
        retry: { label: "Retry", onClick: noop },
        action: { label: "Fix", onClick: noop },
        children: "Failed",
      }),
    );
    const at = (text: string) => html.indexOf(`>${text}</button>`);
    expect(at("Ignore")).toBeLessThan(at("Retry"));
    expect(at("Retry")).toBeLessThan(at("Fix"));
  });

  it("shows the close cross, named in the interface's words, for a dismiss with no label", () => {
    const html = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, dismiss: "关闭" } },
        createElement(Notice, {
          tone: "neutral",
          dismiss: { onClick: noop },
          children: "Archived",
        }),
      ),
    );
    expect(html).toContain('aria-label="关闭"');
  });
  it("keeps a lone close cross on the body's line, while buttons may take a row of their own", () => {
    const body = /<div class="[^"]*\bflex-1\b[^"]*"><div class="min-w-0">/;
    const cross = renderStatic(
      createElement(Notice, { tone: "attention", dismiss: { onClick: noop }, children: "x" }),
    );
    expect(cross).toMatch(body);
    const buttons = renderStatic(
      createElement(Notice, {
        tone: "attention",
        dismiss: { onClick: noop },
        action: { label: "Fix", onClick: noop },
        children: "x",
      }),
    );
    expect(buttons).not.toMatch(body);
  });

  it("closes with a flat cross in its own ink, never a grey control laid on top", () => {
    const html = renderStatic(
      createElement(Notice, {
        tone: "attention",
        dismiss: { onClick: noop },
        children: "Heads up",
      }),
    );
    const cross = html.slice(html.indexOf('<button type="button" aria-label="Dismiss"'));
    expect(cross).not.toBe("");
    const tokens = classTokens(cross.slice(0, cross.indexOf(">")));
    expect(tokens).not.toContain("hover:bg-surface-muted");
    expect(tokens).not.toContain("text-fg-subtle");
  });

  it("lays a banner out as one centred line: the sentence, its action word, the cross at the far edge", () => {
    const html = renderStatic(
      createElement(Notice, {
        tone: "attention",
        variant: "banner",
        action: { label: "Change it now", onClick: noop },
        dismiss: { ariaLabel: "Close", onClick: noop },
        children: "This account still uses its initial password.",
      }),
    );
    expect(html).toContain("data-banner");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["justify-center", "border-b"]));
    expect(html.indexOf("initial password")).toBeLessThan(html.indexOf(">Change it now<"));
    // The action is a word in the sentence's line, not a boxed button.
    expect(html).toMatch(/<button type="button"[^>]*class="[^"]*underline[^"]*">Change it now</);
    // The cross stands out of the flow at the far edge, named as the caller asked.
    expect(html).toMatch(
      /data-slot="actions" class="absolute[^"]*right-[^"]*"><button[^>]*aria-label="Close"/,
    );
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});

describe("TodoNotice", () => {
  const todo = (withAction: boolean) =>
    renderStatic(
      createElement(TodoNotice, {
        text: "3 skills can be updated",
        dismissLabel: "Mark as read",
        onDismiss: noop,
        ...(withAction ? { actionLabel: "Update all", onAction: noop } : {}),
      }),
    );

  it("is an attention callout whose buttons fold the sentence into their names", () => {
    const html = todo(true);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('aria-label="Mark as read · 3 skills can be updated"');
    expect(html).toContain('aria-label="Update all · 3 skills can be updated"');
    expect(html.indexOf(">Mark as read<")).toBeLessThan(html.indexOf(">Update all<"));
  });

  it("offers the dismiss alone where nothing can be updated", () => {
    const html = todo(false);
    expect(html).toContain(">Mark as read<");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

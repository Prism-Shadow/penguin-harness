/**
 * The toasts (src/components/overlays/toaster/toaster.tsx): the store the `toast*` functions write
 * to and how long each kind stays, and the stack as it is drawn — a polite live region named in
 * the interface's words, each toast a notice-strip button on an opaque backing.
 *
 * The portal itself needs a document, which this suite has not; `ToastStack` is what `Toaster`
 * portals, so the markup is asserted on it.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ToastStack,
  Toaster,
  toastAttention,
  toastError,
  toastInfo,
  toastStore,
  toastSuccess,
} from "../src/components/overlays/toaster/toaster";
import type { ToastItem } from "../src/components/overlays/toaster/toaster";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const items = () => toastStore.getState().items;

describe("the toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastStore.setState({ items: [] });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    toastStore.setState({ items: [] });
  });

  it("stacks toasts oldest first, and ignores an empty one", () => {
    toastSuccess("Saved");
    toastError("Connection failed");
    toastSuccess("");
    expect(items().map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: "success", text: "Saved" },
      { kind: "error", text: "Connection failed" },
    ]);
  });

  it("plays the exit before removing a toast, once its stay is over", () => {
    toastSuccess("Saved");
    vi.advanceTimersByTime(2499);
    expect(items()[0]?.leaving).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(items()[0]?.leaving).toBe(true);
    vi.advanceTimersByTime(160);
    expect(items()).toEqual([]);
  });

  it("keeps what needs reading longer: info 4 s, an advisory and an error 6 s", () => {
    toastInfo("Already up to date");
    toastAttention("Saved, but 2 fields were truncated");
    toastError("Connection failed");
    vi.advanceTimersByTime(4000);
    expect(items().map((t) => [t.kind, t.leaving === true])).toEqual([
      ["info", true],
      ["attention", false],
      ["error", false],
    ]);
    vi.advanceTimersByTime(2000);
    expect(items().map((t) => t.kind)).toEqual(["attention", "error"]);
    expect(items().every((t) => t.leaving)).toBe(true);
  });
});

const STACK: ToastItem[] = [
  { id: 1, kind: "success", text: "Saved" },
  { id: 2, kind: "error", text: "Connection failed" },
  { id: 3, kind: "info", text: "Rebuilding the index" },
  { id: 4, kind: "attention", text: "Saved, but 2 fields were truncated", leaving: true },
];

const stack = (list: readonly ToastItem[]) =>
  renderStatic(createElement(ToastStack, { items: list, onDismiss: () => {} }));

describe("ToastStack", () => {
  const html = stack(STACK);

  it("is a polite live region, named, and mounted while empty", () => {
    expect(html).toMatch(
      /^<section aria-label="Notifications" aria-live="polite" aria-relevant="additions text"/,
    );
    const empty = stack([]);
    expect(empty).toMatch(/^<section aria-label="Notifications"/);
    expect(empty).not.toContain("<button");
  });

  it("draws each toast as a notice-strip button in its kind's tone, words in the body", () => {
    const buttons = [...html.matchAll(/<button [^>]*type="button"[^>]*data-tone="([a-z]+)"/g)];
    expect(buttons.map((m) => m[1])).toEqual(["success", "danger", "info", "warning"]);
    expect(html).toContain('<span data-slot="body">Connection failed</span>');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining([
        "ui-notice",
        "border-line",
        "bg-tone-danger-bg",
        "text-tone-danger-fg",
      ]),
    );
  });

  it("says that pressing a toast dismisses it, through a hint every toast points at", () => {
    const hint = /<span id="([^"]+)" hidden="">Dismiss<\/span>/.exec(html);
    expect(hint).not.toBeNull();
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(described).toEqual(STACK.map(() => hint![1]));
  });

  it("stands each toast on an opaque backing, and plays the exit on a leaving one", () => {
    expect(html.match(/class="max-w-lg rounded-lg bg-overlay anim-toast-in"/g)).toHaveLength(3);
    expect(html.match(/class="max-w-lg rounded-lg bg-overlay anim-toast-out"/g)).toHaveLength(1);
  });

  it("speaks the interface's words once the app provides them", () => {
    const zh = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, notifications: "通知", dismiss: "关闭" } },
        createElement(ToastStack, { items: STACK, onDismiss: () => {} }),
      ),
    );
    expect(zh).toContain('aria-label="通知"');
    expect(zh).toContain('hidden="">关闭</span>');
    expect(zh).not.toContain("Notifications");
    expect(zh).not.toContain("Dismiss");
  });
});

describe("Toaster", () => {
  it("renders nothing without a document to portal into", () => {
    expect(renderStatic(createElement(Toaster))).toBe("");
  });
});

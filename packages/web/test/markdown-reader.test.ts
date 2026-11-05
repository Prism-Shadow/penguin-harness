// @vitest-environment jsdom
/**
 * The Markdown reader (the UI package's `MarkdownReader`, `useMarkdownReader`, `ReaderTools` and
 * `ReaderFindBar`) as the app hosts it: its outline and find buttons in the host's title row
 * beside the file's name, on the user's `find.open` binding (lib/reader-find.ts), in the app's
 * words (lib/ui-strings.ts), in a live DOM.
 *
 * jsdom lays nothing out, so the suite gives the page its geometry, the one boundary it fakes:
 * the reader is a given width, its scroll box 500px tall over 5000px of content (the page around
 * it scrolls too), every block of the document sits 100px below the one before it, and a scroll
 * position stays within its box's range as a browser keeps it. Elements report a parent to be
 * measured from (`offsetParent`), which is how the find tells a displayed block from a hidden
 * one; the browser's highlight registry is a map.
 *
 * - A document with two or more headings has an outline, in document order; with room it stands
 *   beside the text, and narrow it opens from the outline button in the host's title row. A
 *   document with fewer headings has none.
 * - Choosing an outline row scrolls the reader's own box to just above its heading, marks that
 *   row current, and scrolls nothing around the reader.
 * - Scrolling the box marks the section whose heading the reading line has passed.
 * - The find key inside the reader opens the reader's find and is kept from the page and the
 *   browser; pressed outside the reader, it is left alone. The find button in the title row opens
 *   it too.
 * - The open find bar takes the file name's place in the title row, above the text and never
 *   inside its scroll box, so it lies over no line however the text wraps or scrolls; when it
 *   closes, the name comes back.
 * - Typing counts the matches in the rendered text — case-insensitively, Chinese included — and
 *   never in the source: a link's address and Markdown's own marks match nothing.
 * - Enter and ↓ go to the next match, Shift+Enter and ↑ to the previous one, wrapping at both
 *   ends, each bringing the match into the reader's box.
 * - Escape closes the find and clears its paint, and goes no further: a dialog around the reader
 *   does not hear it.
 * - A reader with no host title row draws the same controls in a strip of its own above the text.
 */
import { act, createElement as h } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MarkdownReader,
  ReaderFindBar,
  ReaderTools,
  UiStringsProvider,
  useMarkdownReader,
} from "@prismshadow/penguin-ui";
import { useReaderFind } from "../src/lib/reader-find";
import { en } from "../src/lib/strings-en";
import { uiStringsFor } from "../src/lib/ui-strings";
import { click, field, mount, settle, type, unmountAll } from "./helpers/dom";

const DOC = [
  "# Release process",
  "",
  "Each release starts from **main**. See [the guide](https://example.com/release-guide).",
  "",
  "## Before the release",
  "",
  "Run the checks before the release branch is cut.",
  "",
  "## 发布说明",
  "",
  "发布说明随发布一起提交。",
  "",
  "## Rolling back",
  "",
  "A release is never re-tagged.",
].join("\n");

/** The blocks the geometry places, in document order. */
const BLOCKS = "h1, h2, h3, h4, p, li, pre";
/** The reader's width: wide enough for the rail, or not. */
let readerWidth = 900;

const rect = (top: number, height: number, width: number): DOMRect =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** The reader's scroll box: the region the reader names after its document. */
const scrollBox = (): HTMLElement => document.querySelector<HTMLElement>('[role="region"]')!;

/** Each box's scroll position, kept within its range. */
const scrolled = new WeakMap<Element, number>();
const realRect = Element.prototype.getBoundingClientRect;
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const box = this.closest<HTMLElement>('[role="region"]');
    if (box === null) return rect(0, 500, readerWidth);
    if (this === box) return rect(0, 500, 600);
    const block = this.closest(BLOCKS);
    const index = block === null ? 0 : [...box.querySelectorAll(BLOCKS)].indexOf(block);
    return rect(index * 100 - box.scrollTop, 30, 600);
  };
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
  for (const [name, inBox, inPage] of [
    ["scrollHeight", 5000, 3000],
    ["clientHeight", 500, 400],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.getAttribute("role") === "region") return inBox;
        return this.hasAttribute("data-page") ? inPage : 0;
      },
    });
  }
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrolled.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      const end = Math.max(0, this.scrollHeight - this.clientHeight);
      scrolled.set(this, Math.min(end, Math.max(0, value)));
    },
  });
});

// The package config unstubs globals after every test, so the browser's frame clock and its
// highlight registry are stood in for each one.
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) =>
    window.setTimeout(() => run(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("CSS", {
    escape: (value: string) => value,
    highlights: new Map<string, unknown>(),
  });
  vi.stubGlobal("Highlight", Set);
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
  if (realOffsetParent !== undefined)
    Object.defineProperty(HTMLElement.prototype, "offsetParent", realOffsetParent);
  for (const name of ["scrollHeight", "clientHeight", "scrollTop"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

afterEach(async () => {
  await unmountAll();
  readerWidth = 900;
});

/** The reader as a page hosts it, inside a scrolling page, beside a control outside it. */
/** The file name the host's title row shows while the find is closed. */
const FILE_NAME = "handbook/release.md";

/**
 * The reader as a page hosts it, inside a scrolling page, beside a control outside it: a title
 * row with the file's name (or the open find bar in its place) and the reader's buttons, over the
 * text.
 */
function Page({ text }: { text: string }) {
  const reader = useMarkdownReader(useReaderFind());
  return h(
    UiStringsProvider,
    { strings: uiStringsFor("en") },
    h(
      "div",
      { "data-page": "", style: { overflowY: "auto" } },
      h("button", { type: "button" }, "outside"),
      h(
        "div",
        { "data-title-row": "" },
        reader.findShown ? h(ReaderFindBar, { reader }) : h("span", null, FILE_NAME),
        h(ReaderTools, { reader }),
      ),
      h(MarkdownReader, { reader, text, label: "Release process", className: "h-96" }),
    ),
  );
}

const titleRow = (): Element => document.querySelector("[data-title-row]")!;

async function openReader(text = DOC): Promise<HTMLElement> {
  await mount(h(Page, { text }));
  const box = scrollBox();
  // The find reveals a match by scrolling the nearest box whose overflow scrolls.
  box.style.overflowY = "auto";
  await settle();
  return box;
}

/** The outline's rows, wherever it stands. */
const outlineRows = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>(`nav[aria-label="${en.find.outline}"] button`),
];

/** A keydown as the keyboard delivers it to `target`; the event, to see what was kept from the page. */
async function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
}

/** The find key on this platform (Ctrl+F: jsdom reads as Linux). */
const findKey = (target: Element) => press(target, "f", { code: "KeyF", ctrlKey: true });

const searchBox = () => field(en.find.documentPlaceholder) as HTMLInputElement;
const counter = (): string =>
  document.querySelector('[role="search"] [aria-live="polite"]')?.textContent ?? "";

async function search(query: string): Promise<HTMLInputElement> {
  await findKey(scrollBox());
  const input = searchBox();
  await type(input, query);
  await settle();
  return input;
}

describe("the outline", () => {
  it("lists the headings in document order beside the text when there is room", async () => {
    await openReader();
    expect(outlineRows().map((row) => row.textContent)).toEqual([
      "Release process",
      "Before the release",
      "发布说明",
      "Rolling back",
    ]);
    expect(document.querySelector(`button[aria-label="${en.find.outline}"]`)).toBeNull();
  });

  it("opens from the title row's outline button when the reader is narrow", async () => {
    readerWidth = 400;
    await openReader();
    expect(outlineRows()).toEqual([]);
    await click(document.querySelector(`button[aria-label="${en.find.outline}"]`)!);
    expect(outlineRows()).toHaveLength(4);
  });

  it("is not there for a document with fewer than two headings", async () => {
    await openReader("# Only one\n\nA short note.");
    expect(outlineRows()).toEqual([]);
    expect(document.querySelector(`button[aria-label="${en.find.outline}"]`)).toBeNull();
  });

  it("scrolls the reader's own box to a chosen heading and marks it current", async () => {
    const box = await openReader();
    const page = document.querySelector<HTMLElement>("[data-page]")!;
    await click(outlineRows()[3]!);
    // "Rolling back" is the seventh block, 600px down: it lands just below the box's top.
    expect(box.scrollTop).toBe(592);
    expect(outlineRows()[3]!.getAttribute("aria-current")).toBe("location");
    expect(page.scrollTop).toBe(0);
  });

  it("marks the section whose heading the reader has scrolled past", async () => {
    const box = await openReader();
    expect(outlineRows()[0]!.getAttribute("aria-current")).toBe("location");
    box.scrollTop = 410;
    await act(async () => {
      box.dispatchEvent(new Event("scroll"));
    });
    await settle();
    const current = outlineRows().filter((row) => row.getAttribute("aria-current") !== null);
    expect(current.map((row) => row.textContent)).toEqual(["发布说明"]);
  });
});

describe("the find", () => {
  it("opens on the find key inside the reader, keeping the key from the page", async () => {
    const box = await openReader();
    const event = await findKey(box);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(searchBox());
  });

  it("leaves the find key alone outside the reader", async () => {
    await openReader();
    const outside = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "outside",
    )!;
    const event = await findKey(outside);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="search"]')).toBeNull();
  });

  it("takes the file name's place in the title row, outside the box the text scrolls in", async () => {
    const box = await openReader();
    expect(titleRow().textContent).toContain(FILE_NAME);
    await findKey(box);
    const bar = document.querySelector('[role="search"]')!;
    expect(titleRow().contains(bar)).toBe(true);
    expect(titleRow().textContent).not.toContain(FILE_NAME);
    expect(box.contains(bar)).toBe(false);
    expect(bar.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens from the find button in the title row", async () => {
    await openReader();
    await click(document.querySelector(`button[aria-label="${en.find.inDocument}"]`)!);
    expect(document.activeElement).toBe(searchBox());
  });

  it("counts matches in the rendered text, whatever their case, Chinese included", async () => {
    await openReader();
    const input = await search("RELEASE");
    expect(counter()).toBe("1/5");
    await type(input, "发布");
    await settle();
    expect(counter()).toBe("1/3");
  });

  it("finds nothing that is only in the source", async () => {
    await openReader();
    const input = await search("example.com");
    expect(counter()).toBe(en.find.noResults);
    await type(input, "**main**");
    await settle();
    expect(counter()).toBe(en.find.noResults);
  });

  it("steps with Enter and the arrows, wrapping, and brings each match into the box", async () => {
    const box = await openReader();
    const input = await search("release");
    await press(input, "Enter");
    expect(counter()).toBe("2/5");
    await press(input, "Enter", { shiftKey: true });
    expect(counter()).toBe("1/5");
    // The first matches sit in the top 500px and need no scroll; the fifth, in the last
    // paragraph 700px down, is brought to the middle of the box.
    expect(box.scrollTop).toBe(0);
    await press(input, "ArrowUp");
    expect(counter()).toBe("5/5");
    expect(box.scrollTop).toBe(465);
    await press(input, "ArrowDown");
    expect(counter()).toBe("1/5");
    expect(box.scrollTop).toBe(0);
  });

  it("closes on Escape, clearing its paint, and a dialog around it does not hear the key", async () => {
    await openReader();
    const input = await search("release");
    const registry = (globalThis as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS
      .highlights;
    expect(registry.has("penguin-find-current")).toBe(true);
    const dialogHeard: string[] = [];
    const listener = (e: KeyboardEvent) => dialogHeard.push(e.key);
    window.addEventListener("keydown", listener);
    try {
      await press(input, "Escape");
    } finally {
      window.removeEventListener("keydown", listener);
    }
    expect(document.querySelector('[role="search"]')).toBeNull();
    expect(titleRow().textContent).toContain(FILE_NAME);
    expect(registry.has("penguin-find")).toBe(false);
    expect(registry.has("penguin-find-current")).toBe(false);
    expect(dialogHeard).toEqual([]);
  });
});

describe("a reader with no host title row", () => {
  it("draws its outline and find buttons in a strip of its own, above the text", async () => {
    readerWidth = 400;
    await mount(
      h(
        UiStringsProvider,
        { strings: uiStringsFor("en") },
        h(MarkdownReader, { text: DOC, label: "Release process", className: "h-96" }),
      ),
    );
    await settle();
    expect(document.querySelector(`button[aria-label="${en.find.outline}"]`)).not.toBeNull();
    await click(document.querySelector(`button[aria-label="${en.find.inDocument}"]`)!);
    const bar = document.querySelector('[role="search"]')!;
    expect(scrollBox().contains(bar)).toBe(false);
    expect(document.activeElement).toBe(searchBox());
  });
});

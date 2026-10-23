/**
 * The app's one clipboard write (lib/clipboard.ts `writeClipboard`), which has to work on the
 * origins the app is served from: `navigator.clipboard` exists only in a secure context, so it
 * is absent on every plain-HTTP origin but localhost. The entry hands the write to the real
 * `copy-to-clipboard` here, with only `window`, `navigator` and `document` replaced, so an
 * upgrade that changes one of the properties the app chose it for fails here.
 *
 * - On a non-secure origin the copy command runs without suspending, copies exactly the text
 *   from an element kept out of layout, removes that element whatever the copy did, and hands
 *   the page's selection and focus back.
 * - The copy command writes the text as `text/plain` alone and cancels the browser's own copy of
 *   that element, which would add HTML carrying the page's inherited ink.
 * - A copy command that reports failure or throws resolves false, never a rejection, and never
 *   falls back to a prompt.
 * - In a secure context the Clipboard API writes one item holding `text/plain` alone and no copy
 *   command runs; when it refuses the write, or the browser has no ClipboardItem (Firefox before
 *   127), the copy command takes over, still plain text alone.
 * - Guard: no other module writes to `navigator.clipboard` or imports `copy-to-clipboard`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

type WriteClipboard = (text: string) => Promise<boolean>;

/** A fresh import of the entry and its library, reading the globals the test just stubbed. */
async function loadEntry(): Promise<WriteClipboard> {
  vi.resetModules();
  return (await import("../src/lib/clipboard")).writeClipboard;
}

afterEach(() => {
  vi.resetModules();
});

/** The copy event the element's own listener receives when the copy command runs on it. */
interface FakeCopyEvent {
  clipboardData: { setData(type: string, data: string): void };
  preventDefault(): void;
  stopPropagation(): void;
}

interface FakeElement {
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  parentElement: null;
  copyListeners: ((event: FakeCopyEvent) => void)[];
  addEventListener(type: string, listener: (event: FakeCopyEvent) => void): void;
}

/** What one copy command put on the clipboard through the copied element's event. */
interface CopyEventRecord {
  writes: [string, string][];
  cancelled: boolean;
}

interface FakeRange {
  node: FakeElement | null;
  selectNodeContents(node: FakeElement): void;
}

interface FakeDom {
  /** The document's copy command calls, each with what the selection held at that moment. */
  execCalls: { command: string; selected: (FakeElement | null)[] }[];
  /** The copy events those commands raised on the selected elements, and what they wrote. */
  copyEvents: CopyEventRecord[];
  appended: FakeElement[];
  /** Elements still attached to the body. */
  attached: FakeElement[];
  /** The page's own selection, before any copy. */
  pageRange: FakeRange;
  ranges: FakeRange[];
  /** Focus history of the input that had focus before the copy. */
  focusLog: string[];
}

/** A minimal ClipboardItem: the flavours it was built with, by type. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

/** The Clipboard API as the library reaches it; `write` is what it calls once it has an item. */
interface FakeClipboard {
  write?: (items: FakeClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

/**
 * Installs the globals the library touches. The page starts with one selected range and a
 * focused textarea (xterm's input), so the library's hand-back is observable. `ClipboardItem`
 * exists only when asked for, as in a browser that has it.
 */
function stubDom(opts: {
  secure: boolean;
  clipboard?: FakeClipboard;
  clipboardItem?: boolean;
  exec?: () => boolean;
}): FakeDom {
  const range = (): FakeRange => ({
    node: null,
    selectNodeContents(node) {
      this.node = node;
    },
  });
  const pageRange = range();
  const dom: FakeDom = {
    execCalls: [],
    copyEvents: [],
    appended: [],
    attached: [],
    pageRange,
    ranges: [pageRange],
    focusLog: [],
  };
  const focused = {
    tagName: "TEXTAREA",
    parentElement: null,
    blur: () => dom.focusLog.push("blur"),
    focus: () => dom.focusLog.push("focus"),
  };
  const selection = {
    type: "Range",
    get rangeCount() {
      return dom.ranges.length;
    },
    getRangeAt: (i: number) => dom.ranges[i],
    addRange: (r: FakeRange) => dom.ranges.push(r),
    removeRange: (r: FakeRange) => {
      dom.ranges = dom.ranges.filter((x) => x !== r);
    },
    removeAllRanges: () => {
      dom.ranges = [];
    },
  };
  vi.stubGlobal("window", { isSecureContext: opts.secure, prompt: vi.fn() });
  vi.stubGlobal("navigator", opts.clipboard ? { clipboard: opts.clipboard } : {});
  if (opts.clipboardItem) vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("document", {
    activeElement: focused,
    fullscreenElement: null,
    body: {
      appendChild(el: FakeElement) {
        dom.appended.push(el);
        dom.attached.push(el);
        return el;
      },
      removeChild(el: FakeElement) {
        dom.attached = dom.attached.filter((x) => x !== el);
        return el;
      },
    },
    createElement: (tagName: string): FakeElement => ({
      tagName: tagName.toUpperCase(),
      textContent: "",
      style: {},
      parentElement: null,
      copyListeners: [],
      addEventListener(type, listener) {
        if (type === "copy") this.copyListeners.push(listener);
      },
    }),
    createRange: range,
    getSelection: () => selection,
    execCommand(command: string) {
      const selected = dom.ranges.map((r) => r.node);
      dom.execCalls.push({ command, selected });
      // The command raises a copy event on the selected element before it copies anything.
      for (const node of selected) {
        if (node === null) continue;
        const record: CopyEventRecord = { writes: [], cancelled: false };
        const event: FakeCopyEvent = {
          clipboardData: { setData: (type, data) => record.writes.push([type, data]) },
          preventDefault: () => {
            record.cancelled = true;
          },
          stopPropagation: () => {},
        };
        for (const listener of node.copyListeners) listener(event);
        dom.copyEvents.push(record);
      }
      return (opts.exec ?? (() => true))();
    },
  });
  return dom;
}

describe("writeClipboard: the library's behaviour contract", () => {
  it("reaches the copy command without suspending on a non-secure origin", async () => {
    const dom = stubDom({ secure: false });
    const writeClipboard = await loadEntry();

    // Deliberately not awaited: the copy command has to have run by the time the call
    // returns, inside the click's own task, not on some later turn of the microtask queue.
    const result = writeClipboard("reply text");
    expect(dom.execCalls.map((c) => c.command)).toEqual(["copy"]);
    await expect(result).resolves.toBe(true);
  });

  it("copies exactly the text, from an element kept out of layout", async () => {
    const dom = stubDom({ secure: false });
    const writeClipboard = await loadEntry();

    await writeClipboard("line one\nline two");
    const mark = dom.appended[0];
    expect(mark?.textContent).toBe("line one\nline two");
    expect(dom.execCalls[0]?.selected).toEqual([mark]);
    expect(mark?.style.position).toBe("fixed");
    expect(mark?.style.clip).toBe("rect(0, 0, 0, 0)");
  });

  it("writes the text as text/plain alone through the copy command, cancelling the browser's own copy", async () => {
    const dom = stubDom({ secure: false });
    const writeClipboard = await loadEntry();

    await writeClipboard("line one\nline two");
    expect(dom.copyEvents).toEqual([
      { writes: [["text/plain", "line one\nline two"]], cancelled: true },
    ]);
  });

  it("resolves false, not a rejection, when the copy command reports failure", async () => {
    const dom = stubDom({ secure: false, exec: () => false });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("x")).resolves.toBe(false);
    expect(dom.execCalls).toHaveLength(1);
  });

  it("resolves false, not a rejection, when the copy command throws — and never prompts", async () => {
    stubDom({
      secure: false,
      exec: () => {
        throw new Error("blocked");
      },
    });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("x")).resolves.toBe(false);
    expect(
      (window as unknown as { prompt: ReturnType<typeof vi.fn> }).prompt,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["succeeds", () => true],
    ["fails", () => false],
    [
      "throws",
      () => {
        throw new Error("blocked");
      },
    ],
  ])("removes the borrowed element when the copy %s", async (_label, exec) => {
    const dom = stubDom({ secure: false, exec });
    const writeClipboard = await loadEntry();

    await writeClipboard("x");
    expect(dom.appended).toHaveLength(1);
    expect(dom.attached).toEqual([]);
  });

  it.each([
    ["succeeds", () => true],
    [
      "throws",
      () => {
        throw new Error("blocked");
      },
    ],
  ])(
    "hands the page's selection and the focused input back when the copy %s",
    async (_label, exec) => {
      const dom = stubDom({ secure: false, exec });
      const writeClipboard = await loadEntry();

      await writeClipboard("x");
      expect(dom.ranges).toEqual([dom.pageRange]);
      expect(dom.focusLog).toEqual(["blur", "focus"]);
    },
  );

  it("uses the Clipboard API in a secure context — one item, plain text alone — and runs no copy command", async () => {
    const written: FakeClipboardItem[][] = [];
    const dom = stubDom({
      secure: true,
      clipboardItem: true,
      clipboard: { write: async (items) => void written.push(items) },
    });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("hello")).resolves.toBe(true);
    expect(written).toHaveLength(1);
    const [item] = written[0]!;
    expect(Object.keys(item!.items)).toEqual(["text/plain"]);
    expect(await item!.items["text/plain"]!.text()).toBe("hello");
    expect(dom.execCalls).toEqual([]);
    expect(dom.appended).toEqual([]);
  });

  it("falls back to the copy command when the Clipboard API refuses the write", async () => {
    const dom = stubDom({
      secure: true,
      clipboardItem: true,
      clipboard: {
        write: async () => {
          throw new Error("NotAllowedError");
        },
      },
    });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("x")).resolves.toBe(true);
    expect(dom.execCalls.map((c) => c.command)).toEqual(["copy"]);
    expect(dom.copyEvents).toEqual([{ writes: [["text/plain", "x"]], cancelled: true }]);
  });

  it("takes the copy command where the browser has no ClipboardItem, still plain text alone", async () => {
    const write = vi.fn(async (_items: FakeClipboardItem[]) => {});
    const dom = stubDom({ secure: true, clipboard: { write } });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("x")).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(dom.copyEvents).toEqual([{ writes: [["text/plain", "x"]], cancelled: true }]);
  });
});

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const ENTRY = join(SRC, "lib", "clipboard.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Clipboard writes (`writeText` / `write`, optional chaining included); `readText` is not one. */
const CLIPBOARD_WRITE = /navigator\s*\.\s*clipboard[\s\S]{0,40}?\.\s*write(?:Text)?\s*\(/;
const LIBRARY_IMPORT = /from\s+["']copy-to-clipboard["']|import\(\s*["']copy-to-clipboard["']\s*\)/;

function offenders(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => file !== ENTRY)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file));
}

describe("clipboard writes go through one entry", () => {
  it("has no other module writing to navigator.clipboard", () => {
    expect(offenders(CLIPBOARD_WRITE)).toEqual([]);
  });

  it("has no other module importing copy-to-clipboard", () => {
    // Not vacuous: the entry itself is the one import the pattern must see.
    expect(LIBRARY_IMPORT.test(readFileSync(ENTRY, "utf8"))).toBe(true);
    expect(offenders(LIBRARY_IMPORT)).toEqual([]);
  });
});

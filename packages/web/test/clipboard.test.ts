/**
 * writeClipboard unit tests: the copy path that has to work on the origins this app is
 * actually served from.
 *
 * `navigator.clipboard` is secure-context-only, so it is absent on every plain-HTTP origin
 * that is not localhost — a LAN bind, a remote install opened at `http://<host>:7364`. The
 * entry hands the write to `copy-to-clipboard`, and the three groups below pin three
 * different things:
 *
 *   - the entry's contract, against a module double: the text goes to the library as is,
 *     its boolean comes back as is, and its `window.prompt` last resort stays off;
 *   - the library's behaviour, against the REAL library with only `window`, `navigator`
 *     and `document` replaced: these are the properties this app chose it for, so an
 *     upgrade that changes one of them fails here rather than in a browser;
 *   - the seam itself, against the source text: a copy affordance that reaches for
 *     `navigator.clipboard.writeText` on its own would reintroduce exactly the silent no-op
 *     this module exists to prevent, and nothing in a node-only suite would notice
 *     (context-menu.test.ts convention).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WriteClipboard = (text: string) => Promise<boolean>;

/** A fresh import of the entry, so a module double (or its removal) takes effect. */
async function loadEntry(): Promise<WriteClipboard> {
  vi.resetModules();
  return (await import("../src/lib/clipboard")).writeClipboard;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("copy-to-clipboard");
  vi.resetModules();
});

describe("writeClipboard: the entry's contract", () => {
  const copy =
    vi.fn<(text: string, options?: { fallbackToPrompt?: boolean }) => Promise<boolean>>();

  beforeEach(() => {
    copy.mockReset();
    vi.doMock("copy-to-clipboard", () => ({ default: copy }));
  });

  it("hands the text to the library unchanged and returns its true", async () => {
    copy.mockResolvedValue(true);
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("  reply\ttext\n")).resolves.toBe(true);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0]?.[0]).toBe("  reply\ttext\n");
  });

  it("returns the library's false as is", async () => {
    copy.mockResolvedValue(false);
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("x")).resolves.toBe(false);
  });

  it("leaves the library's prompt fallback off", async () => {
    copy.mockResolvedValue(false);
    const writeClipboard = await loadEntry();

    await writeClipboard("x");
    expect(copy.mock.calls[0]?.[1]?.fallbackToPrompt).toBeFalsy();
  });
});

interface FakeElement {
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  parentElement: null;
  addEventListener(): void;
}

interface FakeRange {
  node: FakeElement | null;
  selectNodeContents(node: FakeElement): void;
}

interface FakeDom {
  /** The document's copy command calls, each with what the selection held at that moment. */
  execCalls: { command: string; selected: (FakeElement | null)[] }[];
  appended: FakeElement[];
  /** Elements still attached to the body. */
  attached: FakeElement[];
  /** The page's own selection, before any copy. */
  pageRange: FakeRange;
  ranges: FakeRange[];
  /** Focus history of the input that had focus before the copy. */
  focusLog: string[];
}

/**
 * Installs the three globals the library touches. The page starts with one selected range
 * and a focused textarea (xterm's input), so the library's hand-back is observable.
 */
function stubDom(opts: {
  secure: boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
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
      addEventListener() {},
    }),
    createRange: range,
    getSelection: () => selection,
    execCommand(command: string) {
      dom.execCalls.push({ command, selected: dom.ranges.map((r) => r.node) });
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

  it("uses the Clipboard API in a secure context, and runs no copy command", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const dom = stubDom({ secure: true, clipboard: { writeText } });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(dom.execCalls).toEqual([]);
    expect(dom.appended).toEqual([]);
  });

  it("falls back to the copy command when the Clipboard API refuses the write", async () => {
    const dom = stubDom({
      secure: true,
      clipboard: {
        writeText: async () => {
          throw new Error("NotAllowedError");
        },
      },
    });
    const writeClipboard = await loadEntry();

    await expect(writeClipboard("x")).resolves.toBe(true);
    expect(dom.execCalls.map((c) => c.command)).toEqual(["copy"]);
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

  it("leaves reads alone: the terminal's mouse paste still reads the Clipboard API", () => {
    const reads = sourceFiles(SRC).filter((file) =>
      /navigator\s*\.\s*clipboard[\s\S]{0,40}?\.\s*readText\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(reads.map((file) => relative(SRC, file))).toContain(
      join("features", "terminal", "terminal-view.tsx"),
    );
  });
});

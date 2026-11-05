/**
 * What the public sites read out of their Markdown and their URL, and the preferences they share.
 *
 * - A post's or a page's frontmatter: values keep their colons and lose their quotes, CRLF files
 *   read like LF ones, and a file with no block is all body.
 * - Headings and their table of contents: a heading's id keeps CJK, lowercases Latin and drops
 *   punctuation; the contents list ## and ### headings, skipping fenced code and deeper levels.
 * - The hash a browser reports for a link to a CJK heading resolves to that heading's id; a
 *   malformed escape falls back to the raw fragment instead of throwing.
 * - The reading line: at the top the first entry is the one being read, a heading scrolled past
 *   the line takes over, at the very bottom the last entry does even if it never reached the
 *   line, and a page too short to scroll stays on the first.
 * - A fenced block hands the renderer its language and text; a group of tabs its labels, and an
 *   unreadable label list none.
 * - The search shortcut is written ⌘ K on Apple platforms and Ctrl K elsewhere.
 * - A stored preference: the shared key wins over a retired per-site key, a retired key still
 *   counts when it is the only one, a value outside the allowed set is ignored, and storage that
 *   throws reads as nothing and a write to it is dropped without an error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTocEntry,
  extractToc,
  hashTargetId,
  parseFrontmatter,
  parseTabLabels,
  readFencedCode,
  slugifyHeading,
} from "../src/components/site/markdown-text";
import type { HastElement } from "../src/components/site/markdown-text";
import {
  readSitePref,
  SITE_LANG_KEY,
  SITE_THEME_KEY,
  writeSitePref,
} from "../src/components/site/site-prefs";
import { searchShortcutLabel } from "../src/components/site/site-search";

describe("frontmatter", () => {
  it("keeps colons in values, drops quotes and trims the body", () => {
    const { meta, body } = parseFrontmatter(
      `---\ntitle: "Hello: world"\ndate: 2026-07-17\nquote: 'single'\n---\n\n# Body\n`,
    );
    expect(meta).toEqual({ title: "Hello: world", date: "2026-07-17", quote: "single" });
    expect(body).toBe("# Body");
  });

  it("reads a CRLF file like an LF one", () => {
    const { meta, body } = parseFrontmatter("---\r\ntitle: X\r\n---\r\nbody\r\n");
    expect(meta.title).toBe("X");
    expect(body).toBe("body");
  });

  it("takes a file without a block as all body", () => {
    expect(parseFrontmatter("# Just markdown\n")).toEqual({ meta: {}, body: "# Just markdown" });
  });
});

describe("headings and contents", () => {
  it("slugs Latin lowercased and hyphenated, CJK kept, punctuation dropped", () => {
    expect(slugifyHeading("Tool Calls (streaming)")).toBe("tool-calls-streaming");
    expect(slugifyHeading("为什么是 PenguinHarness")).toBe("为什么是-penguinharness");
  });

  it("lists ## and ### headings outside fenced code, with the rendered ids", () => {
    const body = [
      "## 第一节",
      "```bash",
      "## not a heading",
      "```",
      "### Payload kinds",
      "#### too deep",
      "## Second",
    ].join("\n");
    expect(extractToc(body)).toEqual([
      { id: "第一节", text: "第一节", depth: 2 },
      { id: "payload-kinds", text: "Payload kinds", depth: 3 },
      { id: "second", text: "Second", depth: 2 },
    ]);
  });
});

describe("the hash a link reports", () => {
  /** The hash a browser reports after following a link to `#<fragment>` (WHATWG URL parsing). */
  const locationHash = (fragment: string) =>
    new URL(`#${fragment}`, "https://example.test/docs/quickstart-cli").hash;

  it("resolves a CJK heading's percent-encoded anchor to the heading's id", () => {
    for (const heading of ["安装参考", "第一步：配置模型（可选）", "0.2.4 的变化"]) {
      const id = slugifyHeading(heading);
      expect(hashTargetId(locationHash(id)), heading).toBe(id);
    }
    expect(hashTargetId("quickstart")).toBe("quickstart");
  });

  it("falls back to the raw fragment when an escape is malformed", () => {
    expect(hashTargetId("#100%")).toBe("100%");
    expect(hashTargetId("#%E5%AE")).toBe("%E5%AE");
    expect(hashTargetId("#")).toBe("");
  });
});

describe("the entry being read", () => {
  const ids = ["intro", "install", "tail"];
  const view = (scrollY: number, maxScroll = 2000) => ({ scrollY, maxScroll, height: 800 });

  it("is the first at the top, before any heading reaches the line", () => {
    expect(activeTocEntry(ids, [300, 900, 1500], view(0))).toBe("intro");
  });

  it("moves to a heading once it is scrolled past the reading line", () => {
    expect(activeTocEntry(ids, [-400, 80, 700], view(600))).toBe("install");
  });

  it("is the last at the very bottom, though its heading never reached the line", () => {
    expect(activeTocEntry(ids, [-1600, -900, 900], view(2000))).toBe("tail");
  });

  it("stays on the first on a page too short to scroll", () => {
    expect(activeTocEntry(ids, [120, 300, 500], view(0, 0))).toBe("intro");
  });
});

describe("what the renderer reads off a node", () => {
  const fence = (className: string[] | undefined, text: string): HastElement => ({
    type: "element",
    tagName: "pre",
    children: [
      {
        type: "element",
        tagName: "code",
        properties: className ? { className } : {},
        children: [{ type: "text", value: text }],
      },
    ],
  });

  it("hands over a fence's language and its text without the closing newline", () => {
    expect(readFencedCode(fence(["language-bash"], "penguin web\n"))).toEqual({
      code: "penguin web",
      language: "bash",
    });
    expect(readFencedCode(fence(undefined, "plain"))).toEqual({ code: "plain", language: "" });
  });

  it("reads a tab group's labels, and none from a value it cannot parse", () => {
    expect(parseTabLabels('["Linux / macOS","Windows"]')).toEqual(["Linux / macOS", "Windows"]);
    expect(parseTabLabels("not json")).toEqual([]);
    expect(parseTabLabels(undefined)).toEqual([]);
  });
});

describe("the search shortcut", () => {
  it("is ⌘ K on Apple platforms and Ctrl K elsewhere", () => {
    expect(searchShortcutLabel("MacIntel")).toBe("⌘ K");
    expect(searchShortcutLabel("iPad")).toBe("⌘ K");
    expect(searchShortcutLabel("Win32")).toBe("Ctrl K");
    expect(searchShortcutLabel(undefined)).toBe("Ctrl K");
  });
});

describe("stored preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function storage(entries: Record<string, string>) {
    const map = new Map(Object.entries(entries));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    });
    return map;
  }

  it("prefers the shared key over a retired one, and reads a retired one alone", () => {
    storage({ [SITE_THEME_KEY]: "dark", "penguin-landing.theme": "light" });
    expect(readSitePref(SITE_THEME_KEY, ["light", "dark", "system"])).toBe("dark");
    storage({ "penguin-docs.lang": "en" });
    expect(readSitePref(SITE_LANG_KEY, ["zh", "en", "system"])).toBe("en");
  });

  it("ignores a stored value outside the allowed set", () => {
    storage({ [SITE_THEME_KEY]: "sepia" });
    expect(readSitePref(SITE_THEME_KEY, ["light", "dark", "system"])).toBeNull();
  });

  it("reads nothing from storage that throws, and drops a write to it quietly", () => {
    const refuse = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse });
    expect(readSitePref(SITE_THEME_KEY, ["light", "dark", "system"])).toBeNull();
    expect(() => writeSitePref(SITE_THEME_KEY, "dark")).not.toThrow();
  });
});

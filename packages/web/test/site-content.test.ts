/** @vitest-environment jsdom */
/**
 * The public sites' shared interactions, driven the way a reader does.
 *
 * - Search: an empty query lists nothing; typing lists the host's results with the query marked;
 *   ArrowDown moves the active result and Enter opens it — the host is handed that result, the
 *   dialog closes and focus returns to the trigger; Escape closes without opening anything; a
 *   query with no hits says so instead of an empty list.
 * - Code tabs: a click shows that tab's panel only; ArrowRight moves the selection and the focus
 *   together and wraps from the last tab to the first.
 * - Copy: where the Clipboard API is missing, the text still reaches the clipboard through the
 *   fallback and the copy is announced while the button keeps naming the action; where every
 *   route refuses, nothing claims a copy.
 * - Preferences: choosing dark stores the choice under the sites' shared key and darkens the
 *   document; a language chosen on a sibling site in another tab switches this page's
 *   dictionary and the document language.
 */
import { createElement as h, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SITE_LANG_KEY,
  SITE_THEME_KEY,
  SiteCodeTabs,
  SiteCopyButton,
  SiteLocaleProvider,
  SiteLocaleScope,
  SiteSearchDialog,
  SiteThemeProvider,
  useSiteLocale,
  useSiteTheme,
} from "@prismshadow/penguin-ui/site";
import type { SiteLocale, SiteSearchResult } from "@prismshadow/penguin-ui/site";
import { click, mount, run, settle, type, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = "";
});

async function press(target: Element, key: string): Promise<void> {
  await run(() => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

describe("search", () => {
  const RESULTS: SiteSearchResult[] = [
    { key: "a", title: "Install the CLI", context: "CLI and Web App" },
    { key: "b", title: "Install the SDK", context: "SDK" },
  ];
  const search = (query: string) =>
    query.trim() ? RESULTS.filter((r) => r.title.toLowerCase().includes(query.toLowerCase())) : [];
  const highlight = (text: string, query: string) => {
    const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
    return at < 0 || !query.trim() ? [] : [{ start: at, end: at + query.trim().length }];
  };
  const opened: SiteSearchResult[] = [];

  function Host() {
    const [open, setOpen] = useState(false);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    return h(
      "div",
      null,
      h(
        "button",
        {
          type: "button",
          onClick: (event: { currentTarget: HTMLElement }) => {
            returnFocusRef.current = event.currentTarget;
            setOpen(true);
          },
        },
        "Open search",
      ),
      h(SiteSearchDialog, {
        open,
        onClose: () => setOpen(false),
        returnFocusRef,
        search,
        highlight,
        onSelect: (result: SiteSearchResult) => opened.push(result),
        labels: {
          label: "Search docs",
          placeholder: "Search",
          start: "Type to search",
          noResults: "No matching pages",
          noResultsHint: "Try another word",
          results: "Results",
          close: "Close search",
          keyboardHint: "Arrows and Enter",
        },
      }),
    );
  }

  const trigger = () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Open search")!;
  const input = () => document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

  async function openDialog() {
    opened.length = 0;
    await mount(h(Host));
    await click(trigger());
  }

  it("lists nothing for an empty query, then the host's results with the query marked", async () => {
    await openDialog();
    expect(options()).toHaveLength(0);
    await type(input(), "install");
    expect(options().map((o) => o.textContent)).toEqual([
      "Install the CLICLI and Web App",
      "Install the SDKSDK",
    ]);
    expect(options()[0]!.querySelector("mark")?.textContent).toBe("Install");
  });

  it("opens the result the arrow keys chose, closes and returns focus to the trigger", async () => {
    await openDialog();
    await type(input(), "install");
    await press(input(), "ArrowDown");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    await press(input(), "Enter");
    expect(opened.map((r) => r.key)).toEqual(["b"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape without opening anything", async () => {
    await openDialog();
    await type(input(), "install");
    await press(input(), "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(opened).toEqual([]);
  });

  it("says so when a query has no hits", async () => {
    await openDialog();
    await type(input(), "zebra");
    expect(options()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("No matching pages");
  });
});

describe("code tabs", () => {
  const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  const panel = () => document.querySelector('[role="tabpanel"]')!.textContent;

  async function mountTabs() {
    await mount(
      h(SiteCodeTabs, {
        labels: ["Linux", "macOS", "Windows"],
        children: [
          h("pre", { key: "l" }, "apt"),
          h("pre", { key: "m" }, "brew"),
          h("pre", { key: "w" }, "winget"),
        ],
      }),
    );
  }

  it("shows the clicked tab's panel only", async () => {
    await mountTabs();
    await click(tabs()[2]!);
    expect(panel()).toBe("winget");
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
  });

  it("moves selection and focus with ArrowRight, wrapping from the last tab", async () => {
    await mountTabs();
    await click(tabs()[2]!);
    await press(tabs()[2]!, "ArrowRight");
    expect(panel()).toBe("apt");
    expect(document.activeElement).toBe(tabs()[0]);
  });
});

describe("copy", () => {
  const copyButton = () => document.querySelector<HTMLButtonElement>("button")!;
  const announced = () => document.querySelector('[aria-live="polite"]')!.textContent;

  /** jsdom has no Clipboard API, so a copy takes the fallback; this answers its execCommand. */
  function execCommandAnswers(answer: boolean): string[] {
    const copied: string[] = [];
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        if (answer) copied.push(document.querySelector("textarea")?.value ?? "");
        return answer;
      },
    });
    return copied;
  }

  afterEach(() => {
    delete (document as { execCommand?: unknown }).execCommand;
  });

  it("copies through the fallback where the Clipboard API is missing, and announces it", async () => {
    const copied = execCommandAnswers(true);
    await mount(h(SiteCopyButton, { text: "penguin web", label: "Copy", announcement: "Copied" }));
    await click(copyButton());
    await settle();
    expect(copied).toEqual(["penguin web"]);
    expect(announced()).toBe("Copied");
    expect(copyButton().textContent).toBe("Copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("never claims a copy when every route refuses", async () => {
    execCommandAnswers(false);
    await mount(h(SiteCopyButton, { text: "penguin web", label: "Copy", announcement: "Copied" }));
    await click(copyButton());
    await settle();
    expect(announced()).toBe("");
  });
});

describe("preferences", () => {
  function ThemeProbe() {
    const { mode, setMode } = useSiteTheme();
    return h("button", { type: "button", onClick: () => setMode("dark") }, mode);
  }

  it("stores a dark choice under the shared key and darkens the document", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await mount(h(SiteThemeProvider, { children: h(ThemeProbe) }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await click(document.querySelector("button")!);
    expect(localStorage.getItem(SITE_THEME_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("follows a language chosen on a sibling site in another tab", async () => {
    // The scope restores the scroll offset across the remount; jsdom does not scroll.
    vi.stubGlobal("scrollTo", () => undefined);
    localStorage.setItem(SITE_LANG_KEY, "zh");
    const applied: SiteLocale[] = [];
    function LocaleProbe() {
      return h("p", null, useSiteLocale().locale);
    }
    await mount(
      h(SiteLocaleProvider, {
        onLocale: (locale: SiteLocale) => applied.push(locale),
        children: h(SiteLocaleScope, { children: h(LocaleProbe) }),
      }),
    );
    expect(document.querySelector("p")!.textContent).toBe("zh");
    await run(() =>
      window.dispatchEvent(new StorageEvent("storage", { key: SITE_LANG_KEY, newValue: "en" })),
    );
    expect(document.querySelector("p")!.textContent).toBe("en");
    expect(applied.at(-1)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

// @vitest-environment jsdom
/**
 * The import dialog (features/builtin-browser/import-dialog.tsx) over a faked API, in both
 * languages.
 *
 * - Given an import that skipped cookies, the outcome gives every reason its own line with its
 *   count, in the reader's language and no other; app-bound skips add how to get those cookies.
 * - Given the user's Chrome extension connected, it is offered as a cookies-only source, and the
 *   outcome's way back to it imports through it: its id, cookies only.
 * - Given Windows, a Chrome profile chosen and no extension connected, a one-line note says how
 *   to get the cookies Chrome keeps to itself; on another system there is none.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserImportSourcesResponse,
} from "@prismshadow/penguin-server/api";
// The browser reaches the app's own helpers through the plugin face; this hands them over.
import "../src/web-app/plugin-host";
import { ImportDialog } from "../src/features/builtin-browser/import-dialog";
import { setActiveStrings, zh } from "../src/lib/strings";
import { S as B } from "../src/features/builtin-browser/strings";
import { en } from "../src/lib/strings-en";
import { click, mount, unmountAll, waitFor } from "./helpers/dom";

const api = vi.hoisted(() => ({
  getBuiltinBrowserImportSources: vi.fn(),
  importIntoBuiltinBrowser: vi.fn(),
}));
vi.mock("../src/features/builtin-browser/api", () => api);

const HAN = /\p{Script=Han}/u;

const diskChrome: BuiltinBrowserImportSource = {
  id: "chrome:Default",
  browser: "chrome",
  browserName: "Chrome",
  profile: "Default",
  profileName: "Person 1",
  hasCookies: true,
  hasHistory: true,
};
const extension: BuiltinBrowserImportSource = {
  id: "chrome-extension",
  browser: "chrome",
  browserName: "Chrome",
  profile: "Chrome 130 on Windows",
  profileName: "Chrome 130 on Windows",
  hasCookies: true,
  hasHistory: false,
  via: "extension",
};

/** The reporter's import: 2481 cookies found, none readable by anyone but Chrome or kept. */
const reported: BuiltinBrowserImportResult = {
  sourceId: "chrome:Default",
  browserName: "Chrome",
  cookies: {
    found: 2481,
    imported: 0,
    skipped: 2481,
    failed: 0,
    skips: [
      { reason: "app_bound", count: 2315 },
      { reason: "partitioned", count: 120 },
      { reason: "expired", count: 46 },
    ],
  },
  history: { found: 5000, imported: 5000 },
  notes: [{ code: "store_busy", store: "history" }],
};

const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const originalAgent = navigator.userAgent;
function setAgent(agent: string): void {
  Object.defineProperty(window.navigator, "userAgent", { value: agent, configurable: true });
}

async function openWith(res: BuiltinBrowserImportSourcesResponse): Promise<void> {
  api.getBuiltinBrowserImportSources.mockResolvedValue(res);
  await mount(h(ImportDialog, { open: true, onClose: () => {} }));
  await waitFor(() => button(B.builtinBrowser.importRun) !== undefined);
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent === text);
}

/** The control inside the label that reads `text`. */
function control(text: string): HTMLInputElement {
  const label = [...document.body.querySelectorAll("label")].find((l) =>
    l.textContent?.includes(text),
  );
  const input = label?.querySelector("input");
  if (input == null) throw new Error(`no control labelled ${text}`);
  return input;
}

beforeEach(() => {
  api.getBuiltinBrowserImportSources.mockReset();
  api.importIntoBuiltinBrowser.mockReset();
});

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("the browser import dialog (%s)", (locale, dict) => {
  afterEach(async () => {
    await unmountAll();
    setActiveStrings(zh);
    setAgent(originalAgent);
  });

  it("gives every skip reason its count in the reader's language, and imports the app-bound ones through the extension", async () => {
    setActiveStrings(dict);
    api.importIntoBuiltinBrowser.mockResolvedValue(reported);
    await openWith({ sources: [diskChrome, extension] });
    await click(button(B.builtinBrowser.importRun)!);
    await waitFor(() => document.body.querySelector("li") !== null);

    const lines = [...document.body.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(lines).toHaveLength(4);
    for (const [index, count] of ["2315", "120", "46"].entries()) {
      expect(lines[index]).toContain(count);
    }
    // Nothing the import reported reads in the other language.
    const dialog = document.body.textContent ?? "";
    for (const line of lines) expect(HAN.test(line)).toBe(locale === "zh");
    if (locale === "en") expect(HAN.test(dialog)).toBe(false);
    expect(dialog).toContain(B.builtinBrowser.importAppBoundAdvice("connected"));

    await click(button(B.builtinBrowser.importUseExtension)!);
    expect(control(extension.profileName).checked).toBe(true);
    expect(control(B.builtinBrowser.importHistory).disabled).toBe(true);
    api.importIntoBuiltinBrowser.mockResolvedValue({
      sourceId: "chrome-extension",
      browserName: "Chrome",
      cookies: { found: 2481, imported: 2315, skipped: 166, failed: 0, skips: [] },
      notes: [],
    } satisfies BuiltinBrowserImportResult);
    await click(button(B.builtinBrowser.importRun)!);
    expect(api.importIntoBuiltinBrowser).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: "chrome-extension", cookies: true, history: false }),
    );
  });

  it("on Windows without a connected extension, says in one line how to get Chrome's cookies", async () => {
    setActiveStrings(dict);
    setAgent(WINDOWS);
    await openWith({ sources: [diskChrome], extension: "extension_not_paired" });
    expect(document.body.textContent).toContain(B.builtinBrowser.importAppBoundHint("not_paired"));
    await unmountAll();

    setAgent(LINUX);
    await openWith({ sources: [diskChrome], extension: "extension_not_paired" });
    expect(document.body.textContent).not.toContain(
      B.builtinBrowser.importAppBoundHint("not_paired"),
    );
  });
});

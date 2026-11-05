/**
 * The shell's question when the window would close or reload over unsaved edits
 * (src/unload-prompt.ts; main.ts shows it on `will-prevent-unload`).
 *
 * - It asks in the Web App's own words, in either language: the same question, the same two
 *   buttons as the page's prompt.
 * - Discarding is the first button; keeping the edits is the default and what Escape answers.
 * - "Discard" lets the page go, and a quit in progress goes on.
 * - "Keep editing" keeps the page and calls a quit in progress off, so the next close of the
 *   window is an ordinary one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  UNLOAD_DISCARD,
  UNLOAD_KEEP,
  afterUnloadAnswer,
  unloadPrompt,
} from "../src/unload-prompt.js";
import type { TrayLocale } from "../src/tray-menu.js";

/**
 * The Web App's prompt words (`common.discardBody` / `discard` / `keepEditing`), read from its
 * dictionaries: this package cannot import them.
 */
function webPrompt(locale: TrayLocale): { body: string; discard: string; keep: string } {
  const file = locale === "zh" ? "strings.ts" : "strings-en.ts";
  const text = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../web/src/lib", file),
    "utf8",
  );
  const found = /discardBody: "([^"]+)",\s*discard: "([^"]+)",\s*keepEditing: "([^"]+)"/.exec(text);
  expect(found, `the prompt's words moved in packages/web/src/lib/${file}`).not.toBeNull();
  return { body: found![1]!, discard: found![2]!, keep: found![3]! };
}

describe("the unload question", () => {
  it.each(["zh", "en"] as const)("asks in the Web App's own words (%s)", (locale) => {
    const box = unloadPrompt(locale, "PenguinHarness");
    const web = webPrompt(locale);
    const joiner = locale === "en" ? " " : "";
    expect(`${box.message}${joiner}${box.detail}`).toBe(web.body);
    expect(box.buttons).toEqual([web.discard, web.keep]);
  });

  it("offers discarding first and keeps the edits by default and on Escape", () => {
    const box = unloadPrompt("en", "PenguinHarness");
    expect(box.buttons?.[UNLOAD_DISCARD]).toBe("Discard changes");
    expect(box.defaultId).toBe(UNLOAD_KEEP);
    expect(box.cancelId).toBe(UNLOAD_KEEP);
  });

  it("lets the page go on discard, and a quit in progress goes on", () => {
    expect(afterUnloadAnswer(UNLOAD_DISCARD, true)).toEqual({ unload: true, quitting: true });
    expect(afterUnloadAnswer(UNLOAD_DISCARD, false)).toEqual({ unload: true, quitting: false });
  });

  it("keeps the page on keep editing, and calls a quit in progress off", () => {
    expect(afterUnloadAnswer(UNLOAD_KEEP, true)).toEqual({ unload: false, quitting: false });
  });
});

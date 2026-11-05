/**
 * The native question the shell asks when the window is about to close or reload while the Web
 * App holds unsaved edits — pure, no Electron runtime (unit-tested); main.ts shows it.
 *
 * The page cannot ask itself: an Electron window whose page refuses to unload (its
 * `beforeunload` listener, which the Web App keeps for exactly as long as a form is dirty)
 * draws nothing — it cancels the close silently unless the main process answers
 * `will-prevent-unload`. The shell answers with this box, in the same words as the Web App's
 * own prompt, and only the answer "discard" lets the page go.
 *
 * The words are written here rather than read from the Web App's catalogs for the reason the
 * tray menu's are (tray-menu.ts): the shell cannot import from `packages/web`, and the type makes
 * a missing translation a compile error.
 */
import type { MessageBoxSyncOptions } from "electron";
import type { TrayLocale } from "./tray-menu.js";

interface UnloadWords {
  /** The question, as the box's message. */
  question: string;
  /** What answering "discard" costs, under it. */
  consequence: string;
  discard: string;
  keep: string;
}

const WORDS: Record<TrayLocale, UnloadWords> = {
  en: {
    question: "Discard unsaved changes?",
    consequence: "What you typed will be lost.",
    discard: "Discard changes",
    keep: "Keep editing",
  },
  zh: {
    question: "放弃未保存的修改？",
    consequence: "未保存的内容将丢失。",
    discard: "放弃修改",
    keep: "继续编辑",
  },
};

/** The box's buttons, by index: discarding is the first, keeping the edits the default. */
export const UNLOAD_DISCARD = 0;
export const UNLOAD_KEEP = 1;

/** The box, in the Web App's language. Escape, and closing the box, answer "keep editing". */
export function unloadPrompt(locale: TrayLocale, appName: string): MessageBoxSyncOptions {
  const words = WORDS[locale];
  return {
    type: "question",
    title: appName,
    message: words.question,
    detail: words.consequence,
    buttons: [words.discard, words.keep],
    defaultId: UNLOAD_KEEP,
    cancelId: UNLOAD_KEEP,
    noLink: true,
  };
}

/**
 * What the shell does with the answer: whether the page may unload, and whether a quit in
 * progress goes on. Keeping the edits also calls the quit off — the window stays, and a later
 * close of it must be an ordinary close (to the tray, when that is on), not the tail of a quit
 * the user already declined.
 */
export function afterUnloadAnswer(
  choice: number,
  quitting: boolean,
): { unload: boolean; quitting: boolean } {
  return choice === UNLOAD_DISCARD
    ? { unload: true, quitting }
    : { unload: false, quitting: false };
}

/**
 * Mock data (en + zh) shared by the gallery's demos, the `/screens` compositions and the package
 * tests: one coherent dataset — the "Build Claude Code docs expert" session, its tool calls, its
 * Trace, a model list, the Workspace tree, company tickets, calendar events and group chat, the
 * notices, form, menus, Vault rows, installed plugins, command palette, slash commands, week of
 * usage, to-do list, failed run and docs answer the modules compose, and the chrome copy they
 * print, plus the type specimens — in two locales of identical shape.
 */
import { en } from "./en";
import type { FixtureLang, Fixtures } from "./types";
import { zh } from "./zh";

export * from "./types";
export { en, zh };

export const FIXTURES: Readonly<Record<FixtureLang, Fixtures>> = { en, zh };

/** The dataset for a locale; anything but `zh` reads as English. */
export function fixturesFor(lang: string | null | undefined): Fixtures {
  return lang === "zh" ? zh : en;
}

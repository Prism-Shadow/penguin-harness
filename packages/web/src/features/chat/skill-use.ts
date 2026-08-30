/**
 * Skill-invocation helpers for the chat input area (pure logic, shared by chat-input /
 * message-item / the Skill library page, and unit tests).
 *
 * The `[use_skills]` marker block itself is **not** defined here: it is a globally agreed
 * format shared by the frontend, the backend and the core prompt template, so its producer
 * and parser live in core's marker module (`@prismshadow/penguin-core/markers`) and are
 * re-exported below for this feature's existing importers. What stays local is the UI-only
 * part: icon path, UI-language text selection, dropdown filtering and slash command items.
 */
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";

export { buildSkillsMessage, parseSkillsMessage } from "@prismshadow/penguin-core/markers";

/** Book icon (24×24 line path): shared across skill-related UI (nav items are inlined separately in sidebar / app-layout). */
export const BOOK_ICON =
  "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z";

/**
 * Picks copy based on the UI language: uses the Chinese value when locale is zh and one is
 * provided, otherwise falls back to English. Shared by the skill library page's group
 * name/group description/skill description, the input area's chip hint, and the slash skill
 * item's description (the library metadata's Chinese fields are all optional).
 */
export function localizedText(locale: "zh" | "en", enText: string, zhText?: string): string {
  return locale === "zh" && zhText ? zhText : enText;
}

/** Minimal shape needed to pick a short description's copy (SkillMetadataItem is a superset). */
export interface SkillDescLike {
  description: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
}

/**
 * Picks the **short description** for the UI language (falls back to the full description if
 * missing): language takes priority over length — zh tries shortDescriptionZh ->
 * shortDescription -> description in order; en tries shortDescription -> description. Shared by
 * the skill library card, the composer's skills dropdown, and the slash description.
 */
export function localizedShortText(locale: "zh" | "en", s: SkillDescLike): string {
  if (locale === "zh") {
    return s.shortDescriptionZh || s.shortDescription || s.description;
  }
  return s.shortDescription || s.description;
}

/**
 * Search filter for the skills dropdown (pure function, shared by chat-input's SkillSelect, the
 * pick list and unit tests): case-insensitive substring match against the skill name and
 * localized description; an empty query (including whitespace-only) returns the full list.
 * Generic over the row type so a list of rows carrying extra fields (the create dialog's plugin
 * rows) keeps them through the filter.
 */
export function filterSkills<T extends SkillMetadataItem>(
  skills: T[],
  locale: "zh" | "en",
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  // Match target matches what's displayed: name + localized short text (zh can match the Chinese short description, en is always English).
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) || localizedShortText(locale, s).toLowerCase().includes(q),
  );
}

/** Skill command item for the slash menu (`/<skill_name>` toggles that skill's selection). */
export interface SkillSlashItem {
  /** Skill name (the run action toggles selection by name). */
  name: string;
  /** Menu command: `/<skill_name>` (slash filtering matches on this prefix). */
  cmd: string;
  /** Menu description: the skill's short description first, falling back to the full description if missing (per the UI language; truncated by the menu's own styling if too long). */
  desc: string;
}

/** Assembles installed skills into slash command items (pure function, shared by chat-input's commands and unit tests). */
export function skillSlashItems(
  skills: SkillMetadataItem[],
  locale: "zh" | "en",
): SkillSlashItem[] {
  return skills.map((s) => ({
    name: s.name,
    cmd: `/${s.name}`,
    desc: localizedShortText(locale, s),
  }));
}

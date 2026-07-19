/**
 * Skill invocation for the chat input area (pure logic, shared by chat-input / message-item /
 * the Skill library page, and unit tests).
 * The `<use_skills>` block is a globally agreed-upon format (shared by frontend, backend, and the
 * core prompt template):
 *
 *   <use_skills>
 *   skills: name1, name2
 *   </use_skills>
 *   (blank line) body text…
 *
 * - `buildSkillsMessage`: prepends the source block to the body when selected skills are
 *   non-empty; returns the body unchanged for an empty list;
 * - `parseSkillsMessage`: only recognizes a block at **the start of the message**, returning the
 *   skill names and the remaining body (the message stream collapses the raw block into a
 *   "Skill used" banner and renders the body normally; the Trace page shows it as-is);
 * - `localizedText` / `skillSlashItems`: pure assembly of UI-language text lookup and slash
 *   skill command items.
 */
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";

/** Book icon (24×24 line path): shared across skill-related UI (nav items are inlined separately in sidebar / app-layout). */
export const BOOK_ICON =
  "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z";

/** Generates a message body with a `<use_skills>` block: an empty list omits the block; when there's no body text, only the block is returned (no trailing blank line). */
export function buildSkillsMessage(names: string[], text: string): string {
  if (names.length === 0) return text;
  const block = `<use_skills>\nskills: ${names.join(", ")}\n</use_skills>`;
  return text ? `${block}\n\n${text}` : block;
}

/**
 * Reverse parse of `buildSkillsMessage`: when the message **starts with** a `<use_skills>`
 * block, returns the skill names and the remaining body; otherwise returns null (a block
 * appearing mid-body is treated as plain text and not parsed). The `skills:` line is split by
 * comma and whitespace-trimmed; an empty list is treated as not a source block.
 */
export function parseSkillsMessage(text: string): { skills: string[]; rest: string } | null {
  const m = /^<use_skills>\nskills: ([^\n]+)\n<\/use_skills>/.exec(text);
  if (!m) return null;
  const skills = m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (skills.length === 0) return null;
  return { skills, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}

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
 * Search filter for the skills dropdown (pure function, shared by chat-input's SkillSelect and
 * unit tests): case-insensitive substring match against the skill name and localized
 * description; an empty query (including whitespace-only) returns the full list.
 */
export function filterSkills(
  skills: SkillMetadataItem[],
  locale: "zh" | "en",
  query: string,
): SkillMetadataItem[] {
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

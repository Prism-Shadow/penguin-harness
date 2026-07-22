/**
 * Pure logic for the conversation-time thinking-level picker (chat draft view).
 *
 * The picker is backed by the **Agent settings** (`system_config.model.thinking_level`):
 * it shows the selected Agent's current level and writes a picked level straight through
 * to the Agent config, so the session created on first send — which reads systemConfig
 * fresh — runs with it, and it becomes the Agent's new default (switch-becomes-default).
 * Per review: the menu lists exactly the five levels with short names only (no
 * descriptions, no "default" row) under a title bar naming the control.
 */

/** The five levels, in menu order (mirrors core's ThinkingLevelName). */
export const THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh"] as const;

/**
 * Short display label for a level from the localized name table (S.chat.thinkingLevelNames).
 * Returns null for anything outside the five levels — including "" (an Agent without an
 * explicit override) and session_meta's "default" — so callers can render a placeholder on
 * the trigger and hide the session read-only tag instead of showing a raw internal value.
 */
export function thinkingLevelLabel(
  names: Readonly<Record<string, string>>,
  level: string | null | undefined,
): string | null {
  return level && (THINKING_LEVELS as readonly string[]).includes(level)
    ? (names[level] ?? level)
    : null;
}

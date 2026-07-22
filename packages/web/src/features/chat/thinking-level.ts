/**
 * Pure logic for the conversation-time thinking-level picker (chat draft view).
 *
 * The picker is backed by the **Agent settings** (`system_config.model.thinking_level`):
 * it shows the selected Agent's current level and writes a picked level straight through
 * to the Agent config, so the session created on first send — which reads systemConfig
 * fresh — runs with it, and it becomes the Agent's new default (switch-becomes-default).
 * Per review: the menu lists the levels with short names only (no descriptions, no
 * "default" row) under a title bar naming the control — and it does **not** offer "none"
 * (many models cannot disable thinking): "none" stays a valid stored/wire value, so a
 * legacy config or session that carries it still displays via the label table below.
 */

/** All five stored/wire levels, for display lookup (mirrors core's ThinkingLevelName). */
export const THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh"] as const;

/**
 * The levels the picker offers, in menu order: "none" is deliberately excluded (many models
 * don't support disabling thinking) — it can still be displayed (a stored legacy value) but
 * never picked.
 */
export const SELECTABLE_THINKING_LEVELS = ["low", "medium", "high", "xhigh"] as const;

/**
 * Short display label for a level from the localized name table (S.chat.thinkingLevelNames).
 * Covers all five stored levels including "none" (so a legacy value displays sanely instead
 * of being rewritten or hidden). Returns null for anything else — including "" (an Agent
 * without an explicit override) and session_meta's "default" — so callers can render a
 * placeholder on the trigger and hide the session read-only tag instead of showing a raw
 * internal value.
 */
export function thinkingLevelLabel(
  names: Readonly<Record<string, string>>,
  level: string | null | undefined,
): string | null {
  return level && (THINKING_LEVELS as readonly string[]).includes(level)
    ? (names[level] ?? level)
    : null;
}

/**
 * Pure logic for the conversation-time thinking-level picker (chat draft view).
 *
 * The picker is backed by the **Agent settings** (`system_config.model.thinking_level`):
 * it shows the selected Agent's current level and writes a picked level straight through
 * to the Agent config, so the session created on first send — which reads systemConfig
 * fresh — runs with it, and it becomes the Agent's new default. Option copy is reused
 * from the agent-settings dictionary (S.agent.thinkingLevelOptions).
 */

export interface ThinkingLevelChoice {
  /** The level value ("" = no override: follow the provider default). */
  value: string;
  /** Short tag shown on the trigger button and at the row head ("" renders the localized default tag). */
  label: string;
  /** One-line description (from the agent-settings dictionary). */
  description: string;
  /**
   * The "" row (no override) cannot be persisted through the agent-config API — its enum
   * validator rejects "" — so it's selectable only when it already **is** the current state
   * (where clicking it is a no-op); otherwise it's shown disabled, as a description of what
   * "no override" means rather than a reachable choice.
   */
  disabled: boolean;
}

/** Builds the picker rows from the agent-settings options ([value, description] pairs). */
export function thinkingLevelChoices(
  options: ReadonlyArray<readonly [string, string]>,
  defaultTag: string,
  current: string,
): ThinkingLevelChoice[] {
  return options.map(([value, description]) => ({
    value,
    label: value || defaultTag,
    description,
    disabled: value === "" && current !== "",
  }));
}

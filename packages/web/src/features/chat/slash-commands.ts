/**
 * The composer's built-in slash commands, per composer state. Installed skills follow them in
 * the menu as one `/<name>` entry each (skill-use.ts); this module decides only the built-ins,
 * so which state offers which command is stated, and tested, in one place.
 */

/** Where a composer sits: the new-conversation draft, a live Session, or a subagent child. */
export type ComposerState = "draft" | "session" | "subagent";

/** The built-in commands, in menu order. */
export type BuiltinSlashCommand = "/compact" | "/goal" | "/model" | "/agent";

/**
 * Which built-in commands the slash menu offers. A command is listed only where running it
 * does something:
 * - `/compact` compacts a Session's context, so a live Session only: a draft has no Session
 *   yet, and a subagent child has no compaction surface.
 * - `/goal` engages goal mode for the next send, which a draft's first send can start as well;
 *   a subagent child has no goal mode.
 * - `/model` and `/agent` stage a switch that forks or hands over an existing conversation, so
 *   a live Session only (a draft picks its model and Agent in its own selectors).
 *
 * `available` says whether the host supplied what a command runs on — the compaction handler,
 * the switch handler with models to pick from, the handoff handler with Agents to pick from.
 */
export function builtinSlashCommands(
  state: ComposerState,
  available: { compact: boolean; switchModel: boolean; handoff: boolean },
): BuiltinSlashCommand[] {
  const commands: BuiltinSlashCommand[] = [];
  if (state === "session" && available.compact) commands.push("/compact");
  if (state !== "subagent") commands.push("/goal");
  if (state === "session" && available.switchModel) commands.push("/model");
  if (state === "session" && available.handoff) commands.push("/agent");
  return commands;
}

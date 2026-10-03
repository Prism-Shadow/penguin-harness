/**
 * The plugin's configuration: one settings group (a `PluginConfigProvider.groups`
 * contribution, so it is in the generated ifaces.json) an admin edits on the Settings dialog's
 * Plugins page. The plugin reads it back through `PluginConfig.get` on every relay pass, so a
 * save applies to the next pass without a restart.
 *
 *   relayDepth   how far a reply may travel between room sessions: a person's message is depth
 *                0, a reply one more than the message its writer was answering, and a message
 *                at this depth is no longer relayed
 *   pollSeconds  how often the relay reads the rooms for new messages
 */

/** The settings group the module declares — its contribution id, which the values are stored under. */
export const CONFIG_GROUP = "company-roadmaps";

export const DEFAULT_RELAY_DEPTH = 3;
export const DEFAULT_POLL_SECONDS = 5;

export interface RoadmapConfig {
  relayDepth: number;
  pollSeconds: number;
}

function bounded(raw: unknown, min: number, max: number, fallback: number): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max
    ? raw
    : fallback;
}

/** The stored values, each one outside its bounds read as its default. */
export function configOf(values: Record<string, unknown>): RoadmapConfig {
  return {
    relayDepth: bounded(values.relayDepth, 1, 10, DEFAULT_RELAY_DEPTH),
    pollSeconds: bounded(values.pollSeconds, 1, 300, DEFAULT_POLL_SECONDS),
  };
}

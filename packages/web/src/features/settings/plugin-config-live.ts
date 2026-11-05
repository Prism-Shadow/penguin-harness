/**
 * A settings page's live parts — what a group's status reports per read (notices, actions, the
 * backend report, the options this machine cannot honour) — laid over the entries on screen
 * after something changed the machine (an install from the Sandbox card's prompt), without
 * touching their values, so drafts being edited are kept.
 */
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";

export function withLiveParts(
  entries: readonly PluginConfigEntry[],
  fresh: readonly PluginConfigEntry[],
): PluginConfigEntry[] {
  return entries.map((e) => {
    const next = fresh.find((p) => p.name === e.name);
    if (next === undefined) return e;
    const { notices: _n, actions: _a, backend: _b, unavailable: _u, ...rest } = e;
    return {
      ...rest,
      ...(next.notices !== undefined ? { notices: next.notices } : {}),
      ...(next.actions !== undefined ? { actions: next.actions } : {}),
      ...(next.backend !== undefined ? { backend: next.backend } : {}),
      ...(next.unavailable !== undefined ? { unavailable: next.unavailable } : {}),
    };
  });
}

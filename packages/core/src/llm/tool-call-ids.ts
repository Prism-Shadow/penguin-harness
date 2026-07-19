/**
 * Session-level uniqueness for tool_call_id.
 *
 * Some providers don't produce a real call id: e.g. Gemini's functionCall has no id, so AgentHub
 * uses the **function name** as the `tool_call_id` — consecutive/parallel calls to the same tool then
 * all share one id. But the OmniMessage world (engine dispatch/pairing, approval routing, frontend
 * tool-card attribution) keys on `tool_call_id`, and a collision lets a later call overwrite the
 * earlier one (parallel same-name calls in one turn can even be dropped entirely).
 *
 * Approach: inbound, `EventTranslator` disambiguates duplicate ids with a `#n` suffix (the first keeps
 * the original id); outbound (returning tool_result, replaying history on resume) uses
 * `stripToolCallIdSuffix` to strip the suffix and restore the original — Gemini's functionResponse
 * pairs by using `tool_call_id` as the name, so it must be restored to the function name. The registry
 * lives at Session level (the new GenerativeModel rebuilt on compaction shares the same instance), and
 * on resume `setHistory` seeds it with historical ids, so the uniqueness scope covers the entire
 * context the frontend renders.
 * Docs: /docs/interfaces § "The built-in implementation: GenerativeModel".
 */
export class ToolCallIdAllocator {
  /** OmniMessage-level tool_call_ids already taken in this Session (history-seeded + allocated). */
  private used = new Set<string>();

  /** Register an already-used id (for resume seeding); registering twice is harmless. */
  markUsed(id: string): void {
    this.used.add(id);
  }

  /**
   * Allocate a Session-unique id for a provider-reported tool_call_id: if unused, keep the original;
   * if already used (a repeat call from a name-as-id provider), take the first free `origId#n` (n from 2).
   * Providers with truly unique ids (OpenAI `call_*` / Claude `toolu_*`) never collide, so they pass through unchanged.
   */
  allocate(providerId: string): string {
    let id = providerId;
    for (let n = 2; this.used.has(id); n += 1) {
      id = `${providerId}#${n}`;
    }
    this.used.add(id);
    return id;
  }
}

/**
 * Strip the `#n` suffix added by `allocate`, restoring the provider's original id (returns as-is when
 * there's no suffix; idempotent). On resume there's no registry to compare against, so it trims by
 * shape: real ids from known providers (OpenAI/Claude `call_*`/`toolu_*`, Gemini function names — `#`
 * isn't a valid function-name char) never end in `#<digits>`, so they aren't harmed.
 */
export function stripToolCallIdSuffix(id: string): string {
  return id.replace(/#\d+$/, "");
}

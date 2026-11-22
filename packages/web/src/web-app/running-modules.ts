/**
 * The plugin server modules a viewer's server runs, as the gates read them (lib/module-gate.ts):
 * the server's answer (`GET /api/contributions`' `modules`) when it has come, and until then the
 * list this browser last saw for the same account — so a plugin's web half that ran last time is
 * drawn from the first frame instead of popping in once the request returns, and one that did
 * not run stays away. The answer replaces the remembered list as soon as it arrives.
 *
 * Kept in `penguin.serverModules.<userId>`, install-scoped (lib/install-scope.ts): the list is a
 * fact about this data root's plugins, so a browser pointed at another root forgets it. Storage
 * that cannot be read or written is no list at all.
 */
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";

const KEY_PREFIX = "penguin.serverModules.";

function remembered(userId: string): readonly string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY_PREFIX + userId);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((m) => typeof m === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function remember(userId: string, modules: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(KEY_PREFIX + userId, JSON.stringify(modules));
  } catch {
    // A browser that keeps nothing asks the server on every load, as before.
  }
}

/** The list to gate on for `userId` (null = signed out or safe mode: every gate shut). */
export function runningModulesFor(
  userId: string | null,
  answer: ContributionsResponse | null,
): readonly string[] | null {
  if (userId === null) return null;
  if (answer?.modules !== undefined) {
    remember(userId, answer.modules);
    return answer.modules;
  }
  return remembered(userId);
}

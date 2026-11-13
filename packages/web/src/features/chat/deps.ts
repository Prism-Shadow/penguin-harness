/**
 * What the chat module binds into its page (lib/module-deps.tsx): the `sessionTabs` contributions
 * (iface.ts), read once at boot.
 */
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import { createDeps } from "../../lib/module-deps";
import type { SessionTab, SessionTabData } from "./iface";

export interface ChatDeps {
  /** By `order`, top first. */
  sessionTabs: ReadonlyArray<{ id: string; Tab: SessionTab }>;
}

export const chatDeps = createDeps<ChatDeps>();

/** The `sessionTabs` contributions as the page mounts them. */
export function sessionTabsOf(contributions: readonly Contributed[]): ChatDeps["sessionTabs"] {
  return [...contributions]
    .sort(
      (a, b) =>
        (a.data as unknown as SessionTabData).order - (b.data as unknown as SessionTabData).order,
    )
    .map((c) => ({ id: c.id, Tab: c.code as SessionTab }));
}

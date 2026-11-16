/**
 * What the chat module binds into its page (lib/module-deps.tsx): the `sessionTabs` and
 * `fileRenderers` contributions (iface.ts), read once at boot.
 */
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import type { FileRenderer } from "../../lib/file-renderers";
import { createDeps } from "../../lib/module-deps";
import type { FileRendererData, SessionTab, SessionTabData } from "./iface";

export interface ChatDeps {
  /** By `order`, top first. */
  sessionTabs: ReadonlyArray<{ id: string; Tab: SessionTab }>;
  /** The named file renderers, by name: the registry a server's rule picks from. */
  fileRenderers: ReadonlyMap<string, FileRenderer>;
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

/** The `fileRenderers` contributions by name; of two with one name, the first in module order. */
export function fileRenderersOf(contributions: readonly Contributed[]): ChatDeps["fileRenderers"] {
  const byName = new Map<string, FileRenderer>();
  for (const c of contributions) {
    const { name } = c.data as unknown as FileRendererData;
    if (!byName.has(name)) byName.set(name, c.code as FileRenderer);
  }
  return byName;
}

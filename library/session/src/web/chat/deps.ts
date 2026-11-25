/**
 * What the chat module binds into its page (lib/module-deps.tsx): the `fileRenderers`
 * contributions (iface.ts), read once at boot.
 */
import type { ComponentType } from "react";
import type { Contributed } from "@prismshadow/penguin-core/kernel";
import { createDeps, gatedComponent } from "@prismshadow/penguin-web/internal";
import type { FileRenderer } from "@prismshadow/penguin-web/internal";

import type { FileRendererData } from "./iface";

export interface ChatDeps {
  /** The named file renderers, by name: the registry a server's rule picks from. */
  fileRenderers: ReadonlyMap<string, FileRenderer>;
}

export const chatDeps = createDeps<ChatDeps>();

/** The `fileRenderers` contributions by name; of two with one name, the first in module order. */
export function fileRenderersOf(contributions: readonly Contributed[]): ChatDeps["fileRenderers"] {
  const byName = new Map<string, FileRenderer>();
  for (const c of contributions) {
    const { name } = c.data as unknown as FileRendererData;
    if (!byName.has(name)) byName.set(name, c.code as FileRenderer);
  }
  return byName;
}

/**
 * The contributions with each component drawn only while its module is shown: a module waiting
 * for its server module (lib/module-gate.ts) has its file renderer draw nothing until that module
 * runs. The chat module applies it at boot.
 */
export function gatedChatContributions(contributions: readonly Contributed[]): Contributed[] {
  return contributions.map((c) => ({
    ...c,
    code: gatedComponent(c.from, c.code as ComponentType<object>),
  }));
}

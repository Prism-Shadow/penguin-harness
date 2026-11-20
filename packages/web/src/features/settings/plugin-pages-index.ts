/**
 * What the Settings dialog reads, once per opening, to know its plugin pages: this server's plugin
 * library (any signed-in viewer: the pages' names and icons) and, for an admin, this server's
 * plugin settings (which plugin declares which group). Both are this server's own answers, read
 * side by side; a read that fails counts as empty, so a page still opens from what did answer.
 * Null until both have answered — the rail draws its plugin group only then, so a page's name
 * never changes under the reader.
 */
import { useEffect, useState } from "react";
import type { PluginConfigEntry, PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";

export interface PluginPagesIndex {
  library: PluginItem[];
  entries: PluginConfigEntry[];
}

export function usePluginPagesIndex(open: boolean, isAdmin: boolean): PluginPagesIndex | null {
  const [index, setIndex] = useState<PluginPagesIndex | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIndex(null);
    const library = api.getPluginLibrary(null).then(
      (r) => r.groups.flatMap((g) => g.plugins),
      () => [],
    );
    const entries = isAdmin
      ? api.adminGetPluginConfig(null).then(
          (r) => r.plugins,
          () => [],
        )
      : Promise.resolve([]);
    void Promise.all([library, entries]).then(([lib, ents]) => {
      if (!cancelled) setIndex({ library: lib, entries: ents });
    });
    return () => {
      cancelled = true;
    };
  }, [open, isAdmin]);
  return index;
}

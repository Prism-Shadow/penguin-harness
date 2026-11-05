/**
 * The plugin library's self-evolution toolkits (rsi-methods.ts) as the Web App reads them: the
 * start page counts them and the Use dialog's Method select offers them. Read on every mount, so a
 * toolkit an admin installs or removes on the Plugins page shows the next time either is opened.
 */
import type { PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { useFreshRead, type FreshRead } from "../../lib/use-fresh-read";
import { rsiToolkits } from "./rsi-methods";

/** The last list read in this page load: the library is the same for every Project. */
const toolkitLists = new Map<string, PluginItem[]>();

/** The plugins of this server's library's `rsi` category (GET /api/plugins); null until the first list. */
export function useRsiToolkits(): FreshRead<PluginItem[]> {
  return useFreshRead(toolkitLists, "library", async () =>
    rsiToolkits(await api.getPluginLibrary(null)),
  );
}

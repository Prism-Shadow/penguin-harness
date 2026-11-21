/**
 * A library plugin's server module, as the pages beside the plugin feature follow it: the
 * administrator's ledger of requests and decisions, and the event that says a module changed.
 *
 * - **The ledger** (`GET /api/admin/plugin-modules`) is one read per server, shared by every reader
 *   (lib/read-store.ts): the Settings page that decides, with the count on its rail row, the
 *   Plugins page's notice that counts what waits, and the Plugins nav entry's dot. Only the administrator reads it; for anyone else
 *   it reads as nothing known. A decision brings the new list back and hands it over at once
 *   ({@link acceptPluginModuleRequests}).
 * - **The event** (`plugin_modules_changed`, no payload) comes on the user channel when an install
 *   or a decision changed a module on this server — and wrapped as a `machine_event` for a
 *   machine's. The ledger is read again on it (and on `resync_required`, after which nothing missed
 *   is known); {@link onPluginModulesChanged} hands it to a page that shows module states of its
 *   own, which reads again what it shows. The event never raises a toast.
 */
import { useEffect, useRef } from "react";
import type { PluginModuleRequestsResponse, ServerEvent } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { subscribeUserEvents } from "./amsp/user-events";
import { createReadStore, useRead, type ReadState } from "./read-store";

const ledger = createReadStore<PluginModuleRequestsResponse>();

/** The ledger's key on a server: this one (null) or a machine through the tunnel. */
const keyOf = (server: string | null): string => `plugin-modules\u0000${server ?? ""}`;

/**
 * The server a module event is about: null for this server's own, a machine's id for one it
 * relayed, undefined for any other event.
 */
export function moduleEventServer(event: ServerEvent): string | null | undefined {
  if (event.type === "plugin_modules_changed") return null;
  if (event.type === "machine_event" && event.event.type === "plugin_modules_changed") {
    return event.machineId;
  }
  return undefined;
}

subscribeUserEvents((event) => {
  if (event.type === "resync_required") {
    ledger.invalidate(keyOf(null));
    return;
  }
  const server = moduleEventServer(event);
  if (server !== undefined) ledger.invalidate(keyOf(server));
});

/**
 * The ledger of `server` (null: this one), read on mount and again whenever a module changed
 * there. `admin` false reads nothing: the route is the administrator's.
 */
export function usePluginModuleRequests(
  server: string | null,
  admin: boolean,
): ReadState<PluginModuleRequestsResponse> {
  return useRead(ledger, keyOf(server), () => api.adminGetPluginModuleRequests(server), {
    enabled: admin,
  });
}

/** Takes the list a decision answered with: what every reader shows from now on. */
export function acceptPluginModuleRequests(
  server: string | null,
  list: PluginModuleRequestsResponse,
): void {
  ledger.accept(keyOf(server), list);
}

/**
 * Calls `reread` with the server whose modules changed (null: this one) for as long as the
 * calling component is mounted, so a page showing module states reads them again. `enabled`
 * false listens to nothing.
 */
export function useOnPluginModulesChanged(
  reread: (server: string | null) => void,
  enabled = true,
): void {
  // The caller's newest closure answers each event; the subscription is not renewed for a new
  // function on every render.
  const latest = useRef(reread);
  latest.current = reread;
  useEffect(() => {
    if (!enabled) return;
    return subscribeUserEvents((event) => {
      const server = moduleEventServer(event);
      if (server !== undefined) latest.current(server);
    });
  }, [enabled]);
}

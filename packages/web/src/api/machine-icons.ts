/**
 * Icons in a machine's answers. A listing names an icon by a path on the server that answered
 * (`/api/…?rev=`), and an `<img>` asks this page's own origin, so an answer that came from a
 * machine names an image on THAT machine: its icons are re-rooted onto the machine's same-origin
 * proxy (`/server/<id>/api/…`, lib/server-context.ts), the path every other call to it takes.
 * Where the proxy cannot serve one, the image fails to load and the kind's glyph shows.
 */
import type { IconRef } from "@prismshadow/penguin-server/api";
import { apiUrl } from "../lib/server-context";

/** The items with their icons re-rooted onto `machineId`; as they are for this server (null). */
export function iconsOn<T extends { icon?: IconRef }>(
  items: readonly T[],
  machineId: string | null,
): T[] {
  if (machineId === null) return [...items];
  return items.map((item) =>
    item.icon === undefined
      ? item
      : { ...item, icon: { ...item.icon, url: apiUrl(item.icon.url, machineId) } },
  );
}

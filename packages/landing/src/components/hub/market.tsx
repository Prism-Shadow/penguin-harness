/**
 * What the Plugins list and a plugin's page share from the plugin market: a plugin's cover (its
 * authored picture from the curation document, else the generated one in the plugin's own hue),
 * its icon (its package's, else the document's raster icon for a plugin that is not bundled), the
 * routed link a shared showcase part takes as `href` + `onOpen`, and the site's two button looks
 * for the actions beside a cover.
 *
 * The showcase parts read their palette from `.site-ui` (packages/ui site.css): every one of
 * them on this site sits inside an element with that class.
 */
import type { MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { Cover } from "@prismshadow/penguin-ui/site";
import { pluginAssetUrl } from "../../lib/community-assets";
import { listState } from "../../lib/hub/back";
import { pluginHue } from "../../lib/hub/plugin-hue";
import type { PluginSummary } from "../../lib/hub/types";

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

/** The product's mark: a generated cover's corner, or its tile when the plugin has no icon. */
const LOGO = `${BASE}/penguin-logo.svg`;

/** The site's primary action (the hero's Download), at the size a cover's text block takes. */
export const PRIMARY_ACTION =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white";

/** The site's secondary action: the same box, outlined. */
export const SECONDARY_ACTION =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800";

/** A plugin's icon: its package's own, else the one the curation document names, else none. */
export function pluginIcon(plugin: PluginSummary): PluginSummary["icon"] {
  if (plugin.icon !== undefined) return plugin.icon;
  return plugin.marketIcon === undefined
    ? undefined
    : { url: pluginAssetUrl(plugin.marketIcon), tint: false };
}

/** A plugin's cover: `thumb` on a card and in the carousel's rail, `full` on a hero. */
export function PluginCover({
  plugin,
  rendition = "thumb",
  eager = false,
}: {
  plugin: PluginSummary;
  rendition?: "thumb" | "full";
  eager?: boolean;
}) {
  const cover = plugin.cover;
  return (
    <Cover
      image={
        cover
          ? {
              src: pluginAssetUrl(cover.src),
              thumb: cover.thumb === undefined ? undefined : pluginAssetUrl(cover.thumb),
              tone: cover.tone,
            }
          : null
      }
      rendition={rendition}
      seed={plugin.id}
      hue={pluginHue(plugin.id)}
      icon={pluginIcon(plugin)}
      logo={LOGO}
      eager={eager}
    />
  );
}

/**
 * A hub entry's link for a shared part that takes `href` and `onOpen`: the address under the
 * site's base, and a handler that routes a plain click in the app with the list's address in the
 * history state, so the entry page's back control returns to the list as it was left
 * (lib/hub/back.ts). A modifier or middle click is the browser's.
 */
export function useEntryLink(): (to: string) => {
  href: string;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  return (to) => ({
    href: `${BASE}${to}`,
    onOpen: (event) => {
      const plain =
        event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (event.defaultPrevented || !plain) return;
      event.preventDefault();
      void navigate(to, { state: listState(location) });
    },
  });
}

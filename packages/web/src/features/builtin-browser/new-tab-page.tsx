/**
 * What a new tab shows when no homepage is set: a few common sites, each a tile that opens it in
 * the tab. The page under it stays `about:blank`; the panel draws this over the empty slot, the
 * same way it draws a crashed page's notice.
 *
 * Each site is a monogram tile rather than its favicon: nothing is fetched to draw the page, so it
 * looks the same offline and asks no site anything before the user picks it. The address sits in
 * the tile's hint, since only the name is on screen.
 */
import { S } from "../../lib/strings";

export function NewTabPage({ onOpen }: { onOpen: (url: string) => void }) {
  return (
    <div
      data-testid="builtin-browser-start-page"
      className="@container flex h-full items-center justify-center overflow-y-auto p-6"
    >
      <nav aria-label={S.builtinBrowser.startPage.label}>
        {/* Six in a row where the panel holds them, else two even rows of three. */}
        <ul className="grid grid-cols-3 gap-2 @2xl:grid-cols-6">
          {START_PAGE_SITES.map((site) => {
            const name = S.builtinBrowser.startPage.sites[site.id];
            return (
              <li key={site.id}>
                <button
                  type="button"
                  data-tooltip={new URL(site.url).host}
                  data-tooltip-extra
                  onClick={() => onOpen(site.url)}
                  className="flex w-24 flex-col items-center gap-2 rounded-lg px-1.5 py-3 transition-colors duration-150 hover:bg-surface-muted"
                >
                  <span
                    aria-hidden
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-canvas text-sm font-semibold text-fg-muted ring-1 ring-line-muted"
                  >
                    {site.monogram}
                  </span>
                  <span className="line-clamp-2 max-w-full text-center text-xs text-fg">
                    {name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export { START_PAGE_SITES } from "../../lib/browser-start-sites";
import { START_PAGE_SITES } from "../../lib/browser-start-sites";

export type { StartPageSiteId } from "../../lib/browser-start-sites";
import type { StartPageSiteId } from "../../lib/browser-start-sites";

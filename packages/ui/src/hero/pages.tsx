/**
 * The window's pages other than the chat, each the composition a module already builds for that
 * surface — imported, never redrawn here, so the window shows exactly what the module's own card
 * shows and the two cannot drift apart.
 *
 * Where no module draws a page yet, the nearest composition stands in:
 *
 * - Agents: the Agents page toolbar with its list (actions, `toolbar`);
 * - Plugins: the Plugins page (pages, `settings`);
 * - Models: the models table (tables, `band`);
 * - Cost Center: a week of tokens by bucket and the month's spend against its budget (stats,
 *   `usage`);
 * - Evaluation Center: no module draws it; the nearest is a run's numbers — the stat strip, the
 *   summary, the ring and the sparkline (stats, `overview`);
 * - Settings: the Appearance and General preference rows (forms, `settings`).
 *
 * A composition renders with no clock over it: the pages are at rest, and a module that plays a
 * scene on its card draws that scene's settled frame here, whatever clock the window runs.
 */
import type { ThemeModeName } from "../tokens";
import type { FixtureLang, Fixtures } from "../fixtures";
import type { Module } from "../module";
import { module as actions } from "../modules/actions.module";
import { module as forms } from "../modules/forms.module";
import { module as pages } from "../modules/pages.module";
import { Heading } from "../modules/parts";
import { module as stats } from "../modules/stats.module";
import { module as tables } from "../modules/tables.module";
import { SceneContext, SceneControlsContext } from "../scene";
import type { ShellPage } from "./shell";

export interface PageView {
  /** The module whose composition the page shows. */
  module: Module;
  /** Which of its variants. */
  variant: string;
  /** The composition carries the page's own title, so the window adds none. */
  titled: boolean;
  /** A `narrow` composition keeps a reading width; the others take the page's. */
  measure: "narrow" | "wide";
}

export const SHELL_PAGE_VIEWS: Readonly<Record<Exclude<ShellPage, "chat">, PageView>> = {
  agents: { module: actions, variant: "toolbar", titled: true, measure: "narrow" },
  plugins: { module: pages, variant: "settings", titled: true, measure: "wide" },
  models: { module: tables, variant: "band", titled: false, measure: "wide" },
  usage: { module: stats, variant: "usage", titled: false, measure: "wide" },
  benchmark: { module: stats, variant: "overview", titled: false, measure: "wide" },
  settings: { module: forms, variant: "settings", titled: false, measure: "narrow" },
};

/** The words a page is called by: the sidebar's own entry, or Settings for the user row's page. */
export function pageTitle(f: Fixtures, page: Exclude<ShellPage, "chat">): string {
  return page === "settings" ? f.copy.common.settings : f.copy.nav[page];
}

/**
 * One page in the main column: the composition, scrolling in the column as a page does in the
 * app, under the page's title where the composition has none of its own. The Plugins page brings
 * its own frame and padding; every other composition gets the same page frame around it.
 */
export function ShellPageView({
  f,
  page,
  lang,
  mode,
}: {
  f: Fixtures;
  page: Exclude<ShellPage, "chat">;
  lang: FixtureLang;
  mode: ThemeModeName;
}) {
  const view = SHELL_PAGE_VIEWS[page];
  const body = view.module.render(view.variant, { lang, mode });
  const framed = view.module !== pages;
  return (
    <div data-slot="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SceneContext.Provider value={null}>
          <SceneControlsContext.Provider value={null}>
            {framed ? (
              <div
                className={`mx-auto grid grid-cols-[minmax(0,1fr)] gap-6 p-6 ${
                  view.measure === "narrow" ? "max-w-3xl" : "max-w-5xl"
                }`}
              >
                {!view.titled && <Heading level={3}>{pageTitle(f, page)}</Heading>}
                {body}
              </div>
            ) : (
              body
            )}
          </SceneControlsContext.Provider>
        </SceneContext.Provider>
      </div>
    </div>
  );
}

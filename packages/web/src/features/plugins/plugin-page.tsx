/**
 * A plugin's own page in the market (`/plugins/<name>`, with `?machine=<id>` for a machine's
 * card): the store page of one plugin, linkable, its button at the head (plugin-card.tsx, the
 * `page` surface; plugin-detail.tsx `PluginPageView` lays it out). It reads and acts through the
 * same market as the grid (use-plugin-market.tsx), so the button says on the page what it says on
 * the card, and an install started on either runs on across both.
 *
 * Back leads to the market: the step back when the page was opened from it (the grid keeps its
 * tab, its search and where it was scrolled to), else the market itself. A name the market does
 * not list says so, with the way back, once the library has answered.
 */
import { useLocation, useParams, useSearchParams } from "react-router";
import { Button, GlyphIcon, ICON_SIZE, ICONS, PageFrame, Waiting } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PluginCard } from "./plugin-card";
import { rowTitle } from "./plugin-marks";
import { PLUGINS_PATH, usePluginMarket } from "./use-plugin-market";

export function PluginPage() {
  const m = usePluginMarket();
  const name = useParams().pluginName ?? "";
  const [params] = useSearchParams();
  const location = useLocation();
  const row = m.rowNamed(name, params.get("machine"));
  useDocumentTitle(row === undefined ? S.nav.plugins : rowTitle(row, m.locale));
  const fromMarket = (location.state as { fromMarket?: boolean } | null)?.fromMarket === true;
  const back = () => {
    if (fromMarket) void m.navigate(-1);
    else void m.navigate(PLUGINS_PATH);
  };
  return (
    <PageFrame className="[scrollbar-gutter:stable]">
      <Button
        variant="ghost"
        size="sm"
        leading={<GlyphIcon d={ICONS.arrowLeft} size={ICON_SIZE.rowLead} />}
        onClick={back}
        className="-ml-2 mb-4"
      >
        {S.plugins.backToMarket}
      </Button>
      {row !== undefined ? (
        <PluginCard
          key={`${row.origin?.machineId ?? ""}/${row.module?.specifier ?? row.library?.package ?? row.key}`}
          {...m.cardProps(row)}
          surface="page"
        />
      ) : m.groups === null && m.error === null ? (
        <Waiting>
          <div className="h-40" />
        </Waiting>
      ) : (
        <p className="text-sm text-fg-muted">{S.plugins.notListed(name)}</p>
      )}
      {m.dialogs}
    </PageFrame>
  );
}

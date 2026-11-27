/**
 * The plugin market: every plugin as one store card (plugin-card.tsx) — the library's plugins
 * (Skills and/or a hook package, loaded by core from the @penguinharness/* packages and
 * installed on Agents) and the server modules a Project can ask for (the Agent Sandbox backends
 * and whatever the registry lists, installed on the server by an admin). A card's icon, name and
 * line open the plugin's own page (plugin-page.tsx, `/plugins/<name>`); its one button installs
 * it in place. What the market reads and does is use-plugin-market.tsx, which the plugin's page
 * shares.
 *
 * - **The tabs**: "All", then one tab per section of the grouping (category unless the reader
 *   picks status or contents; no grouping, no tabs). The tab is in the URL (`?tab=<section>`),
 *   so a tab can be linked; one the grouping does not have reads as All. The grouping select and
 *   the sort select stand at the row above; both are remembered per browser (plugin-groups.ts,
 *   plugin-market.ts).
 * - **All** lays the plugins out in the grouping's sections, each under its title and count, a
 *   section holding two rows of cards at most with "See all" opening its tab — the way a store's
 *   front page shelves its catalogue. A search, a tab or no grouping lists one grid instead. A
 *   search that finds nothing here but something in another tab says so and offers "All".
 * - **Installed** (`?view=installed`, the header's button) lists every plugin in use — on an
 *   Agent, or on the server — as rows with the same buttons: those with an update first, with
 *   "Update all", then the rest.
 * - The search is kept while the person goes to a plugin's page and back, and so is the place
 *   the grid was scrolled to.
 * - An old address of a plugin's detail (`?plugin=<name>`, with `&machine=<id>`) opens its page.
 *
 * A notice counts the plugins this build cannot fully run. The status rules are in plugin-status.ts.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  ConfirmModal,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  Notice,
  PageFrame,
  PageHeader,
  SearchInput,
  Select,
  ShowcaseLayoutToggle,
  StoreCardSkeleton,
  StoreGrid,
  Tabs,
  TodoNotice,
  Waiting,
  useMeasuredWidth,
  useShowcaseLayout,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { noticeCounts } from "../todos";
import { MachinePicker } from "../machines";
import { toneInk } from "../../lib/tone";
import { PluginCard } from "./plugin-card";
import { rowTitle } from "./plugin-marks";
import {
  ALL_TAB,
  availableSorts,
  initialPluginsSort,
  popularityOf,
  sortRows,
  storePluginsSort,
  tabRows,
  type PluginSort,
} from "./plugin-market";
import {
  PLUGIN_GROUP_BYS,
  groupRows,
  initialPluginsGroupBy,
  storePluginsGroupBy,
  type PluginGroupBy,
  type PluginRow,
} from "./plugin-groups";
import { SourceFailuresNotice } from "./source-failures-notice";
import {
  ALL_MACHINES,
  PLUGINS_PATH,
  SELF_PENDING,
  pluginUpdatePlan,
  usePluginMarket,
  type PluginUpdatePlan,
} from "./use-plugin-market";
import { StdioDisclosure } from "./plugin-mcp";

export { INDEX_RECHECK_MS } from "./plugin-reads";
export { pluginUpdatePlan, type PluginUpdatePlan } from "./use-plugin-market";

/** The query naming the tab on show (absent: All) and the Installed view. */
const TAB_PARAM = "tab";
const VIEW_PARAM = "view";
/** An old address's plugin and machine: they now name a plugin's page. */
const LEGACY_PLUGIN_PARAM = "plugin";
const LEGACY_MACHINE_PARAM = "machine";

/** How many rows of cards a section of All holds before "See all". */
const SECTION_ROWS = { card: 2, row: 4 } as const;

/** The search and the grid's scroll, kept for the page load while a plugin's page is open. */
const memory = { query: "", scroll: new Map<string, number>() };

export function PluginsPage() {
  useDocumentTitle(S.nav.plugins);
  const m = usePluginMarket();
  const { locale } = m;
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get(TAB_PARAM);
  const installedView = params.get(VIEW_PARAM) === "installed";
  /** Free text over names, descriptions and keywords. */
  const [query, setQueryState] = useState(memory.query);
  const setQuery = (next: string) => {
    memory.query = next;
    setQueryState(next);
  };
  const [groupBy, setGroupBy] = useState<PluginGroupBy>(() => initialPluginsGroupBy());
  const [showcase, chooseLayout] = useShowcaseLayout("penguin.pluginsLayout");
  const layout = showcase === "list" ? "row" : "card";
  const [sort, setSort] = useState<PluginSort>(() => initialPluginsSort());
  /** The bulk update's confirmation is open (null = closed); it holds the plan it will run. */
  const [pendingBulk, setPendingBulk] = useState<PluginUpdatePlan | null>(null);
  const chooseGroupBy = (by: PluginGroupBy) => {
    setGroupBy(by);
    storePluginsGroupBy(by);
  };
  const chooseSort = (next: PluginSort) => {
    setSort(next);
    storePluginsSort(next);
  };
  const withParam = (name: string, value: string | null) => (prev: URLSearchParams) => {
    const next = new URLSearchParams(prev);
    if (value === null) next.delete(name);
    else next.set(name, value);
    return next;
  };
  const selectTab = (key: string) =>
    setParams(withParam(TAB_PARAM, key === ALL_TAB ? null : key), { replace: true });
  const setView = (installed: boolean) =>
    setParams(withParam(VIEW_PARAM, installed ? "installed" : null));

  // The grid's scroller: where it stood is kept per history entry, so Back from a plugin's page
  // lands on the card that was opened.
  const frameRef = useRef<HTMLDivElement>(null);
  const scroller = () => frameRef.current?.parentElement?.parentElement ?? null;
  const entry = location.key;
  useLayoutEffect(() => {
    const top = memory.scroll.get(entry);
    const el = scroller();
    if (top !== undefined && el !== null) el.scrollTop = top;
    return () => {
      const at = scroller()?.scrollTop;
      if (at !== undefined) memory.scroll.set(entry, at);
    };
  }, [entry]);

  // How many columns the store grid has here: read off a probe grid of the same tracks, since
  // the tracks are the grid's own rule (rem and the theme's spacing) and the column measures it.
  const gridRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  // Measured so a change of the column's width renders again, and the probe is read again.
  const gridWidth = useMeasuredWidth(gridRef);
  const [columns, setColumns] = useState<number | null>(null);
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (probe === null) return;
    // No tracks where nothing lays the page out: no shelf is cut short there.
    const tracks = getComputedStyle(probe).gridTemplateColumns.split(" ").filter(Boolean).length;
    setColumns(tracks === 0 ? null : tracks);
  }, [gridWidth, layout]);

  const { rows, statusOf, categories, usages, market } = m;
  const searching = query.trim() !== "";
  // The tabs come from the whole list, not the search's matches, so typing never moves them.
  const sections = groupBy === "none" ? [] : groupRows(rows, statusOf, groupBy, categories);
  const tab = tabRows(sections, tabParam, rows, query);
  const activeTab = tab.active;
  /** The market's popularity figures (placeholders for now; see plugin-market.ts), or null. */
  const popularity = popularityOf(market);
  const sorts = availableSorts(popularity);
  /** The sort on show: a stored "popular" reads as the curation's order while no figures exist. */
  const shownSort = sorts.includes(sort) ? sort : "featured";
  const sorted = (list: readonly PluginRow[]) =>
    sortRows(list, shownSort, {
      title: (row) => rowTitle(row, locale),
      selected: market?.selected ?? [],
      usedBy: (row) => usages.get(row.key)?.usedBy.length ?? 0,
      popularity,
    });
  const visible = sorted(tab.rows);
  /** All, shelved: the grouping's sections, while nothing narrows the list. */
  const shelved = activeTab === ALL_TAB && sections.length > 1 && !searching;

  // Keyed by the package, not the row: a market row becomes a library row once the server has
  // it, and the card (with its open install steps) must stay mounted through that. A machine's
  // card keeps its machine in the key, beside this server's card of the same package.
  const card = (row: PluginRow, surface: "card" | "row", showCategory: boolean) => (
    <PluginCard
      key={`${row.origin === undefined ? "" : `${row.origin.machineId}/`}${
        row.module?.specifier ?? row.library?.package ?? row.key
      }`}
      {...m.cardProps(row, { showCategory })}
      surface={surface}
    />
  );

  // An old address of a plugin's detail opens the plugin's page in its place.
  const legacy = params.get(LEGACY_PLUGIN_PARAM);
  if (legacy !== null) {
    const machine = params.get(LEGACY_MACHINE_PARAM);
    return (
      <Navigate
        replace
        to={`${PLUGINS_PATH}/${encodeURIComponent(legacy)}${
          machine === null ? "" : `?${new URLSearchParams({ machine })}`
        }`}
      />
    );
  }

  const cap = columns === null ? Number.POSITIVE_INFINITY : columns * SECTION_ROWS[layout];
  const tabs = [
    { key: ALL_TAB, label: S.plugins.tabAll },
    ...sections.map((s) => ({ key: s.id, label: s.title })),
  ];

  const results: ReactNode =
    m.error && rows.length === 0 ? (
      <div className="mt-2 flex items-center gap-3">
        <p className={`text-sm ${toneInk.danger}`}>{m.error}</p>
        <Button size="sm" onClick={() => window.location.reload()}>
          {S.common.retry}
        </Button>
      </div>
    ) : m.groups === null && rows.length === 0 ? (
      // The cards' own grid, so the placeholders stand in the columns the cards will take.
      <Waiting>
        <StoreGrid layout={layout}>
          {Array.from({ length: 8 }, (_, i) => (
            <StoreCardSkeleton key={i} layout={layout} />
          ))}
        </StoreGrid>
      </Waiting>
    ) : installedView ? (
      <InstalledView
        rows={sorted(rows)}
        statusOf={statusOf}
        update={(row) =>
          statusOf(row) === "update" ||
          (m.isAdmin && row.module?.entry?.localInstall?.updateAvailable === true)
        }
        card={(row) => card(row, "row", true)}
        updateAll={
          m.todo
            ? { busy: m.bulkRunning, onClick: () => setPendingBulk(pluginUpdatePlan(m.agents)) }
            : null
        }
      />
    ) : shelved ? (
      <div className="space-y-10">
        {sections.map((section) => {
          const list = sorted(section.rows);
          return (
            <section key={section.id} aria-label={section.title}>
              <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-line-muted pb-2">
                <h2 className="text-base font-semibold text-fg">
                  {section.title}
                  <span className="ml-2 font-normal text-fg-muted">{list.length}</span>
                </h2>
                {list.length > cap && (
                  <Button size="sm" variant="link" onClick={() => selectTab(section.id)}>
                    {S.plugins.seeAll}
                  </Button>
                )}
              </div>
              <StoreGrid layout={layout}>
                {list.slice(0, cap).map((row) => card(row, layout, groupBy !== "category"))}
              </StoreGrid>
            </section>
          );
        })}
      </div>
    ) : visible.length > 0 ? (
      <StoreGrid layout={layout}>
        {visible.map((row) => card(row, layout, groupBy !== "category" || activeTab === ALL_TAB))}
      </StoreGrid>
    ) : tab.elsewhere > 0 ? (
      <p className="flex flex-wrap items-center gap-x-2 px-1 text-sm text-fg-muted">
        <span>{S.plugins.noMatchHere(tab.elsewhere)}</span>
        <Button size="sm" variant="link" onClick={() => selectTab(ALL_TAB)}>
          {S.plugins.showAllResults}
        </Button>
      </p>
    ) : (
      <p className="px-1 text-sm text-fg-muted">
        {searching && (m.indexPending > 0 || (m.registry.reading && m.index === null))
          ? S.pluginRegistry.searchWhileDownloading
          : S.plugins.noMatch}
      </p>
    );

  const updates = rows.filter((row) => statusOf(row) === "update").length;
  // The scrollbar gutter stays reserved: a search that shortens the page below the viewport
  // would otherwise take the scrollbar with it and shift everything sideways as it is typed.
  return (
    <PageFrame className="[scrollbar-gutter:stable]">
      <div ref={frameRef} hidden />
      {/* The options loaded plugins declare live on the Settings dialog's Plugins page, an
          admin's page; the header's Settings button opens the dialog there rather than sending
          anyone through the user menu to find it. */}
      <PageHeader
        title={S.plugins.pageTitle}
        info={S.plugins.pageDesc}
        {...(installedView
          ? { back: { label: S.plugins.allPlugins, onClick: () => setView(false) } }
          : {})}
        actions={
          <PluginsHeaderActions
            query={query}
            onQuery={setQuery}
            isAdmin={m.isAdmin}
            installed={
              installedView ? null : (
                <Button size="sm" variant="secondary" onClick={() => setView(true)}>
                  {S.plugins.installedView}
                  {updates > 0 && (
                    <Badge variant="soft" tooltip={S.plugins.status.update}>
                      {updates}
                    </Badge>
                  )}
                </Button>
              )
            }
            machinePicker={
              m.otherMachines.length > 0 ? (
                <MachinePicker
                  aria-label={S.plugins.viewMachine}
                  choices={m.machineChoices}
                  value={m.allMachines ? ALL_MACHINES : (m.viewMachine ?? SELF_PENDING)}
                  onChange={(id) => {
                    if (id !== SELF_PENDING) m.setPickedMachine(id === ALL_MACHINES ? null : id);
                  }}
                />
              ) : null
            }
            onOpenSettings={() => m.openSettings("plugins")}
            onImport={m.openImport}
          />
        }
      >
        {/* Last stop on the plugins trail: what the sidebar's dot was pointing at, the control
          that takes all of it in one press, and the way to clear it for someone who has looked
          and decided to stay on the installed copies. */}
        {m.todo && !installedView && (
          <TodoNotice
            text={S.todo.changesUpgradable(noticeCounts(m.todo).updated)}
            actionLabel={S.todo.updateNow}
            busy={m.bulkRunning}
            onAction={() => setPendingBulk(pluginUpdatePlan(m.agents))}
            dismissLabel={S.todo.dismiss}
            onDismiss={m.dismissTodo}
          />
        )}
        {m.indexFailures.length > 0 && (
          <SourceFailuresNotice failures={m.indexFailures} className="mt-4" />
        )}
        {m.indexPending > 0 && (
          <Notice tone="attention" className="mt-4">
            {S.pluginRegistry.sourcePending(m.indexPending)}
          </Notice>
        )}
        {/* While searching, sources still loading mean the results — and especially an empty
            result — are not yet final: say so rather than let noMatch read as "does not exist". */}
        {searching && (m.indexPending > 0 || (m.registry.reading && m.index === null)) && (
          <Notice tone="attention" className="mt-4">
            {S.pluginRegistry.searchWhileDownloading}
          </Notice>
        )}
        {/* A machine whose cards stand as last answered: out of reach, or a read failed. */}
        {m.offlineMarkets.length > 0 && (
          <Notice
            tone="attention"
            className="mt-4"
            {...(m.offlineMarkets.some((mm) => mm.retryable)
              ? {
                  retry: {
                    label: S.common.retry,
                    onClick: () =>
                      m.offlineMarkets.filter((mm) => mm.retryable).forEach((mm) => mm.refresh()),
                  },
                }
              : {})}
          >
            {S.appCenter.machinesOffline(m.offlineMarkets.map((mm) => mm.label).join(", "))}
          </Notice>
        )}
        {/* Only while there is no answer to show: a failed re-read changes nothing on screen. */}
        {m.fallbackKey !== null &&
          m.viewMachine !== undefined &&
          m.fallback.value === null &&
          m.fallback.error !== null && (
            <Notice tone="attention" className="mt-4">
              {S.plugins.machineUnreadable(m.nameOf(m.viewMachine), m.fallback.error)}
            </Notice>
          )}
        {m.deployment !== null && m.viewingHere && m.deployment.restartPending && (
          <Notice tone="attention" className="mt-4">
            {S.plugins.restartPending}
          </Notice>
        )}
        <IncompatibleNotice unsatisfied={m.unsatisfiedCount} />
        <ModuleRequestsNotice
          waiting={m.isAdmin ? (m.moduleRequests.value?.pending ?? 0) : 0}
          onView={() => m.openSettings("moduleRequests")}
        />
      </PageHeader>

      {!installedView && (
        <div className="mb-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <PluginsListControls
                groupBy={groupBy}
                onGroupBy={(by) => {
                  chooseGroupBy(by);
                  // The tab on show belongs to the grouping it came from.
                  if (tabParam !== null) selectTab(ALL_TAB);
                }}
                sort={shownSort}
                sorts={sorts}
                onSort={chooseSort}
                locale={locale}
              />
            </div>
            <ShowcaseLayoutToggle
              value={showcase}
              onChange={chooseLayout}
              labels={{
                group: S.plugins.layoutLabel,
                cards: S.plugins.cardsLayout,
                list: S.plugins.listLayout,
              }}
            />
          </div>
          {groupBy !== "none" && <Tabs items={tabs} active={activeTab} onChange={selectTab} />}
        </div>
      )}

      <div ref={gridRef}>
        <StoreGrid
          ref={probeRef}
          layout={layout}
          aria-hidden
          className="invisible h-0 overflow-hidden"
        >
          <span />
        </StoreGrid>
        {results}
      </div>
      {m.dialogs}
      {/* Bulk update confirmation. Same warning as the per-plugin confirm — an update is an
          overwriting reinstall — and the same primary (overwrite) tone, with the list naming
          every plugin the batch would rewrite. Confirm-first is the point of the button: it
          overwrites many installs in one press, and a single one already asks. */}
      {pendingBulk !== null && (
        <ConfirmModal
          open
          title={S.todo.pluginsConfirmTitle(pendingBulk.plugins.length)}
          tone="primary"
          // As wide as a single plugin's update confirmation, which lists versions.
          widthClass="sm:max-w-lg"
          confirmLabel={S.skills.updateAction}
          cancelLabel={S.common.cancel}
          busy={m.bulkRunning}
          onClose={() => setPendingBulk(null)}
          onConfirm={() => void m.runBulkUpdate(pendingBulk).then(() => setPendingBulk(null))}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">{S.todo.pluginsConfirmBody}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.todo.willTouch}</p>
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingBulk.plugins.map((name) => (
                <li key={name} className="px-3 py-1.5 font-mono text-xs">
                  {name}
                </li>
              ))}
            </ul>
            {/* The reinstalls write each plugin's stdio servers again: what they run here is
                said before they do, as a single install says it. */}
            <StdioDisclosure
              plugins={(m.groups ?? [])
                .flatMap((group) => group.plugins)
                .filter((plugin) => pendingBulk.plugins.includes(plugin.name))}
            />
          </div>
        </ConfirmModal>
      )}
    </PageFrame>
  );
}

/**
 * The Installed view: every plugin in use, as rows with their buttons — those with an update
 * first, under a head with "Update all" (the bulk update the notice offers) — then the rest.
 */
function InstalledView({
  rows,
  statusOf,
  update,
  card,
  updateAll,
}: {
  rows: readonly PluginRow[];
  statusOf: (row: PluginRow) => string;
  update: (row: PluginRow) => boolean;
  card: (row: PluginRow) => ReactNode;
  updateAll: { busy: boolean; onClick: () => void } | null;
}) {
  const inUse = rows.filter((row) => statusOf(row) !== "available" || update(row));
  const updates = inUse.filter(update);
  const rest = inUse.filter((row) => !update(row));
  if (inUse.length === 0) {
    return <p className="px-1 text-sm text-fg-muted">{S.plugins.installedEmpty}</p>;
  }
  const head = (title: string, count: number, action?: ReactNode) => (
    <div className="flex items-center justify-between gap-3 border-b border-line-muted pb-2">
      <h2 className="text-base font-semibold text-fg">
        {title}
        <span className="ml-2 font-normal text-fg-muted">{count}</span>
      </h2>
      {action}
    </div>
  );
  return (
    <div className="space-y-10">
      {updates.length > 0 && (
        <section aria-label={S.plugins.updatesSection}>
          {head(
            S.plugins.updatesSection,
            updates.length,
            updateAll !== null ? (
              <Button
                size="sm"
                variant="primary"
                loading={updateAll.busy}
                onClick={updateAll.onClick}
              >
                <GlyphIcon d={ICONS.rotateCw} size={ICON_SIZE.iconButton} />
                {S.plugins.updateAll}
              </Button>
            ) : undefined,
          )}
          <StoreGrid layout="row" one>
            {updates.map(card)}
          </StoreGrid>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label={S.plugins.installedSection}>
          {head(S.plugins.installedSection, rest.length)}
          <StoreGrid layout="row" one>
            {rest.map(card)}
          </StoreGrid>
        </section>
      )}
    </div>
  );
}

/** How many listed plugins cannot run on this version of the host. */
export function IncompatibleNotice({ unsatisfied }: { unsatisfied: number }) {
  return unsatisfied > 0 ? (
    <Notice tone="attention" className="mt-4">
      {S.plugins.unsatisfiedNotice(unsatisfied)}
    </Notice>
  ) : null;
}

/**
 * Each select's width beside the tabs, by language: wide enough for its longest option there
 * (a select's menu is as wide as the select), and no wider, since every pixel it takes is one
 * the tabs do not have.
 */
const CONTROL_WIDTH: Record<"zh" | "en", { groupBy: string; sort: string }> = {
  zh: { groupBy: "sm:w-28", sort: "sm:w-36" },
  en: { groupBy: "sm:w-40", sort: "sm:w-52" },
};

/**
 * The tab row's end: the grouping select, whose options each say what they do ("Group by
 * status") while its accessible name says what it groups, and beside it the sort select. Both on
 * the small rung, each wide enough for its longest option in the UI language; on a phone they
 * share their line, each taking half.
 */
export function PluginsListControls({
  groupBy,
  onGroupBy,
  sort,
  sorts,
  onSort,
  locale,
}: {
  groupBy: PluginGroupBy;
  onGroupBy: (by: PluginGroupBy) => void;
  sort: PluginSort;
  /** The sorts on offer ("popular" only while the market sends popularity figures). */
  sorts: readonly PluginSort[];
  onSort: (sort: PluginSort) => void;
  locale: "zh" | "en";
}) {
  const width = CONTROL_WIDTH[locale];
  return (
    <>
      <div className={`min-w-0 flex-1 sm:flex-none ${width.groupBy}`}>
        <Select
          size="sm"
          aria-label={S.plugins.groupByLabel}
          value={groupBy}
          onChange={(e) => onGroupBy(e.target.value as PluginGroupBy)}
        >
          {PLUGIN_GROUP_BYS.map((by) => (
            <option key={by} value={by}>
              {S.plugins.groupBy[by]}
            </option>
          ))}
        </Select>
      </div>
      <div className={`min-w-0 flex-1 sm:flex-none ${width.sort}`}>
        <Select
          size="sm"
          aria-label={S.plugins.sortLabel}
          value={sort}
          onChange={(e) => onSort(e.target.value as PluginSort)}
        >
          {sorts.map((key) => (
            <option key={key} value={key}>
              {S.plugins.sort[key]}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

/**
 * The administrator's notice beside the incompatible-plugins one, while members' requests to run a
 * plugin's server module wait on this server: how many, and the way to the Settings dialog's
 * module requests page, where they are decided. Nothing while none waits.
 */
export function ModuleRequestsNotice({
  waiting,
  onView,
}: {
  /** How many requests wait for a decision. */
  waiting: number;
  onView: () => void;
}) {
  if (waiting === 0) return null;
  return (
    <Notice
      tone="attention"
      className="mt-4"
      action={{ label: S.plugins.moduleRequestsView, onClick: onView }}
    >
      {S.plugins.moduleRequestsNotice(waiting)}
    </Notice>
  );
}

/**
 * Search the catalog, and open the Installed view. Administrators may also choose a machine,
 * import a plugin or open Settings.
 */
export function PluginsHeaderActions({
  query,
  onQuery,
  isAdmin,
  installed = null,
  machinePicker,
  onOpenSettings,
  onImport,
}: {
  query: string;
  onQuery: (query: string) => void;
  isAdmin: boolean;
  /** The button that opens the Installed view; null while it is on show. */
  installed?: React.ReactNode;
  /** The machine picker, when there is another machine to pick; null otherwise. */
  machinePicker: React.ReactNode;
  onOpenSettings: () => void;
  /** Opens the import dialog (shown to an admin only: installing is the server's). */
  onImport: () => void;
}) {
  return (
    <>
      <div className="min-w-0 basis-full sm:w-56 sm:basis-auto">
        <SearchInput
          size="sm"
          value={query}
          placeholder={S.plugins.searchPlaceholder}
          aria-label={S.plugins.searchPlaceholder}
          onChange={onQuery}
        />
      </div>
      {installed}
      {isAdmin && (
        <>
          {machinePicker}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={onImport}>
              <GlyphIcon d={ICONS.upload} />
              {S.plugins.importPlugin}
            </Button>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              <GlyphIcon d={ICONS.gear} />
              {S.plugins.openSettings}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

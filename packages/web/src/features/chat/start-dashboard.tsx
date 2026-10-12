/**
 * The start page (/chat/new) as a dashboard: the brand and four metric tiles above the composer,
 * three ruled sections under it. The draft view owns every piece of draft state — the Agent, the
 * Workspace, the composer — and hands this module the composer as a slot, a way to fill it, and
 * what it knows about the selected Agent; everything this page reads from the server for its own
 * sake is read here (use-start-dashboard.ts) and shaped without React (start-dashboard-data.ts).
 *
 * - **Header.** The logo, the product's name (the page's one h1, which the e2e suite finds the
 *   page by), the slogan and the version line, beside the tiles once the column is wide enough
 *   to hold both and above them when it is not. A tile counts one thing and opens the page that
 *   lists it: the self-evolution algorithms and the Benchmark reproductions this build ships
 *   (GET /api/rsi) — the plugin library holds the former (it offers no category link, so the tile
 *   opens the library itself), the Evaluation Center the latter — this Project's agents, and the
 *   evaluations its Benchmarks have recorded. A count that has not arrived reads "—".
 * - **Self-evolution algorithms.** One card per toolkit of the library's `rsi` category, in the
 *   Method select's order: its short name, its one-line blurb, a mark when the selected Agent has
 *   it, and Start, which fills the composer with the plugin's own quick start and sends nothing.
 *   Where the Agent lacks the toolkit the button installs it first, behind the Plugins page's
 *   confirmation; an Agent on another machine is not installed to from here.
 * - **Evaluation Center.** This Project's Benchmarks on this server, the most recently evaluated
 *   first, at most five, each with its latest score and who earned it; a row opens its page.
 * - **Examples and shortcuts.** The example folders and the user's own shortcuts, one folder open
 *   at a time (example-tasks.ts, shortcuts-folder.tsx).
 *
 * Nothing moves while it loads: the tiles hold "—", the toolkit cards are drawn from the Method
 * select's rows before the library answers, the Benchmark list stands in as five placeholder
 * rows, and the version line keeps its height. Nothing scrolls inside the page either — the
 * draft view's column is the one scroll container. Breakpoints are container queries on the
 * column rather than viewport ones: the sidebar and the dock take their width from it, so the
 * viewport cannot say how much room the dashboard has. The header and the sections are each
 * their own query container and the composer is neither, so the composer's panels never sit
 * inside a container's containment.
 *
 * Colours, lines, radii and type come from the tokens and the package's components, so the three
 * themes restyle the page through them: a `Card`'s frame is squared and unfilled in Console and
 * softened in Frost, the section titles are the theme's eyebrow, the h1 is its display title.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type {
  BenchmarkSummary,
  PluginItem,
  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_SIZE,
  ListRow,
  PenguinLogo,
  RuledSection,
  Skeleton,
  Sparkline,
  Text,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatMonthDay, formatRelativeShort, formatScore } from "../../lib/format";
import { NAV_ICONS } from "../../lib/nav-icons";
import { versionBadgeFor } from "../../lib/update-flow";
import { openAppInfo, useUpdateFlow } from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { RSI_METHODS } from "../benchmark/rsi-methods";
import type { RsiMethod } from "../benchmark/rsi-methods";
import { sparklineSeries } from "../benchmark/benchmark-metrics";
import { benchmarkRoute } from "../benchmark/benchmark-route";
import { SkillTile } from "../skills/skill-icon-view";
import { EXAMPLE_FOLDERS } from "./example-tasks";
import type { ExampleFolderId } from "./example-tasks";
import { ExampleFolderRow, exampleRowClass } from "./example-folder-row";
import { SHORTCUTS_FOLDER_ID, ShortcutsFolder } from "./shortcuts-folder";
import { localizedShortText, localizedText } from "./skill-use";
import {
  evaluationCount,
  isInstalled,
  latestEvaluation,
  orderToolkits,
  sortBenchmarks,
  toolkitDemo,
} from "./start-dashboard-data";
import type { ToolkitDemo } from "./start-dashboard-data";
import { useProjectBenchmarks, useRsiCatalog, useRsiToolkits } from "./use-start-dashboard";
import type { ProjectBenchmarks } from "./use-start-dashboard";

/** A prompt for the composer and the Skills it pins, sent by nothing until the user sends it. */
export interface StartFill {
  prompt: string;
  skills: readonly string[];
}

export interface StartDashboardProps {
  projectId: string;
  /** The composer and the pills under it: set between the header and the sections. */
  composer: ReactNode;
  /** The draft's Agent (null until it resolves), its display name, and the Skills it has. */
  agentId: string | null;
  agentName: string;
  agentSkills: readonly SkillMetadataItem[];
  /** Whether the Agent's Skills have been read: until then nothing knows what a fill would pin. */
  skillsLoaded: boolean;
  /** The machine the draft's Workspace is on; null is this server. */
  workspaceMachine: string | null;
  /** Put a prompt in the composer with the Skills it pins; nothing is sent. */
  fill: (prompt: string, skills: readonly string[]) => void;
  /** The composer's text at this moment: a new shortcut starts from it. */
  readComposerText: () => string;
  /**
   * A toolkit was installed on `agentId` from its card: the Agent's Skills as the install
   * answered them, and the demo to fill once the composer has those Skills to pin.
   */
  onToolkitInstalled: (
    agentId: string,
    skills: SkillMetadataItem[],
    demo: StartFill | null,
  ) => void;
}

export function StartDashboard({
  projectId,
  composer,
  agentId,
  agentName,
  agentSkills,
  skillsLoaded,
  workspaceMachine,
  fill,
  readComposerText,
  onToolkitInstalled,
}: StartDashboardProps) {
  const { locale } = useLocale();
  const { agents, agentsLoading } = useProject();
  const catalog = useRsiCatalog();
  const toolkits = useRsiToolkits();
  const benchmarks = useProjectBenchmarks(projectId);

  const metrics: Record<MetricKey, number | null> = {
    toolkits: catalog?.toolkits.length ?? null,
    reproductions: catalog?.benchmarks.length ?? null,
    agents: agentsLoading ? null : agents.length,
    evaluations: benchmarks.benchmarks === null ? null : evaluationCount(benchmarks.benchmarks),
  };

  const installed = useMemo(() => new Set(agentSkills.map((skill) => skill.name)), [agentSkills]);
  const entries = orderToolkits(toolkits, RSI_METHODS);

  /** The toolkit waiting for "install on this Agent, then start" to be confirmed. */
  const [pending, setPending] = useState<PluginItem | null>(null);
  const [installing, setInstalling] = useState(false);

  /** The demo as the composer takes it: the prompt in the UI language, read at click time. */
  const asFill = (demo: ToolkitDemo): StartFill => ({
    prompt: localizedText(locale, demo.prompt, demo.promptZh),
    skills: demo.skills,
  });

  const confirmInstall = async () => {
    const plugin = pending;
    const forAgent = agentId;
    if (plugin === null || forAgent === null) return;
    const demo = toolkitDemo(plugin, S.skills.quickInvokeText);
    setInstalling(true);
    try {
      const res = await api.installAgentPlugins(projectId, forAgent, [plugin.name]);
      toastSuccess(S.plugins.installedToast(plugin.name, agentName));
      onToolkitInstalled(forAgent, res.skills, demo === null ? null : asFill(demo));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setInstalling(false);
      setPending(null);
    }
  };

  return (
    <>
      <StartHeader metrics={metrics} />
      {composer}
      <div className="@container mt-10">
        {/* An empty `rsi` category (a library without the toolkits) leaves no section behind. */}
        {entries.length > 0 && (
          <RuledSection
            title={S.chat.start.toolkitsTitle}
            info={S.chat.start.toolkitsInfo}
            className="mt-8 first:mt-0"
          >
            <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
              {entries.map((entry, index) => {
                const { plugin } = entry;
                const demo = plugin === null ? null : toolkitDemo(plugin, S.skills.quickInvokeText);
                const status: ToolkitStatus =
                  plugin === null || demo === null || agentId === null || !skillsLoaded
                    ? "waiting"
                    : workspaceMachine !== null
                      ? "remote"
                      : isInstalled(plugin, installed)
                        ? "installed"
                        : "missing";
                return (
                  <ToolkitCard
                    key={entry.key}
                    method={entry.method}
                    plugin={plugin}
                    // An odd count leaves the narrow grids a hole in their last row; the first
                    // card (the default loop) takes two columns there instead.
                    featured={index === 0 && entries.length % 2 === 1}
                    status={status}
                    agentName={agentName}
                    onStart={() => {
                      if (plugin === null || demo === null) return;
                      if (status === "missing") setPending(plugin);
                      else {
                        const start = asFill(demo);
                        fill(start.prompt, start.skills);
                      }
                    }}
                  />
                );
              })}
            </ul>
          </RuledSection>
        )}
        <BenchmarksSection list={benchmarks} />
        <ExamplesSection ready={skillsLoaded} fill={fill} readComposerText={readComposerText} />
      </div>
      {/* A toolkit the selected Agent lacks: installing comes first, and is asked, as on the
          Plugins page. The dialog draws no title, so the question is its first line too. */}
      {pending !== null && (
        <ConfirmModal
          open
          title={S.plugins.quickStartInstallTitle(pending.name, agentName)}
          tone="primary"
          glyph={ICONS.download}
          confirmLabel={S.plugins.install}
          cancelLabel={S.common.cancel}
          busy={installing}
          onClose={() => setPending(null)}
          onConfirm={() => void confirmInstall()}
        >
          <p className="text-sm text-fg">
            {S.plugins.quickStartInstallTitle(pending.name, agentName)}
          </p>
          <p className="mt-1 text-sm text-fg-muted">{S.chat.start.toolkitAfterInstall}</p>
        </ConfirmModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Header: the brand and the metric tiles
// ---------------------------------------------------------------------------

type MetricKey = "toolkits" | "reproductions" | "agents" | "evaluations";

/** The tiles in order: what each counts, the glyph it wears, and the page that lists it. */
const METRICS: readonly { key: MetricKey; glyph: string; to: string }[] = [
  // The loop every self-evolution toolkit runs; the library holds the toolkits.
  { key: "toolkits", glyph: ICONS.refresh, to: "/plugins" },
  { key: "reproductions", glyph: NAV_ICONS.benchmark, to: "/benchmark" },
  { key: "agents", glyph: NAV_ICONS.agents, to: "/agents" },
  { key: "evaluations", glyph: ICONS.barChart, to: "/benchmark" },
];

/**
 * The brand beside the tiles in a full-width column, above them in a narrower one. Beside the
 * brand the four tiles go two by two: a row of four there leaves a tile too narrow for its label
 * in English. Above, they run four abreast where an English label still breaks between words
 * rather than inside one, and two by two below that.
 */
function StartHeader({ metrics }: { metrics: Record<MetricKey, number | null> }) {
  return (
    <div className="@container mb-6">
      <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-center @3xl:gap-6">
        <div className="flex min-w-0 items-center gap-3 @3xl:shrink-0">
          {/* Square asset with its own padding; a white tile in dark mode, like an app icon. */}
          <PenguinLogo src="/penguin-logo.svg" className="h-14 w-14 shrink-0 rounded-xl" />
          {/* Capped, so a long slogan wraps under the name instead of starving the tiles. */}
          <div className="min-w-0 max-w-72">
            <Heading level={1} display>
              {S.appName}
            </Heading>
            <Text className="mt-0.5 text-fg-muted">{S.chat.draftSubtitle}</Text>
            <VersionLine />
          </div>
        </div>
        <Card padding="none" className="min-w-0 @3xl:flex-1">
          {/* The hairlines between the tiles are the list's colour showing through the gaps. */}
          <ul className="grid grid-cols-2 gap-px bg-line @xl:grid-cols-4 @3xl:grid-cols-2">
            {METRICS.map(({ key, glyph, to }) => {
              const value = metrics[key];
              return (
                <li key={key} className="flex min-w-0">
                  <Link
                    to={to}
                    className="flex w-full min-w-0 flex-col bg-surface px-3 py-2 transition-colors duration-150 hover:bg-surface-muted focus-visible:-outline-offset-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
                      <span className="min-w-0">{S.chat.start.metrics[key]}</span>
                    </span>
                    <span className="mt-0.5 text-xl font-semibold leading-7 tabular-nums text-fg">
                      {value === null ? "—" : value}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/**
 * Superscript "new version" hint on the version line: plain small text raised via align-super,
 * in the line's own ink — deliberately not a pill, which read as a button. A button into the App
 * info dialog, the one the sidebar's App info row opens.
 */
const versionBadgeClass =
  "ml-1.5 inline-block align-super text-xs leading-4 text-fg-subtle hover:underline";

/**
 * `vX.Y.Z · Last updated Jul 26` under the slogan, with the update hint when something waits.
 * The date is the running build's release date (core's BUILD_DATE, no network); a dev build has
 * none and shows the version alone. The version is cached for the whole app, so this is usually
 * instant; until it is, a no-break space holds the line's height, so the brand never grows.
 */
function VersionLine() {
  const { locale } = useLocale();
  const { version } = useVersionInfo(true);
  if (version === null) {
    return (
      <p aria-hidden className="mt-1 text-xs">
        {"\u00a0"}
      </p>
    );
  }
  const date = version.buildDate;
  return (
    <p className="mt-1 text-xs text-fg-subtle">
      {`v${version.version}${
        date !== null ? ` · ${S.update.lastUpdated(formatMonthDay(date, locale))}` : ""
      }`}
      <VersionBadge />
    </p>
  );
}

/**
 * The version line's superscript, worded by where the update flow stands. Its tooltip and name
 * carry the App info row's own sentence, so the two surfaces say the same thing about a release.
 */
function VersionBadge() {
  const { mode, flow } = useUpdateFlow();
  const badge = versionBadgeFor(flow);
  if (mode === "none" || badge === null) return null;
  const text =
    badge === "available"
      ? S.update.newVersionBadge
      : badge === "downloading"
        ? S.update.badgeDownloading
        : S.update.badgeReady;
  const note =
    flow.kind === "available"
      ? S.update.newVersion(flow.version)
      : flow.kind === "downloading"
        ? S.update.rowDownloading(flow.version, flow.percent)
        : flow.kind === "ready"
          ? S.update.restartToUpdate(flow.version)
          : text;
  return (
    <button
      type="button"
      onClick={openAppInfo}
      data-tooltip={note}
      aria-label={note}
      className={versionBadgeClass}
    >
      {text}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Self-evolution algorithms
// ---------------------------------------------------------------------------

/**
 * Where a card's Start stands for the selected Agent: still waiting on the library or the Agent's
 * Skills, installed, missing (Start installs first), or unknown because the Agent is on another
 * machine — this server's Skill list does not describe it, so Start only fills.
 */
type ToolkitStatus = "waiting" | "installed" | "missing" | "remote";

function ToolkitCard({
  method,
  plugin,
  featured,
  status,
  agentName,
  onStart,
}: {
  /** The Method select's row for this toolkit; null for a plugin no row names yet. */
  method: RsiMethod | null;
  /** The library's entry; null until the library answers. */
  plugin: PluginItem | null;
  featured: boolean;
  status: ToolkitStatus;
  agentName: string;
  onStart: () => void;
}) {
  const { locale } = useLocale();
  const title = method !== null ? S.chat.start.toolkitTitle[method.id] : (plugin?.name ?? "");
  const blurb =
    method !== null
      ? S.benchmark.methods[method.id].blurb
      : plugin !== null
        ? localizedShortText(locale, plugin)
        : "";
  const installedLabel = S.chat.start.toolkitInstalled(agentName);
  const action =
    status === "missing" ? S.chat.start.toolkitInstallStart : S.chat.start.toolkitStart;
  return (
    <Card
      as="li"
      padding="sm"
      className={`flex min-w-0 flex-col ${featured ? "col-span-2 @3xl:col-span-1" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {plugin !== null ? (
          <SkillTile
            icon={plugin.icon}
            name={plugin.name}
            fallback={ICONS.puzzle}
            size={28}
            glyph={16}
          />
        ) : (
          <Skeleton className="h-[28px] w-[28px] shrink-0" />
        )}
        <Heading level={5} as="h3" className="min-w-0 flex-1 truncate">
          {title}
        </Heading>
        {status === "installed" && (
          <span
            role="img"
            aria-label={installedLabel}
            data-tooltip={installedLabel}
            className="shrink-0 text-tone-success-fg"
          >
            <GlyphIcon d={ICONS.checkCircle} size={ICON_SIZE.inlineGlyph} />
          </span>
        )}
      </div>
      {/* A fixed number of lines whatever the blurb's length, so the cards of a row keep one
          height — three in the narrow five-across row, where a paper's citation would otherwise
          be the part cut off; a clamped blurb is whole in its tooltip. */}
      <p
        className="mt-2 line-clamp-2 min-h-[2lh] text-xs text-fg-muted @3xl:line-clamp-3 @3xl:min-h-[3lh]"
        data-tooltip={blurb}
        data-tooltip-content="text"
      >
        {blurb}
      </p>
      <div className="mt-auto pt-3">
        {/* Five buttons share one word, so each one's name carries its toolkit's after it. */}
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${action} ${title}`}
          disabled={status === "waiting"}
          onClick={onStart}
        >
          {action}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Evaluation Center
// ---------------------------------------------------------------------------

/** How many Benchmarks the section lists; the section's link counts the rest. */
const BENCHMARK_ROWS = 5;

/** A link standing alone in a section's header or an empty state. */
const sectionLinkClass =
  "text-xs text-link underline-offset-2 transition-colors duration-150 hover:text-link-hover hover:underline";

/**
 * This Project's Benchmarks on this server. While the first list is on its way five placeholder
 * rows stand where the rows will be — a new Project is seeded with five; a list that cannot be
 * read leaves no section rather than an error the page cannot act on.
 */
function BenchmarksSection({ list }: { list: ProjectBenchmarks }) {
  const navigate = useNavigate();
  const { locale } = useLocale();
  if (list.failed) return null;
  const all = list.benchmarks;
  const rows = all === null ? null : sortBenchmarks(all).slice(0, BENCHMARK_ROWS);
  return (
    <RuledSection
      title={S.chat.start.benchmarksTitle}
      info={S.chat.start.benchmarksInfo}
      className="mt-8 first:mt-0"
      actions={
        all !== null && all.length > 0 ? (
          <Link to="/benchmark" className={sectionLinkClass}>
            {S.chat.start.benchmarksAll(all.length)}
          </Link>
        ) : undefined
      }
    >
      {rows !== null && rows.length === 0 ? (
        <EmptyState
          dashed
          title={S.chat.start.benchmarksEmpty}
          action={
            <Link to="/benchmark" className={sectionLinkClass}>
              {S.chat.start.benchmarksEmptyAction}
            </Link>
          }
        />
      ) : (
        <Card padding="none">
          <ul aria-busy={rows === null || undefined}>
            {rows === null
              ? Array.from({ length: BENCHMARK_ROWS }, (_, i) => (
                  <BenchmarkRowPlaceholder key={i} />
                ))
              : rows.map((benchmark) => (
                  <BenchmarkRow
                    key={benchmark.id}
                    benchmark={benchmark}
                    locale={locale}
                    onOpen={() => navigate(benchmarkRoute(benchmark.id))}
                  />
                ))}
          </ul>
        </Card>
      )}
    </RuledSection>
  );
}

/**
 * One Benchmark: its title over its size and its latest evaluation's label, the scoreboard's
 * trend, and the latest score with how long ago it landed. A Benchmark that is not published —
 * still being built, or failed — names that state where the score would be and opens nothing,
 * as its card in the Evaluation Center does.
 */
function BenchmarkRow({
  benchmark,
  locale,
  onOpen,
}: {
  benchmark: BenchmarkSummary;
  locale: "zh" | "en";
  onOpen: () => void;
}) {
  const latest = latestEvaluation(benchmark.evaluations);
  const series = sparklineSeries(benchmark.evaluations);
  const masked = benchmark.status !== "published";
  const failed = benchmark.status === "failed";
  const about = [
    S.benchmark.caseCount(benchmark.caseCount),
    S.benchmark.runsPerCase(benchmark.runs ?? 1),
    ...(latest !== null && latest.agentId !== null
      ? [S.chat.start.benchmarkLatestBy(latest.agentId, latest.version)]
      : []),
  ].join(" · ");
  return (
    <ListRow
      as="li"
      title={benchmark.title}
      description={about}
      {...(masked ? {} : { onClick: onOpen })}
      meta={
        series.length > 1 ? (
          // The trend needs the row's width; on a phone the score beside it says enough.
          <span className="hidden @md:block">
            <Sparkline
              values={series}
              label={S.benchmark.sparklineLabel(series.length)}
              scale="range"
              marker
            />
          </span>
        ) : undefined
      }
      trailing={
        masked ? (
          <Badge tone={failed ? "danger" : "neutral"} size="sm">
            {benchmark.manifestError !== undefined
              ? S.benchmark.manifestBroken
              : failed
                ? S.benchmark.creationFailed
                : S.benchmark.building}
          </Badge>
        ) : latest === null ? (
          <span className="whitespace-nowrap text-xs text-fg-subtle">
            {S.benchmark.notEvaluated}
          </span>
        ) : (
          <span className="block text-right">
            <span className="block text-sm font-semibold tabular-nums text-fg">
              {formatScore(latest.score)}
            </span>
            <span className="block whitespace-nowrap text-xs tabular-nums text-fg-subtle">
              {formatRelativeShort(latest.time, locale)}
            </span>
          </span>
        )
      }
    />
  );
}

/** A row's stand-in: the same two lines of text, so the list keeps its height when rows land. */
function BenchmarkRowPlaceholder() {
  return (
    <ListRow
      as="li"
      title={<Skeleton className="inline-block h-3 w-40 max-w-full align-middle" />}
      description={<Skeleton className="inline-block h-2.5 w-28 max-w-full align-middle" />}
      trailing={<Skeleton className="h-4 w-10" />}
    />
  );
}

// ---------------------------------------------------------------------------
// Examples and shortcuts
// ---------------------------------------------------------------------------

/**
 * One glyph per example folder. Icons live on the folder rather than on each example: with the
 * examples reduced to single-line titles, a column of per-row icons was noise competing with the
 * titles, while the folder row is what the eye scans to pick a category. apps: sparkles — an app
 * conjured from one sentence. webapps: a browser window. evolve: the two arcs chasing each other
 * round a circle, the loop of measuring, changing and measuring again. schedules: a clock face,
 * distinct from the hourglass that already means a Session is waiting.
 */
const FOLDER_GLYPHS: Record<ExampleFolderId, string> = {
  apps: ICONS.sparkles,
  webapps: ICONS.appWindow,
  evolve: ICONS.refresh,
  schedules: ICONS.clock,
};

/**
 * Canned one-sentence requests in bookmark-style folders, ALWAYS exactly one open — selecting
 * another closes the previous, and the open one cannot be collapsed — then the user's own saved
 * prompts. The block is therefore the folder rows plus one folder's rows, every folder within a
 * row of the others (shortcuts-folder.tsx caps the user's), so switching folders moves what sits
 * below by at most one row and no folder needs a scroll container. A click fills the composer and
 * sends nothing; each example is a single-line title, its one-sentence description in the row's
 * tooltip. Rows wait for the Agent's installed Skills — without them the fill would silently drop
 * the example's Skills (a saved shortcut pins none, so it never waits).
 */
function ExamplesSection({
  ready,
  fill,
  readComposerText,
}: {
  ready: boolean;
  fill: (prompt: string, skills: readonly string[]) => void;
  readComposerText: () => string;
}) {
  const [openFolder, setOpenFolder] = useState<ExampleFolderId | typeof SHORTCUTS_FOLDER_ID>(
    EXAMPLE_FOLDERS[0].id,
  );
  return (
    <RuledSection
      title={S.chat.start.examplesTitle}
      info={S.chat.exampleFillHint}
      className="mt-8 first:mt-0"
    >
      <div className="space-y-1">
        {EXAMPLE_FOLDERS.map((folder) => {
          const open = folder.id === openFolder;
          return (
            <div key={folder.id}>
              <ExampleFolderRow
                open={open}
                glyph={FOLDER_GLYPHS[folder.id]}
                label={S.chat.exampleFolders[folder.id]}
                count={folder.tasks.length}
                onOpen={() => setOpenFolder(folder.id)}
              />
              {open && (
                <ul className="mt-0.5 space-y-1 pl-4">
                  {folder.tasks.map((task) => {
                    const copy = S.chat.exampleTasks[task.id];
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          data-tooltip={`${copy.desc}\n${S.chat.exampleFillHint}`}
                          disabled={!ready}
                          // S is a live binding swapped on a locale change: the prompt is read
                          // at click time, not at render.
                          onClick={() => fill(S.chat.exampleTasks[task.id].prompt, task.skills)}
                          className={`flex w-full items-center gap-2 ${exampleRowClass}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{copy.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        <ShortcutsFolder
          open={openFolder === SHORTCUTS_FOLDER_ID}
          onOpen={() => setOpenFolder(SHORTCUTS_FOLDER_ID)}
          readComposerText={readComposerText}
          onFill={(prompt) => fill(prompt, [])}
        />
      </div>
    </RuledSection>
  );
}

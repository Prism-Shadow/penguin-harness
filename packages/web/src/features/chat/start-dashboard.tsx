/**
 * The start page (/chat/new) as a dashboard that fits one screen: the brand, three metric tiles,
 * the composer, and the examples block. The draft view owns every piece of draft state — the
 * Agent, the Workspace, the composer — and hands this module the composer as a slot, a way to
 * fill it, and what it knows about the selected Agent; everything this page reads from the
 * server for its own sake is read here (use-start-dashboard.ts) and shaped without React
 * (start-dashboard-data.ts).
 *
 * - **Brand.** The logo, the product's name (the page's one h1, which the e2e suite finds the
 *   page by), the slogan and the version line.
 * - **Tiles.** Three readings, one row, each the same shape so they read as a stats panel at a
 *   glance: the label and the big number on top — this Project's agents, the self-evolution
 *   toolkits of the library's `rsi` category, this Project's Benchmarks on this server — which
 *   open the page that lists them, and under a hairline the most recent item of each, in a
 *   quieter line. For the agents, the one whose Agent State changed last; for the toolkits, the
 *   one the user last picked or started here (remembered per browser), with Start — which fills
 *   the composer with the plugin's own quick start and sends nothing; where the Agent lacks the
 *   toolkit the button installs it first, behind the Plugins page's confirmation, and an Agent on
 *   another machine is not installed to from here — and a menu over its name to pick another;
 *   for the Benchmarks, the most recently evaluated one with its latest score, which opens its
 *   page. A count that has not arrived reads "—"; a recent line waits as a placeholder of the
 *   same height.
 * - **Examples and shortcuts.** The example folders and the user's own shortcuts, one folder
 *   open at a time (example-tasks.ts, shortcuts-folder.tsx): the folders down one column and the
 *   open folder's rows beside them, so switching folders moves nothing; stacked on a phone.
 *
 * Nothing moves while it loads and nothing scrolls inside the page — the draft view's column is
 * the one scroll container, and at a laptop viewport the page needs none. Breakpoints are
 * container queries on the column rather than viewport ones: the sidebar and the dock take their
 * width from it, so the viewport cannot say how much room the dashboard has. The tiles and the
 * examples block are each their own query container and the composer is neither, so the
 * composer's panels never sit inside a container's containment.
 *
 * Colours, lines, radii and type come from the tokens and the package's components, so the three
 * themes restyle the page through them: the tiles' `Card` is squared and unfilled in Console and
 * softened in Frost, the section title is the theme's eyebrow, the h1 is its display title.
 */
import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { AgentSummary, PluginItem, SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  Chevron,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Menu,
  MenuRadioItem,
  PenguinLogo,
  RuledSection,
  Skeleton,
  Text,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { PENGUIN_LOGO_URL } from "../../lib/brand-logo";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatMonthDay, formatRelativeShort, formatScore } from "../../lib/format";
import { NAV_ICONS } from "../../lib/nav-icons";
import { versionBadgeFor } from "../../lib/update-flow";
import { openAppInfo, useUpdateFlow } from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { RSI_METHODS } from "../benchmark/rsi-methods";
import type { RsiMethod } from "../benchmark/rsi-methods";
import { benchmarkRoute } from "../benchmark/benchmark-route";
import { SkillTile } from "../skills/skill-icon-view";
import { EXAMPLE_FOLDERS } from "./example-tasks";
import type { ExampleFolderId } from "./example-tasks";
import {
  ExampleFolderRow,
  exampleGridClass,
  examplePanelClass,
  exampleRowClass,
} from "./example-folder-row";
import { SHORTCUTS_FOLDER_ID, ShortcutsFolder } from "./shortcuts-folder";
import { localizedShortText, localizedText } from "./skill-use";
import {
  isInstalled,
  latestEvaluation,
  orderToolkits,
  recentAgent,
  recentToolkit,
  sortBenchmarks,
  toolkitDemo,
} from "./start-dashboard-data";
import type { ToolkitDemo, ToolkitEntry } from "./start-dashboard-data";
import { useProjectBenchmarks, useRsiToolkits } from "./use-start-dashboard";
import type { ProjectBenchmarks } from "./use-start-dashboard";

/** A prompt for the composer and the Skills it pins, sent by nothing until the user sends it. */
export interface StartFill {
  prompt: string;
  skills: readonly string[];
}

export interface StartDashboardProps {
  projectId: string;
  /** The composer and the pills under it: set between the tiles and the examples. */
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
   * A toolkit was installed on `agentId` from the toolkit tile: the Agent's Skills as the
   * install answered them, and the demo to fill once the composer has those Skills to pin.
   */
  onToolkitInstalled: (
    agentId: string,
    skills: SkillMetadataItem[],
    demo: StartFill | null,
  ) => void;
}

/**
 * Where the toolkit tile's Start stands for the selected Agent: still waiting on the library or
 * the Agent's Skills, installed, missing (Start installs first), or unknown because the Agent is
 * on another machine — this server's Skill list does not describe it, so Start only fills.
 */
type ToolkitStatus = "waiting" | "installed" | "missing" | "remote";

type Toolkit = ToolkitEntry<RsiMethod, PluginItem>;

/**
 * The toolkit the tile last offered, per browser. Storage may be absent or refuse (a private
 * window, a blocked origin): a read that fails is "nothing remembered", a write that fails is
 * forgotten, and the page is whole either way.
 */
const RECENT_TOOLKIT_KEY = "penguin.recentToolkit";

function readRecentToolkit(): string | null {
  try {
    return localStorage.getItem(RECENT_TOOLKIT_KEY);
  } catch {
    return null;
  }
}

function writeRecentToolkit(name: string): void {
  try {
    localStorage.setItem(RECENT_TOOLKIT_KEY, name);
  } catch {
    // Not remembered past this page: the tile keeps showing it meanwhile.
  }
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
  const toolkits = useRsiToolkits();
  const benchmarks = useProjectBenchmarks(projectId);

  const installed = useMemo(() => new Set(agentSkills.map((skill) => skill.name)), [agentSkills]);
  const entries = orderToolkits(toolkits, RSI_METHODS);
  const [remembered, setRemembered] = useState<string | null>(readRecentToolkit);
  const current = recentToolkit(entries, remembered);
  const pick = (name: string) => {
    setRemembered(name);
    writeRecentToolkit(name);
  };

  const plugin = current?.plugin ?? null;
  const demo = plugin === null ? null : toolkitDemo(plugin, S.skills.quickInvokeText);
  const status: ToolkitStatus =
    plugin === null || demo === null || agentId === null || !skillsLoaded
      ? "waiting"
      : workspaceMachine !== null
        ? "remote"
        : isInstalled(plugin, installed)
          ? "installed"
          : "missing";

  /** The toolkit waiting for "install on this Agent, then start" to be confirmed. */
  const [pending, setPending] = useState<PluginItem | null>(null);
  const [installing, setInstalling] = useState(false);

  /** The demo as the composer takes it: the prompt in the UI language, read at click time. */
  const asFill = (d: ToolkitDemo): StartFill => ({
    prompt: localizedText(locale, d.prompt, d.promptZh),
    skills: d.skills,
  });

  const start = () => {
    if (plugin === null || demo === null) return;
    pick(plugin.name);
    if (status === "missing") setPending(plugin);
    else {
      const s = asFill(demo);
      fill(s.prompt, s.skills);
    }
  };

  const confirmInstall = async () => {
    const target = pending;
    const forAgent = agentId;
    if (target === null || forAgent === null) return;
    const targetDemo = toolkitDemo(target, S.skills.quickInvokeText);
    setInstalling(true);
    try {
      const res = await api.installAgentPlugins(projectId, forAgent, [target.name]);
      toastSuccess(S.plugins.installedToast(target.name, agentName));
      onToolkitInstalled(forAgent, res.skills, targetDemo === null ? null : asFill(targetDemo));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setInstalling(false);
      setPending(null);
    }
  };

  return (
    <>
      <StartHeader />
      <div className="@container mb-5">
        <Card padding="none">
          {/* The hairlines between the tiles are the list's colour showing through the gaps. */}
          <ul className="grid grid-cols-1 gap-px bg-line @md:grid-cols-3">
            <MetricTile
              glyph={NAV_ICONS.agents}
              label={S.chat.start.metrics.agents}
              to="/agents"
              value={agentsLoading ? null : agents.length}
            >
              <AgentLine agents={agents} loading={agentsLoading} />
            </MetricTile>
            <MetricTile
              // The loop every self-evolution toolkit runs; the library holds the toolkits.
              glyph={ICONS.refresh}
              label={S.chat.start.metrics.toolkits}
              to="/plugins"
              value={toolkits?.length ?? null}
            >
              <ToolkitLine
                entries={entries}
                current={current}
                status={status}
                agentName={agentName}
                onPick={pick}
                onStart={start}
              />
            </MetricTile>
            <MetricTile
              glyph={NAV_ICONS.benchmark}
              label={S.chat.start.metrics.benchmarks}
              to="/benchmark"
              value={benchmarks.benchmarks?.length ?? null}
            >
              <BenchmarkLine list={benchmarks} />
            </MetricTile>
          </ul>
        </Card>
      </div>
      {composer}
      <div className="@container mt-6">
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
// Brand
// ---------------------------------------------------------------------------

/** The logo beside the name, the slogan and the version line: one strip above the tiles. */
function StartHeader() {
  return (
    <div className={`mb-4 flex items-center ${ICON_GAP.card}`}>
      {/* Square asset with its own padding; a white tile in dark mode, like an app icon. */}
      <PenguinLogo src={PENGUIN_LOGO_URL} className="h-12 w-12 shrink-0 rounded-xl" />
      <div className="min-w-0">
        <Heading level={1} display>
          {S.appName}
        </Heading>
        <Text className="mt-0.5 text-fg-muted">{S.chat.draftSubtitle}</Text>
        <VersionLine />
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
        {" "}
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
// The metric tiles
// ---------------------------------------------------------------------------

/**
 * One tile: the glyph, the label and the big number are one link to the page that lists what
 * the tile counts; the line under the hairline is the tile's most recent item, with its own
 * controls, so the tile is not one click — a whole-tile link would swallow them. The line is a
 * fixed height, taken by a placeholder while the item is on its way and by a dash where there
 * is nothing to show, so the three tiles keep one height whatever each knows.
 */
function MetricTile({
  glyph,
  label,
  to,
  value,
  children,
}: {
  glyph: string;
  label: string;
  to: string;
  /** The count; null while it has not arrived. */
  value: number | null;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col bg-surface">
      <Link
        to={to}
        className="flex min-w-0 flex-col px-3 pt-2.5 pb-1.5 transition-colors duration-150 hover:bg-surface-muted focus-visible:-outline-offset-2"
      >
        <span className={`flex min-w-0 items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
          <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
          <span className="min-w-0 truncate">{label}</span>
        </span>
        <span className="mt-0.5 text-2xl font-semibold leading-8 tabular-nums text-fg">
          {value === null ? "—" : value}
        </span>
      </Link>
      <div
        className={`flex h-9 min-w-0 items-center ${ICON_GAP.row} border-t border-line-muted px-3 text-xs`}
      >
        {children}
      </div>
    </li>
  );
}

/** A link standing alone on a tile's recent line, where there is nothing recent yet. */
const tileLinkClass =
  "truncate text-link underline-offset-2 transition-colors duration-150 hover:text-link-hover hover:underline";

/** The name on a recent line: the row's primary text, one line, whole in its tooltip when cut. */
function TileName({ children }: { children: string }) {
  return (
    <span
      className="min-w-0 flex-1 truncate text-sm font-medium text-fg"
      data-tooltip={children}
      data-tooltip-content="text"
    >
      {children}
    </span>
  );
}

/** The recent line's stand-in while its list is on its way. */
function TilePlaceholder() {
  return <Skeleton className="h-3 w-32 max-w-full" />;
}

/**
 * The agents tile's recent line: the agent whose Agent State changed last, its avatar and name
 * opening its page, its Agent State version and how long ago it changed at the end. A Project
 * without agents offers the Agents page instead.
 */
function AgentLine({ agents, loading }: { agents: readonly AgentSummary[]; loading: boolean }) {
  const navigate = useNavigate();
  const { locale } = useLocale();
  if (loading) return <TilePlaceholder />;
  const agent = recentAgent(agents);
  if (agent === null) {
    return (
      <Link to="/agents" className={tileLinkClass}>
        {S.chat.start.agentsEmptyAction}
      </Link>
    );
  }
  const name = agentDisplayName(agent);
  return (
    <>
      <button
        type="button"
        onClick={() => navigate(`/agents/${agent.agentId}`)}
        className={`flex min-w-0 flex-1 items-center ${ICON_GAP.row} text-left`}
      >
        <AgentAvatar id={agent.agentId} name={name} size={16} className="shrink-0 rounded" />
        <TileName>{name}</TileName>
      </button>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-fg-subtle">
        {`v${agent.version}${
          agent.updatedAt !== undefined ? ` · ${formatRelativeShort(agent.updatedAt, locale)}` : ""
        }`}
      </span>
    </>
  );
}

/**
 * The toolkit tile's recent line: the toolkit Start will start — its tile and name, the name a
 * menu over every toolkit of the category (picking one only changes what Start starts), the
 * mark when the selected Agent has it, and Start at the end, which reads Install and start
 * while the Agent lacks it. Before the library answers the tile is a placeholder and the name
 * comes from the Method select's row; a library without the category leaves a dash.
 */
function ToolkitLine({
  entries,
  current,
  status,
  agentName,
  onPick,
  onStart,
}: {
  entries: readonly Toolkit[];
  current: Toolkit | null;
  status: ToolkitStatus;
  agentName: string;
  onPick: (name: string) => void;
  onStart: () => void;
}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  if (current === null) return <span className="text-fg-subtle">—</span>;
  const title = toolkitTitle(current);
  const installedLabel = S.chat.start.toolkitInstalled(agentName);
  const action =
    status === "missing" ? S.chat.start.toolkitInstallStart : S.chat.start.toolkitStart;
  return (
    <>
      {current.plugin !== null ? (
        <SkillTile
          icon={current.plugin.icon}
          name={current.plugin.name}
          fallback={ICONS.puzzle}
          size={20}
          glyph={12}
        />
      ) : (
        <Skeleton className="h-5 w-5 shrink-0" />
      )}
      <Dropdown
        open={open}
        setOpen={setOpen}
        className="flex min-w-0"
        menuClass="w-72"
        // Portaled: the tiles' card clips its overflow, and the menu must hang below the tile.
        portal={{ direction: "down", align: "left" }}
        button={
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={`flex min-w-0 items-center ${ICON_GAP.tight} text-left text-sm font-medium text-fg transition-colors duration-150 hover:text-link`}
          >
            <span className="min-w-0 truncate" data-tooltip={title} data-tooltip-content="text">
              {title}
            </span>
            <Chevron
              open={open}
              size={ICON_SIZE.chevronDense}
              className="shrink-0 text-fg-subtle"
            />
          </button>
        }
      >
        <Menu label={S.chat.start.toolkitPick} density="sm">
          {entries.map((entry) => (
            <MenuRadioItem
              key={entry.key}
              label={toolkitTitle(entry)}
              description={toolkitBlurb(entry, locale)}
              checked={entry.key === current.key}
              onSelect={() => {
                onPick(entry.key);
                setOpen(false);
              }}
            />
          ))}
        </Menu>
      </Dropdown>
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
      <span className="flex-1" />
      {/* One word for every toolkit, so the button's name carries its toolkit's after it. */}
      <Button
        size="xs"
        variant="secondary"
        aria-label={`${action} ${title}`}
        disabled={status === "waiting"}
        onClick={onStart}
      >
        {action}
      </Button>
    </>
  );
}

/** A toolkit's short name: the Method select's, or the plugin's own for one no row names. */
function toolkitTitle(entry: Toolkit): string {
  if (entry.method !== null) return S.chat.start.toolkitTitle[entry.method.id];
  return entry.plugin?.name ?? "";
}

/** A toolkit's one-line blurb for the menu: the Method select's, or the plugin's own description. */
function toolkitBlurb(entry: Toolkit, locale: "zh" | "en"): string {
  if (entry.method !== null) return S.benchmark.methods[entry.method.id].blurb;
  return entry.plugin === null ? "" : localizedShortText(locale, entry.plugin);
}

/**
 * The Benchmarks tile's recent line: the Benchmark in front of the tile's order — the most
 * recently evaluated, else the first by title — its title opening its page, and at the end its
 * latest score with how long ago it landed, or "not evaluated". A Benchmark that is not
 * published (still being built, or failed) names that state where the score would be and opens
 * nothing, as its card in the Evaluation Center does. A Project without Benchmarks offers the
 * Evaluation Center; a list that cannot be read leaves a dash, the count being "—" already.
 */
function BenchmarkLine({ list }: { list: ProjectBenchmarks }) {
  const navigate = useNavigate();
  const { locale } = useLocale();
  if (list.failed) return <span className="text-fg-subtle">—</span>;
  if (list.benchmarks === null) return <TilePlaceholder />;
  const benchmark = sortBenchmarks(list.benchmarks)[0];
  if (benchmark === undefined) {
    return (
      <Link to="/benchmark" className={tileLinkClass}>
        {S.chat.start.benchmarksEmptyAction}
      </Link>
    );
  }
  const latest = latestEvaluation(benchmark.evaluations);
  const masked = benchmark.status !== "published";
  const failed = benchmark.status === "failed";
  return (
    <>
      {masked ? (
        <TileName>{benchmark.title}</TileName>
      ) : (
        <button
          type="button"
          onClick={() => navigate(benchmarkRoute(benchmark.id))}
          className="flex min-w-0 flex-1 items-center text-left"
        >
          <TileName>{benchmark.title}</TileName>
        </button>
      )}
      {masked ? (
        <Badge tone={failed ? "danger" : "neutral"} size="sm">
          {benchmark.manifestError !== undefined
            ? S.benchmark.manifestBroken
            : failed
              ? S.benchmark.creationFailed
              : S.benchmark.building}
        </Badge>
      ) : latest === null ? (
        <span className="shrink-0 whitespace-nowrap text-fg-subtle">
          {S.benchmark.notEvaluated}
        </span>
      ) : (
        <span className="shrink-0 whitespace-nowrap tabular-nums text-fg-subtle">
          <span className="text-sm font-semibold text-fg">{formatScore(latest.score)}</span>
          {` · ${formatRelativeShort(latest.time, locale)}`}
        </span>
      )}
    </>
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
 * prompts. The folders stand in one column and the open folder's rows beside them, so the
 * block's height is the folder rows' and switching folders moves nothing below; on a phone the
 * open folder's rows sit under its row, as an accordion. Every folder is within a row of the
 * others (shortcuts-folder.tsx caps the user's), so no folder's rows outgrow the folder column
 * and no folder needs a scroll container. A click fills the composer and sends nothing; each
 * example is a single-line title, its one-sentence description in the row's tooltip. Rows wait
 * for the Agent's installed Skills — without them the fill would silently drop the example's
 * Skills (a saved shortcut pins none, so it never waits).
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
    <RuledSection title={S.chat.start.examplesTitle} info={S.chat.exampleFillHint}>
      <div className={exampleGridClass}>
        {EXAMPLE_FOLDERS.map((folder) => {
          const open = folder.id === openFolder;
          return (
            <Fragment key={folder.id}>
              <ExampleFolderRow
                open={open}
                glyph={FOLDER_GLYPHS[folder.id]}
                label={S.chat.exampleFolders[folder.id]}
                count={folder.tasks.length}
                onOpen={() => setOpenFolder(folder.id)}
              />
              {open && (
                <ul className={`space-y-1 ${examplePanelClass}`}>
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
                          className={`flex w-full items-center ${ICON_GAP.menu} ${exampleRowClass}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{copy.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Fragment>
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

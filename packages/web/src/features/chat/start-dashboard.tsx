/**
 * The start page (/chat/new) as a dashboard that fits one screen: the brand with three counts
 * beside it, the composer, and the examples block. The draft view owns every piece of draft
 * state — the Agent, the Workspace, the composer — and hands this module the composer as a slot
 * and a way to fill it; the counts are read here (use-start-dashboard.ts).
 *
 * - **Brand and counts.** The logo, the product's name (the page's one h1, which the e2e suite
 *   finds the page by) with the version after it, and the slogan under them; at the far end of
 *   the same line, one small panel of three counts — this Project's agents, the self-evolution
 *   toolkits of the library's `rsi` category, this Project's Benchmarks on this server — each
 *   opening the page that lists them. A count that has not arrived reads "—". Where the column
 *   is too narrow for both (a phone), the panel sits under the brand.
 * - **Examples and shortcuts.** The example folders and the user's own shortcuts, one folder
 *   open at a time (example-tasks.ts, shortcuts-folder.tsx): the folders down one column and the
 *   open folder's rows beside them, so switching folders moves nothing; stacked on a phone. Every
 *   row is led by a glyph of its own and closed by a chevron at its right edge, so the rows read
 *   as things to press — each takes its prompt into the composer — rather than as a list of
 *   titles.
 *
 * Nothing moves while it loads and nothing scrolls inside the page — the draft view's column is
 * the one scroll container, and at a laptop viewport the page needs none. The examples block's
 * breakpoint is a container query on the column rather than a viewport one: the sidebar and the
 * dock take their width from it, so the viewport cannot say how much room the block has. The
 * block is its own query container and the composer is not, so the composer's panels never sit
 * inside a container's containment.
 *
 * Colours, lines, radii and type come from the tokens and the package's components, so the three
 * themes restyle the page through them: the counts' `Card` is squared and unfilled in Console and
 * softened in Frost, the section title is the theme's eyebrow, the h1 is its display title.
 */
import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Card,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  PenguinLogo,
  RuledSection,
  Text,
} from "@prismshadow/penguin-ui";
import { PENGUIN_LOGO_URL } from "../../lib/brand-logo";
import { S } from "../../lib/strings";
import { formatMonthDay } from "../../lib/format";
import { NAV_ICONS } from "../../lib/nav-icons";
import { versionBadgeFor } from "../../lib/update-flow";
import { openAppInfo, useUpdateFlow } from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { EXAMPLE_FOLDERS } from "./example-tasks";
import type { ExampleFolderId, ExampleTaskId } from "./example-tasks";
import {
  ExampleFolderRow,
  ExampleRowGlyph,
  ExampleRowGo,
  exampleGridClass,
  examplePanelClass,
  exampleRowClass,
} from "./example-folder-row";
import { SHORTCUTS_FOLDER_ID, ShortcutsFolder } from "./shortcuts-folder";
import { useProjectBenchmarks, useRsiToolkits } from "./use-start-dashboard";

export interface StartDashboardProps {
  projectId: string;
  /** The composer and the pills under it: set between the brand and the examples. */
  composer: ReactNode;
  /** Whether the Agent's Skills have been read: until then nothing knows what a fill would pin. */
  skillsLoaded: boolean;
  /** Put a prompt in the composer with the Skills it pins; nothing is sent. */
  fill: (prompt: string, skills: readonly string[]) => void;
  /** The composer's text at this moment: a new shortcut starts from it. */
  readComposerText: () => string;
}

export function StartDashboard({
  projectId,
  composer,
  skillsLoaded,
  fill,
  readComposerText,
}: StartDashboardProps) {
  const { agents, agentsLoading } = useProject();
  const toolkits = useRsiToolkits();
  const benchmarks = useProjectBenchmarks(projectId);

  return (
    <>
      {/* Its own query container: the brand and the counts share a line wherever the column
          holds both, the brand giving way (its slogan wraps) rather than the counts dropping. */}
      <div className="@container mb-6">
        <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-6">
          <StartBrand />
          <Card padding="none" className="shrink-0 self-start overflow-hidden @2xl:self-auto">
            {/* The hairlines between the counts are the list's own dividers. Three equal columns,
                each as wide as the widest count needs, so the panel reads as one even strip. */}
            <ul className="grid grid-cols-3 divide-x divide-line-muted">
              <StatCount
                glyph={NAV_ICONS.agents}
                label={S.chat.start.metrics.agents}
                to="/agents"
                value={agentsLoading ? null : agents.length}
              />
              <StatCount
                // The loop every self-evolution toolkit runs; the library holds the toolkits.
                glyph={ICONS.refresh}
                label={S.chat.start.metrics.toolkits}
                to="/plugins"
                value={toolkits?.length ?? null}
              />
              <StatCount
                glyph={NAV_ICONS.benchmark}
                label={S.chat.start.metrics.benchmarks}
                to="/benchmark"
                value={benchmarks.benchmarks?.length ?? null}
              />
            </ul>
          </Card>
        </div>
      </div>
      {composer}
      <div className="@container mt-6">
        <ExamplesSection ready={skillsLoaded} fill={fill} readComposerText={readComposerText} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/**
 * The logo beside two lines: the name with the version after it, then the slogan. The logo is
 * the two lines' height, so the three read as one mark; a slogan that has to wrap to make room
 * for the counts breaks into even lines.
 */
function StartBrand() {
  return (
    <div className={`flex min-w-0 items-center ${ICON_GAP.card}`}>
      {/* Square asset on a white tile of its own; the hairline keeps the tile's edge on a light
          page, where white meets white. Its corner is the asset's own (the drawing clips at 24% of
          the side), not the theme's radius scale, which would make it a circle in Frost and a
          square in Console: the mark keeps one shape everywhere. */}
      <PenguinLogo
        src={PENGUIN_LOGO_URL}
        className="h-14 w-14 shrink-0 rounded-[24%] ring-1 ring-line-muted"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Heading level={1} display>
            {S.appName}
          </Heading>
          <VersionTag />
        </div>
        <Text className="mt-1 text-balance text-fg-muted">{S.chat.draftSubtitle}</Text>
      </div>
    </div>
  );
}

/**
 * Superscript "new version" hint after the version: plain small text raised via align-super, in
 * the version's own ink — deliberately not a pill, which read as a button. A button into the App
 * info dialog, the one the sidebar's App info row opens.
 */
const versionBadgeClass =
  "ml-1.5 inline-block align-super text-xs leading-4 text-fg-subtle hover:underline";

/**
 * `vX.Y.Z · Last updated Jul 26` after the name, on its baseline, with the update hint when
 * something waits. The date is the running build's release date (core's BUILD_DATE, no network);
 * a dev build has none and shows the version alone. The version is cached for the whole app, so
 * this is usually instant; until it is, nothing stands there — it sits beside the name, so its
 * arrival moves no line.
 */
function VersionTag() {
  const { locale } = useLocale();
  const { version } = useVersionInfo(true);
  if (version === null) return null;
  const date = version.buildDate;
  return (
    <p className="text-xs tabular-nums text-fg-subtle">
      {`v${version.version}${
        date !== null ? ` · ${S.update.lastUpdated(formatMonthDay(date, locale))}` : ""
      }`}
      <VersionBadge />
    </p>
  );
}

/**
 * The version's superscript, worded by where the update flow stands. Its tooltip and name carry
 * the App info row's own sentence, so the two surfaces say the same thing about a release.
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
      data-tooltip-extra
      aria-label={note}
      className={versionBadgeClass}
    >
      {text}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

/**
 * One count: the glyph and the label over the number, all one link to the page that lists what
 * it counts. The label keeps to one line, so the three counts are one height whatever the
 * language.
 */
function StatCount({
  glyph,
  label,
  to,
  value,
}: {
  glyph: string;
  label: string;
  to: string;
  /** The count; null while it has not arrived. */
  value: number | null;
}) {
  return (
    <li className="min-w-0">
      <Link
        to={to}
        className="flex min-w-0 flex-col px-3 py-1.5 transition-colors duration-150 hover:bg-surface-muted focus-visible:-outline-offset-2"
      >
        <span
          className={`flex items-center ${ICON_GAP.row} whitespace-nowrap text-xs text-fg-muted`}
        >
          <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
          {label}
        </span>
        <span className="text-xl font-semibold leading-7 tabular-nums text-fg">
          {value === null ? "—" : value}
        </span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Examples and shortcuts
// ---------------------------------------------------------------------------

/**
 * One glyph per example folder: what the eye scans to pick a category. apps: sparkles — an app
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
 * One glyph per example, leading its row: what the example makes or does, so a row reads as a
 * thing to press and the rows of one folder tell apart at a glance. Drawn from the shared
 * registry, so a theme that redraws the set redraws these.
 */
const TASK_GLYPHS: Record<ExampleTaskId, string> = {
  ragDocsExpert: ICONS.bookOpen,
  investmentCopilot: ICONS.barChart,
  legalDesk: ICONS.file,
  game: ICONS.play,
  gamecenter: ICONS.tiles,
  lol: ICONS.sliders,
  rhythmRunner: ICONS.pulse,
  agentBenchmarkBuild: ICONS.trophy,
  agentOptimization: ICONS.targetArrow,
  benchmarkImport: ICONS.download,
  dailyPlan: ICONS.sunrise,
  githubDigest: ICONS.gitBranch,
  memoryReview: ICONS.brain,
};

/**
 * Canned one-sentence requests in bookmark-style folders, ALWAYS exactly one open — selecting
 * another closes the previous, and the open one cannot be collapsed — then the user's own saved
 * prompts. The folders stand in one column and the open folder's rows beside them, so the
 * block's height is the folder rows' and switching folders moves nothing below; on a phone the
 * open folder's rows sit under its row, as an accordion. Every folder is within a row of the
 * others (shortcuts-folder.tsx caps the user's), so no folder's rows outgrow the folder column
 * and no folder needs a scroll container. A click fills the composer and sends nothing; each
 * example is its glyph and a single-line title, its one-sentence description in the row's
 * tooltip. Rows wait
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
                          data-tooltip-extra
                          disabled={!ready}
                          // S is a live binding swapped on a locale change: the prompt is read
                          // at click time, not at render.
                          onClick={() => fill(S.chat.exampleTasks[task.id].prompt, task.skills)}
                          className={`flex w-full items-center ${ICON_GAP.menu} ${exampleRowClass}`}
                        >
                          <ExampleRowGlyph glyph={TASK_GLYPHS[task.id]} />
                          <span className="min-w-0 flex-1 truncate">{copy.label}</span>
                          <ExampleRowGo />
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

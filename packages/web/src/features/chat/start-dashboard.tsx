/** The new chat opens on the composer, with suggested and saved prompts immediately below it.
 * Project counts and release information remain available below the shortcuts. */
import { Fragment, useState } from "react";
import type { ReactNode } from "react";

import { Link } from "react-router";
import {
  Button,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  PenguinLogo,
  IconButton,
} from "@prismshadow/penguin-ui";
import { VersionStamp } from "../../components/account/version-stamp";
import { PENGUIN_LOGO_URL } from "../../lib/brand-logo";
import { S } from "../../lib/strings";
import { glyphOf } from "../../lib/nav-icons";

import { windowAddress } from "../../lib/app-window-address";
import { localizedText } from "../../lib/skill-use";
import { systemAppKey, useSystemApps } from "../../lib/system-apps";
import { versionBadgeFor } from "../../lib/update-flow";
import type { StartMetric } from "../../lib/start-metrics";
import { useStartMetrics } from "../../lib/web-app-pages";
import { openAppInfo, useUpdateFlow } from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { pickExamples, type ExampleTaskId } from "./example-tasks";
import { SavedPrompts } from "./saved-prompts";
import { useProjectBenchmarks, useRsiToolkits } from "./use-start-dashboard";

export interface StartDashboardProps {
  projectId: string;
  /** The composer and the pills under it: set between the brand and the examples. */
  composer: ReactNode;
  /** Whether the Agent's Skills have been read: until then nothing knows what a fill would pin. */
  skillsLoaded: boolean;
  /** Put a prompt in the composer with the Skills it pins; nothing is sent. */
  fill: (prompt: string, skills: readonly string[]) => void;
  /** Current accepted example text, cleared when the draft is edited. */
  exampleText?: string | null;
  /** The composer's text at this moment: a new shortcut starts from it. */
  readComposerText: () => string;
}

export function StartDashboard({
  projectId,
  composer,
  skillsLoaded,
  exampleText = null,
  fill,
  readComposerText,
}: StartDashboardProps) {
  const { agents, agentsLoading } = useProject();
  const toolkits = useRsiToolkits();
  const benchmarks = useProjectBenchmarks(projectId);
  const metrics = useStartMetrics();
  return (
    <div className="ui-start">
      <div
        data-slot="brand"
        className="mb-6 flex flex-wrap items-center justify-center gap-3 text-center"
      >
        <div data-slot="brand-mark" className="size-12 shrink-0">
          <PenguinLogo src={PENGUIN_LOGO_URL} className="h-full w-full rounded-[24%]" />
        </div>
        <Heading level={1} display data-slot="title" className="min-w-0">
          <AppName />
        </Heading>
      </div>
      {composer}
      <ExamplesSection
        ready={skillsLoaded}
        fill={fill}
        exampleText={exampleText}
        readComposerText={readComposerText}
      />
      <div data-slot="counts" className="mx-auto mt-6">
        <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <StatCount
            glyph={glyphOf("robot")}
            label={S.chat.start.metrics.agents}
            to="/agents"
            value={agentsLoading ? null : agents.length}
          />
          <StatCount
            // The loop every self-evolution toolkit runs; the library holds the toolkits.
            glyph={ICONS.refresh}
            label={S.chat.start.metrics.toolkits}
            to="/plugins"
            value={toolkits.value?.length ?? null}
          />
          <StatCount
            glyph={glyphOf("trophy")}
            label={S.chat.start.metrics.benchmarks}
            to="/benchmark"
            value={benchmarks.benchmarks?.length ?? null}
          />
          {metrics.length > 0 && <ContributedCounts metrics={metrics} />}
        </ul>
      </div>
      <VersionLine />
    </div>
  );
}

/**
 * The product's name with a break opportunity between its words ("Penguin" / "Harness"): one
 * word to a reader, but a display title too wide for a phone column at the largest text size
 * breaks there instead of pushing the page sideways.
 */
function AppName() {
  const words = S.appName.split(/(?=[A-Z])/);
  return words.map((word, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {word}
    </Fragment>
  ));
}

/**
 * Superscript "new version" hint after the version: plain small text raised via align-super, in
 * the version's own ink — deliberately not a pill, which read as a button. A button into the App
 * info dialog, the one the sidebar's App info row opens. Its label never wraps; it is set off by
 * an en space rather than a margin, so where it has to start the next line it starts at the
 * line's left edge (a space at the end of a line hangs, a margin would indent it).
 */
const versionBadgeClass =
  "inline-block whitespace-nowrap align-super text-xs leading-4 text-fg-subtle hover:underline";

/** Release information remains accessible below the prompt shortcuts. */
function VersionLine() {
  const { locale } = useLocale();
  const { version } = useVersionInfo(true);
  return (
    <p data-slot="version" className="mt-1 text-center text-xs tabular-nums text-fg-subtle">
      {version === null ? (
        "\u00a0"
      ) : (
        <>
          <VersionStamp version={version.version} buildDate={version.buildDate} locale={locale} />
          <VersionBadge />
        </>
      )}
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
    <>
      {"\u2002"}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

/** The counts server modules contribute, after the page's own, each opening the app it names. */
function ContributedCounts({ metrics }: { metrics: readonly StartMetric[] }) {
  const { locale } = useLocale();
  const systemApps = useSystemApps();
  /** Where a count leads: the system app it names, in its window when it opens in one. */
  const addressOf = (key: string | undefined): string | undefined => {
    const app = key === undefined ? undefined : systemApps.find((one) => one.key === key);
    if (app === undefined) return undefined;
    return app.frame !== undefined ? windowAddress(systemAppKey(app.key)) : app.path;
  };
  return (
    <>
      {metrics.map((metric) => (
        <StatCount
          key={metric.id}
          glyph={glyphOf(metric.icon)}
          label={localizedText(locale, metric.title, metric.titleZh)}
          to={addressOf(metric.app)}
          value={metric.value}
        />
      ))}
    </>
  );
}

/**
 * Each count links its icon, label and value to the page that lists the underlying items.
 */
function StatCount({
  glyph,
  label,
  to,
  value,
}: {
  glyph: string;
  label: string;
  /** The page it opens; absent: the count opens nothing. */
  to?: string | undefined;
  /** The count; null while it has not arrived. */
  value: number | null;
}) {
  const body = (
    <>
      <span className={`inline-flex items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
        <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} />
        {label}
      </span>
      <span data-slot="figure" className="text-xs font-semibold tabular-nums text-fg-muted">
        {value === null ? "—" : value}
      </span>
    </>
  );
  return (
    <li data-slot="count" data-clip-surface="" className="min-w-0">
      {to === undefined ? (
        <div className="inline-flex min-w-0 items-baseline gap-1 px-1 py-1">{body}</div>
      ) : (
        <Link
          to={to}
          className="inline-flex min-w-0 items-baseline gap-1 rounded-[inherit] px-1 py-1 transition-colors duration-150 hover:bg-control-hover focus-visible:-outline-offset-2"
        >
          {body}
        </Link>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Examples and shortcuts
// ---------------------------------------------------------------------------

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

function ExamplesSection({
  ready,
  exampleText,
  fill,
  readComposerText,
}: {
  ready: boolean;
  exampleText: string | null;
  fill: (prompt: string, skills: readonly string[]) => void;
  readComposerText: () => string;
}) {
  const [examples, setExamples] = useState(() => pickExamples());
  return (
    <div
      data-slot="examples"
      role="group"
      aria-label={S.chat.start.examplesTitle}
      className="mt-4 flex flex-wrap items-center justify-center gap-2"
    >
      {examples.map((task) => {
        const copy = S.chat.exampleTasks[task.id];
        const selected = copy.prompt === exampleText;
        return (
          <Button
            key={task.id}
            data-slot="suggestion"
            size="sm"
            aria-current={selected || undefined}
            disabled={!ready}
            title={copy.desc}
            leading={
              <GlyphIcon
                d={selected ? ICONS.check : TASK_GLYPHS[task.id]}
                size={ICON_SIZE.inlineGlyph}
              />
            }
            onClick={() => fill(copy.prompt, task.skills)}
            className="min-h-9 max-w-full"
          >
            <span className="min-w-0 truncate">{copy.label}</span>
          </Button>
        );
      })}
      <IconButton
        label={S.chat.start.shuffle}
        variant="ghost"
        onClick={() => setExamples((shown) => pickExamples(shown))}
      >
        <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.rowLead} />
      </IconButton>
      <SavedPrompts
        exampleText={exampleText}
        readComposerText={readComposerText}
        onFill={(prompt) => fill(prompt, [])}
      />
    </div>
  );
}

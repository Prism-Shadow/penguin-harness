import { Fragment, useState } from "react";
import type { ReactNode } from "react";

import { Heading, ICONS, PenguinLogo } from "@prismshadow/penguin-ui";
import { VersionStamp } from "../../components/account/version-stamp";
import { PENGUIN_LOGO_URL } from "../../lib/brand-logo";
import { S } from "../../lib/strings";

import { versionBadgeFor } from "../../lib/update-flow";
import { openAppInfo, useUpdateFlow } from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { useLocale } from "../../state/locale";
import { pickExamples, type ExampleTaskId } from "./example-tasks";
import { PromptActionRow, type PromptAction } from "./prompt-action-row";
import { SavedPrompts } from "./saved-prompts";

export interface StartDashboardProps {
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
  composer,
  skillsLoaded,
  exampleText = null,
  fill,
  readComposerText,
}: StartDashboardProps) {
  return (
    <div className="ui-start anim-fade flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 md:px-4">
      <div className="mx-auto my-auto w-full min-w-0 max-w-3xl shrink-0 py-4">
        <div data-slot="brand" className="mb-5 flex flex-col items-center gap-1 text-center">
          <div className="flex max-w-full items-center justify-center gap-3">
            <div data-slot="brand-mark" className="size-12 shrink-0">
              <PenguinLogo src={PENGUIN_LOGO_URL} className="h-full w-full rounded-[24%]" />
            </div>
            <Heading
              level={1}
              display
              data-slot="title"
              className="min-w-0 [overflow-wrap:anywhere]"
            >
              <AppName />
            </Heading>
          </div>
          <p className="text-sm text-fg-muted">{S.chat.start.tagline}</p>
        </div>
        {composer}
        <ExamplesSection
          ready={skillsLoaded}
          fill={fill}
          exampleText={exampleText}
          readComposerText={readComposerText}
        />
      </div>
      <StartVersionLine />
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

/** The release footer uses the same build date and update action as the account menu. */
function StartVersionLine() {
  const { locale } = useLocale();
  const { version } = useVersionInfo(true);
  return (
    <p
      data-slot="version"
      className="shrink-0 pb-1 pt-3 text-center text-xs tabular-nums text-fg-subtle"
    >
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
  const { locale } = useLocale();
  const [examples, setExamples] = useState(() => pickExamples());
  const actions: PromptAction[] = examples.map((task) => {
    const copy = S.chat.exampleTasks[task.id];
    const current = copy.prompt === exampleText;
    return {
      id: task.id,
      label: copy.label,
      hint: copy.desc,
      slot: "suggestion",
      current,
      disabled: !ready,
      glyph: current ? ICONS.check : TASK_GLYPHS[task.id],
      run: () => fill(copy.prompt, task.skills),
    };
  });
  const shuffle = {
    id: "shuffle",
    label: S.chat.start.shuffle,
    glyph: ICONS.refresh,
    run: () => setExamples((shown) => pickExamples(shown)),
  };
  return (
    <SavedPrompts
      locale={locale}
      exampleText={exampleText}
      readComposerText={readComposerText}
      onFill={(prompt) => fill(prompt, [])}
      renderActions={(saved, manage) => (
        <PromptActionRow prompts={[...saved, ...actions]} manage={manage} shuffle={shuffle} />
      )}
    />
  );
}

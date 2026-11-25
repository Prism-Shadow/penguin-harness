import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";

import {
  Dropdown,
  Heading,
  ICON_SIZE,
  ICONS,
  MenuItem,
  PenguinLogo,
  SearchInput,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { VersionStamp } from "../../components/account/version-stamp";
import { PENGUIN_LOGO_URL } from "../../lib/brand-logo";
import { SYSTEM_AGENT_ID } from "../../lib/builtin-agents";
import { S } from "../../lib/strings";

import { versionBadgeFor } from "../../lib/update-flow";
import { openAppInfo, useUpdateFlow } from "../../lib/use-update-flow";
import { useVersionInfo } from "../../lib/use-version-info";
import { WORKBENCH_UPDATED_EVENT, type WorkbenchUpdatedDetail } from "../../lib/workbench-tabs";
import { useSafeMode } from "../../rescue/safe-mode";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { SkillIcon } from "../skills";
import { EXAMPLE_TASKS, type ExampleTaskId } from "./example-tasks";
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
  /** Current Project id for listing existing apps in the "Optimize App" menu. */
  projectId?: string | null;
  /** Machine id of the draft's workspace, when targeting a remote machine. */
  machineId?: string | null;
}

export function StartDashboard({
  composer,
  skillsLoaded,
  exampleText = null,
  fill,
  readComposerText,
  projectId,
  machineId = null,
}: StartDashboardProps) {
  const { currentProject } = useProject();
  const activeProjectId = projectId ?? currentProject?.projectId ?? null;
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
          projectId={activeProjectId}
          machineId={machineId}
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
  buildApp: ICONS.appWindow,
  optimizeApp: ICONS.sparkles,
};

export function appShortcutTitle(
  app: Pick<AppCenterShortcut, "title" | "titleZh">,
  locale: string,
): string {
  return locale.startsWith("zh") ? (app.titleZh ?? app.title) : app.title;
}

export function filterAppShortcuts(
  apps: readonly AppCenterShortcut[],
  locale: string,
  query: string,
): AppCenterShortcut[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...apps];
  return apps.filter((app) => {
    const title = appShortcutTitle(app, locale).toLowerCase();
    return (
      title.includes(q) ||
      app.title.toLowerCase().includes(q) ||
      (app.titleZh?.toLowerCase().includes(q) ?? false) ||
      app.workbenchId.toLowerCase().includes(q) ||
      app.agentName.toLowerCase().includes(q) ||
      app.agentId.toLowerCase().includes(q)
    );
  });
}

function useProjectApps(projectId: string | null, machineId: string | null): AppCenterShortcut[] {
  const safe = useSafeMode();
  const [apps, setApps] = useState<AppCenterShortcut[]>([]);
  const asked = useRef(0);

  const read = useCallback(async () => {
    const mine = ++asked.current;
    if (safe || !projectId) {
      setApps([]);
      return;
    }
    try {
      const { shortcuts } = await api.getAppCenter(projectId, machineId);
      if (asked.current !== mine) return;
      setApps(shortcuts.filter((app) => app.agentId !== SYSTEM_AGENT_ID));
    } catch {
      if (asked.current === mine) setApps([]);
    }
  }, [safe, projectId, machineId]);

  useEffect(() => {
    void read();
    return () => {
      asked.current++;
    };
  }, [read]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (!d || (d.projectId === projectId && (d.machineId ?? null) === machineId)) {
        void read();
      }
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
  }, [projectId, machineId, read]);

  return apps;
}

function OptimizeAppPickList({
  apps,
  locale,
  exampleText,
  onPick,
}: {
  apps: readonly AppCenterShortcut[];
  locale: string;
  exampleText: string | null;
  onPick: (app: AppCenterShortcut) => void;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = filterAppShortcuts(apps, locale, query);
  const searchLabel = S.chat.start.appsSearchPlaceholder;
  const promptOf = (app: AppCenterShortcut) =>
    S.chat.exampleTasks.optimizeApp.promptFor(
      appShortcutTitle(app, locale),
      app.agentId,
      app.workbenchId,
    );
  return (
    <>
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <SearchInput
          variant="menu"
          autoFocus
          value={query}
          onChange={setQuery}
          placeholder={searchLabel}
          aria-label={searchLabel}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              const first = listRef.current?.querySelector<HTMLElement>("button");
              if (first) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        />
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto">
        {apps.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.chat.start.appsEmptyHint}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.chat.start.appsNoMatch}</p>
        ) : (
          filtered.map((app) => {
            const title = appShortcutTitle(app, locale);
            const on = exampleText !== null && promptOf(app) === exampleText;
            return (
              <MenuItem
                key={`${app.agentId}/${app.workbenchId}`}
                density="sm"
                aria-pressed={on}
                checked={on}
                onSelect={() => onPick(app)}
                glyph={
                  <SkillIcon
                    icon={app.icon}
                    fallback={ICONS.appWindow}
                    size={ICON_SIZE.inlineGlyph}
                    className="shrink-0 text-gray-400 dark:text-gray-500"
                  />
                }
                label={
                  <>
                    <span>{title}</span>{" "}
                    <span className="text-gray-400 dark:text-gray-500">
                      {app.agentName} / {app.workbenchId}
                    </span>
                  </>
                }
              />
            );
          })
        )}
      </div>
    </>
  );
}

function ExamplesSection({
  ready,
  exampleText,
  fill,
  readComposerText,
  projectId,
  machineId,
}: {
  ready: boolean;
  exampleText: string | null;
  fill: (prompt: string, skills: readonly string[]) => void;
  readComposerText: () => string;
  projectId: string | null;
  machineId: string | null;
}) {
  const { locale } = useLocale();
  const apps = useProjectApps(projectId, machineId);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const optimizePromptFor = (app: AppCenterShortcut) =>
    S.chat.exampleTasks.optimizeApp.promptFor(
      appShortcutTitle(app, locale),
      app.agentId,
      app.workbenchId,
    );

  const actions: PromptAction[] = EXAMPLE_TASKS.map((task) => {
    const copy = S.chat.exampleTasks[task.id];
    if (task.id === "optimizeApp") {
      const current =
        exampleText !== null &&
        (copy.prompt === exampleText || apps.some((app) => optimizePromptFor(app) === exampleText));
      return {
        id: task.id,
        label: copy.label,
        hint: copy.desc,
        slot: "suggestion",
        current,
        disabled: !ready,
        menu: true,
        expanded: appMenuOpen,
        glyph: current ? ICONS.check : TASK_GLYPHS[task.id],
        run: () => setAppMenuOpen((v) => !v),
        wrap: (button) => (
          <Dropdown
            button={button}
            open={appMenuOpen}
            setOpen={setAppMenuOpen}
            portal={{ direction: "down", align: "left" }}
            menuClass="w-[26rem]"
            className="min-w-0 max-w-full"
          >
            <OptimizeAppPickList
              apps={apps}
              locale={locale}
              exampleText={exampleText}
              onPick={(app) => {
                setAppMenuOpen(false);
                fill(optimizePromptFor(app), task.skills);
              }}
            />
          </Dropdown>
        ),
      };
    }
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

  return (
    <SavedPrompts
      locale={locale}
      exampleText={exampleText}
      readComposerText={readComposerText}
      onFill={(prompt) => fill(prompt, [])}
      renderActions={(saved, manage) => (
        <PromptActionRow prompts={[...actions, ...saved]} manage={manage} />
      )}
    />
  );
}

/**
 * The App Center (/apps): the Project's home screen. One tile per workbench of the Project's
 * Agents on this server whose manifest asks to be shown (`penguin.appCenter.show`); a tile opens
 * the workbench full page, and that page's exit comes back here. The server orders the tiles —
 * Agents in list order, titles within an Agent — and reads them from the files without loading
 * anything, so opening this page starts no build.
 *
 * The list is read again whenever a workbench of the Project loads or goes away (the user event
 * stream's `workbench_updated` / `workbench_removed`, forwarded as WORKBENCH_UPDATED_EVENT) and
 * whenever the Project's Agent list changes. A read that fails keeps the tiles already shown.
 * With nothing to show, the page says what a workbench is and offers to have one built; there is
 * no manual path, so the AI button stands alone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Button,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  NoticeStrip,
  PageFrame,
  PageHeader,
  Skeleton,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { APP_CENTER_PATH } from "../../lib/app-center-path";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { WORKBENCH_UPDATED_EVENT, type WorkbenchUpdatedDetail } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useMachines } from "../../state/machines";
import { useProject } from "../../state/project";
import { AiCreateButtons, AiCreateModal } from "../ai-create";
import type { AiExample } from "../ai-create";
import { localizedText } from "../../lib/skill-use";
import { skillTileColor } from "../skills";

/** The Skills a "Create with AI" conversation opens with: the visual language, then the workbench's own. */
const APP_SKILLS = ["web-design", "penguin-plugin"];

/** Edge of a tile's icon, in px: the phone home screen's size, large enough to read a glyph in. */
const ICON_PX = 56;

function aiExamples(): AiExample[] {
  return Object.entries(S.appCenter.aiCreateExamples).map(([key, ex]) => ({
    key,
    label: ex.label,
    description: ex.description,
    prompt: ex.prompt,
  }));
}

/** The workbench's own icon, else a tile in the id's colour with the title's first letter. */
function ShortcutIcon({ shortcut, title }: { shortcut: AppCenterShortcut; title: string }) {
  if (shortcut.iconUrl !== undefined) {
    return (
      <img
        src={shortcut.iconUrl}
        alt=""
        width={ICON_PX}
        height={ICON_PX}
        className="block rounded-xl object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: ICON_PX, height: ICON_PX }}
      className={`flex items-center justify-center rounded-xl text-2xl font-semibold ${skillTileColor(shortcut.workbenchId)}`}
    >
      {[...title][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function ShortcutTile({ shortcut, locale }: { shortcut: AppCenterShortcut; locale: "zh" | "en" }) {
  const title = localizedText(locale, shortcut.title, shortcut.titleZh);
  return (
    <li>
      <Link
        to={shortcut.path}
        state={{ returnTo: APP_CENTER_PATH }}
        {...(shortcut.broken ? { "data-tooltip": S.appCenter.broken } : {})}
        className={`flex flex-col items-center gap-2 rounded-lg p-3 text-center transition-colors duration-150 hover:bg-fg/5 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${shortcut.broken ? "opacity-60" : ""}`}
      >
        <span className="relative">
          <ShortcutIcon shortcut={shortcut} title={title} />
          <AgentAvatar
            id={shortcut.agentId}
            name={shortcut.agentName}
            size={20}
            className="absolute -right-1.5 -bottom-1.5 rounded ring-2 ring-canvas"
          />
          {shortcut.broken && (
            <span
              className={`absolute -top-1.5 -left-1.5 rounded-full bg-canvas ${toneInk.attention}`}
            >
              <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.rowLead} />
            </span>
          )}
        </span>
        <span className="w-full min-w-0 truncate text-sm text-fg">{title}</span>
        <span className="w-full min-w-0 truncate text-xs text-fg-muted">{shortcut.agentName}</span>
        {shortcut.broken && <span className="sr-only">{S.appCenter.broken}</span>}
      </Link>
    </li>
  );
}

/** Three tiles a row on a phone, as a home screen has; as many as fit from `sm` up. */
const GRID = "grid grid-cols-3 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]";

export function AppCenterPage() {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const { locale } = useLocale();
  /** Machines the Project's Agents can live on: this server is listed too, and is not one. */
  const machines = (useMachines().state?.machines ?? []).filter(
    (machine) => !machine.local && machine.installed !== null && machine.machineId !== null,
  );
  /** The newest answer, with the Project it is about: another Project's tiles are never shown. */
  const [loaded, setLoaded] = useState<{
    projectId: string;
    shortcuts: AppCenterShortcut[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  /** Reads so far: only the newest one's answer is applied. */
  const asked = useRef(0);
  /** The Agent list as a value: a new array with the same Agents does not read again. */
  const agentIds = agents.map((agent) => agent.agentId).join("\n");

  const load = useCallback(async () => {
    if (projectId === null) return;
    const ask = ++asked.current;
    try {
      const { shortcuts } = await api.getAppCenter(projectId);
      if (ask !== asked.current) return;
      setLoaded({ projectId, shortcuts });
      setError(null);
    } catch (err) {
      if (ask === asked.current) setError(apiErrorText(err));
    }
  }, [projectId]);

  // An Agent added or removed adds or removes its tiles.
  useEffect(() => {
    void load();
  }, [load, agentIds]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (detail.projectId === projectId) void load();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, changed);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, changed);
  }, [load, projectId]);

  const shortcuts = loaded !== null && loaded.projectId === projectId ? loaded.shortcuts : null;
  const create = <AiCreateButtons size="sm" onAi={() => setAiOpen(true)} />;

  return (
    <PageFrame width="lg">
      <PageHeader
        title={S.appCenter.title}
        description={S.appCenter.description}
        {...(shortcuts !== null && shortcuts.length > 0 ? { actions: create } : {})}
      />
      {error !== null && (
        <NoticeStrip tone="danger">
          {error}
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {S.workbenches.retryHistory}
          </Button>
        </NoticeStrip>
      )}
      {shortcuts === null ? (
        error === null && (
          <ul className={GRID} aria-busy aria-label={S.appCenter.loading}>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex flex-col items-center gap-2 p-3">
                <Skeleton className="size-14 rounded-xl" />
                <Skeleton className="h-3 w-16" />
              </li>
            ))}
          </ul>
        )
      ) : shortcuts.length === 0 ? (
        <EmptyState
          title={S.appCenter.emptyTitle}
          description={S.appCenter.empty}
          action={create}
        />
      ) : (
        <ul className={GRID} aria-label={S.appCenter.title}>
          {shortcuts.map((shortcut) => (
            <ShortcutTile
              key={`${shortcut.agentId}/${shortcut.workbenchId}`}
              shortcut={shortcut}
              locale={locale}
            />
          ))}
        </ul>
      )}
      {machines.length > 0 && (
        <p className="mt-6 text-xs text-fg-muted">{S.appCenter.machinesNote}</p>
      )}
      <AiCreateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={S.appCenter.aiCreateTitle}
        description={S.appCenter.aiCreateDescription}
        placeholder={S.appCenter.aiCreatePlaceholder}
        agents={agents}
        examples={aiExamples()}
        skills={APP_SKILLS}
        tail={S.appCenter.aiCreateTail}
      />
    </PageFrame>
  );
}

/**
 * The chat dock's scheduled-tasks panel: the tasks bound to the conversation on screen (an
 * agent's schedules filtered to this Session — new-Session tasks belong to the agent and live
 * on its settings tab), searchable and filtered by state, each row with its human schedule
 * line, an enable switch and an overflow menu (edit / delete); a suggestions list of everyday
 * schedules; and the two create buttons in the header — "Create with AI" composes the request
 * and prefills THIS conversation's composer with it (ScheduleAiModal), "Create manually" opens
 * the shared form pinned to this Session. This panel is the only place a task bound to a
 * conversation is created.
 *
 * The list is the shared store's (schedule-store.ts), narrowed to this Session, so the chat
 * toolbar's alarm-clock mark counts exactly what is listed here. This panel adds the one
 * refresh trigger the store cannot know about: a slow poll while the tab is actually on screen.
 *
 * Readable by any member; the switch, edit and delete are owner-only, like the settings tab,
 * while the AI path stays open to everyone — asking the agent is a message, not a write.
 */
import { useEffect, useState } from "react";
import type { ScheduleItem, SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { Badge } from "../../components/ui/badge";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Icon } from "../../components/ui/group-list";
import { INFO_ICON } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import {
  ELLIPSIS_ICON,
  PENCIL_ICON,
  TRASH_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { SkeletonList } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { CreateButtons } from "../ai-create";
import { describeSchedule } from "./schedule-describe";
import { ScheduleAiModal } from "./schedule-ai-modal";
import { ScheduleFormModal } from "./schedule-form-modal";
import {
  SCHEDULE_FILTERS,
  filterSchedules,
  scheduleGlyph,
  sessionSchedules,
} from "./schedule-panel-state";
import type { ScheduleFilter } from "./schedule-panel-state";
import { refreshSchedules, useAgentSchedules } from "./schedule-store";
import { ScheduleSuggestions } from "./schedule-suggestions";
import { toggleBody } from "./schedule-upsert";

/** How often the list refetches while on screen — about the server's own re-read cadence for the schedule directory. */
const REFRESH_MS = 30_000;

/** The state marks: a filled play for an armed task, pause bars, a check for the settled states. */
const PLAY_ICON = "M7 4l13 8-13 8z";
const PAUSE_ICON = "M8 4v16M16 4v16";
const CHECK_ICON = "M5 12l4 4L19 6";

/** The row's leading state glyph; an invalid file wears the info circle in the danger tone, its reason in the tooltip. */
function StateGlyph({ item }: { item: ScheduleItem }) {
  const glyph = scheduleGlyph(item.status);
  const name = S.schedule.statusNames[item.status] ?? item.status;
  const tone =
    glyph === "play" ? toneInk.success : glyph === "alert" ? toneInk.danger : toneInk.muted;
  const d =
    glyph === "play"
      ? PLAY_ICON
      : glyph === "pause"
        ? PAUSE_ICON
        : glyph === "check"
          ? CHECK_ICON
          : INFO_ICON;
  return (
    <span className={`shrink-0 ${tone}`} title={item.invalidReason ?? name}>
      <GlyphIcon d={d} size={ICON_SIZE.rowLead} filled={glyph === "play"} />
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** A row's overflow menu: edit, and delete in the destructive treatment (the session row menu's rows). */
function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const item = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-32"
      button={
        <button
          type="button"
          title={S.schedule.rowActions}
          aria-label={S.schedule.rowActions}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.rowLead} filled />
        </button>
      }
    >
      <button type="button" className={overflowMenuRowClass} onClick={item(onEdit)}>
        {overflowMenuGlyph(PENCIL_ICON)}
        {S.common.edit}
      </button>
      <button type="button" className={overflowMenuDangerClass} onClick={item(onDelete)}>
        {/* The glyph inherits the row's red. */}
        <span className="shrink-0">
          <Icon d={TRASH_ICON} size={13} />
        </span>
        {S.common.delete}
      </button>
    </Dropdown>
  );
}

export interface SchedulePanelProps {
  session: SessionInfo;
  /** Whether this tab is the one on screen (the dock keeps hidden tabs mounted): a hidden tab does not poll. */
  active: boolean;
  /** Writes the AI dialog's prompt into this conversation's composer (see ScheduleAiModal). */
  onPrefillComposer: (text: string) => void;
}

export function SchedulePanel({ session, active, onPrefillComposer }: SchedulePanelProps) {
  const { currentProject, agents, reloadAgents } = useProject();
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  // The shared store's list, narrowed to this conversation; only the first load's failure shows
  // in place, and row actions report via toast.
  const { items: agentItems, error } = useAgentSchedules(
    projectId,
    session.agentId,
    session.sessionId,
  );
  const items = agentItems === null ? null : sessionSchedules(agentItems, session.sessionId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [busy, setBusy] = useState(false);
  // Form dialog: non-null means open (editing a row, or null for a new task pinned to this Session).
  const [form, setForm] = useState<{ editing: ScheduleItem | null } | null>(null);
  // Name of the task pending deletion confirmation.
  const [deleting, setDeleting] = useState<string | null>(null);
  // AI dialog: non-null means open, seeded with a suggestion's prompt or nothing.
  const [ai, setAi] = useState<{ initial: string } | null>(null);

  // On coming to the front, and on a timer while it stays there. Focus and visibility are the
  // store's own business (it refreshes for the toolbar mark too); a hidden tab adds no poll.
  // Every refresh names this conversation's agent: the store holds a list per agent, and the
  // sidebar is reading another one whenever the current Agent has moved ahead of this panel.
  useEffect(() => {
    if (!active) return;
    void refreshSchedules(projectId, session.agentId);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSchedules(projectId, session.agentId);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, projectId, session.agentId]);

  /** After a create or delete: the list, and the agent card's schedule count. */
  const changed = () => {
    void refreshSchedules(projectId, session.agentId);
    void reloadAgents();
  };

  /** Toggle: whole-file-replace semantics — resend original fields, only flip enabled. */
  const toggle = async (item: ScheduleItem) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.updateSchedule(
        projectId,
        session.agentId,
        item.name,
        toggleBody(item, !item.enabled),
      );
      toastSuccess(item.enabled ? S.schedule.toastDisabled : S.schedule.toastEnabled);
      await refreshSchedules(projectId, session.agentId);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!projectId || deleting === null) return;
    setBusy(true);
    try {
      await api.deleteSchedule(projectId, session.agentId, deleting);
      if (form?.editing?.name === deleting) setForm(null);
      changed();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  const openAi = (initial: string) => setAi({ initial });
  const visible = items === null ? [] : filterSchedules(items, filter, query);
  const searching = query.trim() !== "";
  const filterLabels: Record<ScheduleFilter, string> = {
    all: S.schedule.filterAll,
    active: S.schedule.filterActive,
    paused: S.schedule.filterPaused,
    completed: S.schedule.filterCompleted,
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-3">
        {/* The two create paths, on a row of their own under the title rather than beside it.
            This panel lives in a dock whose width the user drags, and a title block that may
            shrink to nothing (min-w-0, which the subtitle needs) can never push a neighbour on
            to a second line — so a side-by-side header squeezes the buttons instead of wrapping
            them, and at the right dock's usual width they clip. A row of their own costs one
            line at every width and clips at none. */}
        <div className="space-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {S.schedule.panelTitle}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.schedule.panelSubtitle}
            </p>
          </div>
          {/* The AI half is open to every member — asking the agent for a task is a message,
              not a write — while the form writes files and stays with the owner. */}
          <CreateButtons
            size="sm"
            onAi={() => openAi("")}
            {...(isOwner ? { onManual: () => setForm({ editing: null }) } : {})}
          />
        </div>

        <Input
          size="sm"
          type="search"
          value={query}
          placeholder={S.schedule.panelSearchPlaceholder}
          aria-label={S.schedule.panelSearchPlaceholder}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented
          cols={4}
          options={SCHEDULE_FILTERS.map((value) => ({ value, label: filterLabels[value] }))}
          value={filter}
          onChange={setFilter}
        />

        {items === null ? (
          error !== null ? (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <SkeletonList rows={3} />
          )
        ) : items.length === 0 ? (
          <SettingsEmpty>{S.schedule.panelEmpty}</SettingsEmpty>
        ) : visible.length === 0 ? (
          <SettingsEmpty>{S.schedule.panelNoMatch}</SettingsEmpty>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((item) => {
              const line = describeSchedule(item, locale);
              return (
                <li
                  key={item.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <StateGlyph item={item} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="truncate text-sm text-gray-800 dark:text-gray-100"
                        // The name leads the tooltip, not just the prompt: a task name is a
                        // file name and truncates in a dock this narrow, and the panel would
                        // otherwise be the one surface that cannot show it in full.
                        title={`${item.name}\n${item.prompt}`}
                      >
                        {item.name}
                      </span>
                      {item.queued && <Badge tone="brand">{S.schedule.queued}</Badge>}
                    </div>
                    <div
                      className="truncate text-xs text-gray-500 dark:text-gray-400"
                      title={item.invalidReason ?? line}
                    >
                      {line}
                    </div>
                  </div>
                  {isOwner && (
                    <>
                      <Switch
                        checked={item.enabled}
                        disabled={busy}
                        aria-label={item.enabled ? S.schedule.disable : S.schedule.enable}
                        onChange={() => void toggle(item)}
                      />
                      <RowMenu
                        onEdit={() => setForm({ editing: item })}
                        onDelete={() => setDeleting(item.name)}
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!searching && <ScheduleSuggestions mode="session" onPick={openAi} />}
      </div>

      <ScheduleFormModal
        open={form !== null}
        agentId={session.agentId}
        editing={form?.editing ?? null}
        lockedSessionId={session.sessionId}
        onClose={() => setForm(null)}
        onSaved={changed}
      />

      <ScheduleAiModal
        open={ai !== null}
        initialValue={ai?.initial ?? ""}
        agents={agents}
        agentId={session.agentId}
        onPrefill={onPrefillComposer}
        onClose={() => setAi(null)}
      />

      <ConfirmModal
        open={deleting !== null}
        title={S.schedule.deleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.schedule.deleteConfirm(deleting) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}

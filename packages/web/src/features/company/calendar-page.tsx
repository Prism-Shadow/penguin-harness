/**
 * The organization calendar: month / week / day views over every employee's events
 * (geometry in calendar-geom.ts), events coloured per employee from the categorical
 * palette, an employee filter, and one dialog for creating and editing an event — the
 * scheduled-task dialog minus its target fields, with the employee as a select. Past
 * instances carry the outcome the scheduler recorded; every write confirms first.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { OrgCalendarItem, OrgChartResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { employeeColor } from "../../lib/category-colors";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { Button } from "../../components/ui/button";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { OrgPage, OrgPageSkeleton, useOrg } from "./org-layout";
import {
  dayFraction,
  dayKey,
  expandEvents,
  instancesByDay,
  monthGrid,
  monthKey,
  shiftAnchor,
  timeLabel,
  toLocalInput,
  viewRange,
  weekDays,
} from "./calendar-geom";
import type { CalendarView, EventInstance } from "./calendar-geom";

const PREV_ICON = "M15 18 9 12l6-6";
const NEXT_ICON = "m9 18 6-6-6-6";

const OUTCOME_TONE: Record<string, Tone> = {
  fired: "success",
  queued: "attention",
  paused: "muted",
  missed: "danger",
  error: "danger",
};

/** Hour rows of the day and week columns (px per hour): a day is 24 × this tall. */
const HOUR_PX = 44;

interface FormState {
  /** Editing an existing event (its file is fixed): agentId + name; null when creating. */
  editing: { agentId: string; name: string } | null;
  agentId: string;
  name: string;
  title: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  endAt: string;
  period: string;
}

export function CalendarPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.calendar}` : S.nav.org.calendar);
  const [events, setEvents] = useState<OrgCalendarItem[] | null>(null);
  const [invalidFiles, setInvalidFiles] = useState<
    Array<{ agentId: string; name: string; error: string }>
  >([]);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"name" | "prompt" | "startAt" | "agentId", string>>
  >({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [deleting, setDeleting] = useState<{ agentId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cal, ch] = await Promise.all([
        api.listOrgCalendar(projectId, orgId),
        api.getOrgChart(projectId, orgId),
      ]);
      setEvents(cal.events);
      setInvalidFiles(cal.invalidFiles);
      setChart(ch);
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  const { runs } = company.versions;
  useEffect(() => {
    void load();
  }, [load, runs]);

  const employees = chart?.employees ?? [];
  const names = new Map(employees.map((e) => [e.agentId, e.name]));
  /** Colour index by chart order, so an employee keeps its hue across days and views. */
  const colorOf = (agentId: string) => {
    const i = employees.findIndex((e) => e.agentId === agentId);
    return employeeColor(i === -1 ? employees.length : i);
  };

  const range = viewRange(anchor, view);
  const now = Date.now();
  const instances = useMemo(() => {
    const list = (events ?? []).filter(
      (e) => employeeFilter === "" || e.agentId === employeeFilter,
    );
    return expandEvents(list, range.startMs, range.endMs, now);
  }, [events, employeeFilter, range.startMs, range.endMs, now]);
  const byDay = useMemo(() => instancesByDay(instances), [instances]);

  const openCreate = (atMs?: number) => {
    setFieldErrors({});
    setForm({
      editing: null,
      agentId: employees[0]?.agentId ?? "",
      name: "",
      title: "",
      prompt: "",
      enabled: true,
      startAt: toLocalInput(new Date(atMs ?? Date.now()).toISOString()),
      endAt: "",
      period: "",
    });
  };
  const openEdit = (ev: OrgCalendarItem) => {
    setFieldErrors({});
    setForm({
      editing: { agentId: ev.agentId, name: ev.name },
      agentId: ev.agentId,
      name: ev.name,
      title: ev.title ?? "",
      prompt: ev.prompt,
      enabled: ev.enabled,
      startAt: toLocalInput(ev.startAt),
      endAt: toLocalInput(ev.endAt),
      period: ev.period ?? "",
    });
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f === null ? f : { ...f, ...patch }));

  const validate = (): boolean => {
    if (form === null) return false;
    const next: typeof fieldErrors = {};
    if (!form.agentId) next.agentId = S.common.requiredField;
    if (!form.name.trim()) next.name = S.common.requiredField;
    if (!form.prompt.trim()) next.prompt = S.common.requiredField;
    if (!form.startAt) next.startAt = S.common.requiredField;
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (form === null) return;
    setBusy(true);
    try {
      const body = {
        ...(form.title.trim() ? { title: form.title.trim() } : {}),
        prompt: form.prompt,
        enabled: form.enabled,
        startAt: new Date(form.startAt).toISOString(),
        ...(form.period.trim() ? { period: form.period.trim() } : {}),
        ...(form.endAt ? { endAt: new Date(form.endAt).toISOString() } : {}),
      };
      if (form.editing !== null) {
        await api.updateOrgCalendarEvent(
          projectId,
          orgId,
          form.editing.agentId,
          form.editing.name,
          body,
        );
      } else {
        await api.createOrgCalendarEvent(projectId, orgId, {
          ...body,
          agentId: form.agentId,
          name: form.name.trim(),
        });
      }
      toastSuccess(S.common.saved);
      setConfirmSave(false);
      setForm(null);
      void load();
    } catch (e) {
      setConfirmSave(false);
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (deleting === null) return;
    setBusy(true);
    try {
      await api.deleteOrgCalendarEvent(projectId, orgId, deleting.agentId, deleting.name);
      setDeleting(null);
      setForm(null);
      void load();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Open the desk session an instance's run went to (a past, fired instance). */
  const openDesk = async (agentId: string) => {
    try {
      const desk = await api.getOrgDesk(projectId, orgId, agentId);
      navigate(`/chat/${desk.sessionId}`);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const chip = (i: EventInstance, dense: boolean) => {
    const color = colorOf(i.event.agentId);
    const outcome = i.outcome;
    const label = i.event.title ?? i.event.name;
    const title = `${timeLabel(i.atMs)} · ${label} · ${names.get(i.event.agentId) ?? i.event.agentId}${
      outcome !== null
        ? ` · ${S.company.calendarOutcomes[outcome] ?? outcome}`
        : i.past
          ? ` · ${S.company.calendar.past}`
          : ""
    }${i.event.paused ? ` · ${S.company.calendar.pausedNote}` : ""}`;
    return (
      <button
        key={i.key}
        type="button"
        title={title}
        onClick={() => openEdit(i.event)}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1 text-left text-[11px] leading-5 transition-opacity ${color.chip} ${
          i.past ? "opacity-70" : ""
        } ${!i.event.enabled || i.event.paused ? "line-through decoration-1" : ""} ${dense ? "" : "py-0.5"}`}
      >
        <span className="shrink-0 font-mono tabular-nums">{timeLabel(i.atMs)}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {outcome !== null && (
          <span className={`shrink-0 ${toneInk[OUTCOME_TONE[outcome] ?? "muted"]}`}>
            {S.company.calendarOutcomes[outcome] ?? outcome}
          </span>
        )}
      </button>
    );
  };

  const heading =
    view === "month"
      ? monthKey(anchor)
      : view === "week"
        ? `${dayKey(range.startMs)} – ${dayKey(range.endMs - 1)}`
        : dayKey(anchor);
  const todayKey = dayKey(now);

  const toolbar = (
    <>
      <Segmented
        options={[
          { value: "month" as const, label: S.company.calendar.month },
          { value: "week" as const, label: S.company.calendar.week },
          { value: "day" as const, label: S.company.calendar.day },
        ]}
        value={view}
        onChange={setView}
        cols={3}
      />
      <Button
        variant="primary"
        size="sm"
        disabled={employees.length === 0}
        onClick={() => openCreate()}
      >
        {S.company.calendar.create}
      </Button>
    </>
  );

  if (error !== null && events === null) {
    return (
      <OrgPage title={S.nav.org.calendar} info={S.company.calendar.info}>
        <EmptyState
          title={error}
          action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
        />
      </OrgPage>
    );
  }
  if (events === null || chart === null) {
    return (
      <OrgPage title={S.nav.org.calendar} info={S.company.calendar.info}>
        <OrgPageSkeleton />
      </OrgPage>
    );
  }

  const dayColumn = (dayStartMs: number, key: string, showTimes: boolean) => {
    const list = byDay.get(key) ?? [];
    return (
      <div className="relative" style={{ height: HOUR_PX * 24 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-800"
            style={{ top: h * HOUR_PX }}
            onClick={() => openCreate(dayStartMs + h * 3_600_000)}
          >
            {showTimes && (
              <span className="absolute -top-2 left-1 text-[10px] text-gray-400 dark:text-gray-500">
                {`${h < 10 ? "0" : ""}${h}:00`}
              </span>
            )}
          </div>
        ))}
        {list.map((i) => (
          <div
            key={i.key}
            className="absolute inset-x-0.5"
            style={{ top: dayFraction(i.atMs) * HOUR_PX * 24 }}
          >
            {chip(i, true)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <OrgPage title={S.nav.org.calendar} info={S.company.calendar.info} actions={toolbar} wide>
      {/* Navigation row: previous / today / next, the heading, and the employee filter. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          title={S.company.calendar.prev}
          aria-label={S.company.calendar.prev}
          onClick={() => setAnchor((a) => shiftAnchor(a, view, -1))}
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <GlyphIcon d={PREV_ICON} size={ICON_SIZE.iconButton} />
        </button>
        <Button size="sm" onClick={() => setAnchor(Date.now())}>
          {S.company.calendar.today}
        </Button>
        <button
          type="button"
          title={S.company.calendar.next}
          aria-label={S.company.calendar.next}
          onClick={() => setAnchor((a) => shiftAnchor(a, view, 1))}
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <GlyphIcon d={NEXT_ICON} size={ICON_SIZE.iconButton} />
        </button>
        <span className="font-mono text-sm font-semibold tabular-nums">{heading}</span>
        <div className="ml-auto w-48">
          <Select
            size="sm"
            aria-label={S.company.calendar.filterEmployee}
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
          >
            <option value="">{S.company.calendar.allEmployees}</option>
            {employees.map((e) => (
              <option key={e.agentId} value={e.agentId}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Legend: one dot per employee in the chart's colour order. */}
      {employees.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          {employees.map((e) => (
            <span key={e.agentId} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${colorOf(e.agentId).dot}`} />
              {e.name}
            </span>
          ))}
        </div>
      )}

      {events.length === 0 && invalidFiles.length === 0 ? (
        <EmptyState
          title={S.company.calendar.empty}
          description={S.company.calendar.emptyHint}
          action={
            <Button
              variant="primary"
              disabled={employees.length === 0}
              onClick={() => openCreate()}
            >
              {S.company.calendar.create}
            </Button>
          }
        />
      ) : view === "month" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[48rem] rounded-md border border-gray-200 dark:border-gray-800">
            <div className="grid grid-cols-7 border-b border-gray-200 text-[11px] font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {S.company.calendar.weekdays.map((w) => (
                <div key={w} className="px-2 py-1">
                  {w}
                </div>
              ))}
            </div>
            {monthGrid(anchor).map((row, r) => (
              <div
                key={r}
                className="grid grid-cols-7 border-b border-gray-100 last:border-b-0 dark:border-gray-800"
              >
                {row.map((day) => {
                  const list = byDay.get(day.key) ?? [];
                  const shown = list.slice(0, 3);
                  return (
                    <div
                      key={day.key}
                      onClick={() => openCreate(day.dayStartMs + 9 * 3_600_000)}
                      className={`min-h-24 cursor-pointer border-r border-gray-100 p-1 last:border-r-0 dark:border-gray-800 ${
                        day.inMonth ? "" : "bg-gray-50/60 dark:bg-gray-900/40"
                      }`}
                    >
                      <p
                        className={`mb-0.5 text-[11px] tabular-nums ${
                          day.key === todayKey
                            ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-bg)] font-semibold text-[var(--accent-fg)]"
                            : day.inMonth
                              ? "text-gray-600 dark:text-gray-300"
                              : "text-gray-400 dark:text-gray-600"
                        }`}
                      >
                        {new Date(day.dayStartMs).getDate()}
                      </p>
                      <div className="space-y-0.5" onClick={(e) => e.stopPropagation()}>
                        {shown.map((i) => chip(i, true))}
                        {list.length > shown.length && (
                          <p className="px-1 text-[10px] text-gray-400">
                            {S.company.calendar.moreEvents(list.length - shown.length)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[56rem] rounded-md border border-gray-200 dark:border-gray-800">
            <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-gray-200 text-[11px] font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <div />
              {weekDays(anchor).map((day, i) => (
                <div
                  key={day.key}
                  className={`px-2 py-1 ${day.key === todayKey ? "font-semibold text-gray-900 dark:text-gray-100" : ""}`}
                >
                  {S.company.calendar.weekdays[i]} {new Date(day.dayStartMs).getDate()}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[3rem_repeat(7,1fr)]">
              <div className="relative" style={{ height: HOUR_PX * 24 }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <span
                    key={h}
                    className="absolute right-1 text-[10px] text-gray-400 dark:text-gray-500"
                    style={{ top: h * HOUR_PX - 6 }}
                  >
                    {`${h < 10 ? "0" : ""}${h}:00`}
                  </span>
                ))}
              </div>
              {weekDays(anchor).map((day) => (
                <div key={day.key} className="border-l border-gray-100 dark:border-gray-800">
                  {dayColumn(day.dayStartMs, day.key, false)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-gray-200 dark:border-gray-800">
          {dayColumn(range.startMs, dayKey(anchor), true)}
        </div>
      )}

      {invalidFiles.length > 0 && (
        <div className={`mt-4 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
          <p className="mb-1 font-medium">{S.company.calendar.invalidFiles}</p>
          <ul className="space-y-0.5 font-mono">
            {invalidFiles.map((f) => (
              <li key={`${f.agentId}/${f.name}`}>
                {f.agentId}/{f.name}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Create / edit dialog: the scheduled-task form minus its target, the employee as a select. */}
      <Modal
        open={form !== null}
        title={
          form?.editing !== null && form !== null
            ? S.company.calendar.editTitle(form.name)
            : S.company.calendar.createTitle
        }
        onClose={() => setForm(null)}
        widthClass="sm:max-w-lg"
        footer={
          <>
            {form?.editing != null && (
              <Button
                variant="danger"
                className="mr-auto"
                disabled={busy}
                onClick={() => setDeleting(form.editing)}
              >
                {S.company.calendar.delete}
              </Button>
            )}
            <Button onClick={() => setForm(null)} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (validate()) setConfirmSave(true);
              }}
            >
              {form?.editing != null ? S.common.save : S.common.create}
            </Button>
          </>
        }
      >
        {form !== null && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                size="sm"
                label={S.company.calendar.employee}
                required
                value={form.agentId}
                disabled={form.editing !== null}
                {...(fieldErrors.agentId !== undefined ? { error: fieldErrors.agentId } : {})}
                onChange={(e) => set({ agentId: e.target.value })}
              >
                {employees.map((e) => (
                  <option key={e.agentId} value={e.agentId}>
                    {e.name}
                  </option>
                ))}
              </Select>
              <Input
                size="sm"
                label={S.company.calendar.name}
                required
                hint={S.company.calendar.nameHint}
                {...(fieldErrors.name !== undefined ? { error: fieldErrors.name } : {})}
                value={form.name}
                disabled={form.editing !== null}
                onChange={(e) => set({ name: e.target.value })}
                className="font-mono"
                placeholder="daily_standup"
              />
              <Input
                size="sm"
                label={S.common.name}
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
              />
              <Input
                size="sm"
                label={S.company.calendar.period}
                value={form.period}
                hint={S.company.calendar.periodHint}
                onChange={(e) => set({ period: e.target.value })}
                className="font-mono"
                placeholder="1d"
              />
              <Input
                size="sm"
                label={S.company.calendar.startAt}
                required
                type="datetime-local"
                {...(fieldErrors.startAt !== undefined ? { error: fieldErrors.startAt } : {})}
                value={form.startAt}
                onChange={(e) => set({ startAt: e.target.value })}
                className="font-mono"
              />
              <Input
                size="sm"
                label={S.company.calendar.endAt}
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => set({ endAt: e.target.value })}
                className="font-mono"
              />
            </div>
            <Textarea
              label={S.company.calendar.prompt}
              required
              size="sm"
              rows={4}
              {...(fieldErrors.prompt !== undefined ? { error: fieldErrors.prompt } : {})}
              value={form.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              {S.company.calendar.enabled}
            </label>
            {form.editing !== null &&
              (() => {
                const ev = events.find(
                  (e) => e.agentId === form.editing?.agentId && e.name === form.editing?.name,
                );
                if (!ev) return null;
                return (
                  <div className="space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {ev.lastFiredAt !== undefined && (
                      <p>
                        {S.company.calendar.lastFired}: {formatDateTime(ev.lastFiredAt)}
                        {ev.lastOutcome !== undefined && (
                          <span
                            className={`ml-1 ${toneInk[OUTCOME_TONE[ev.lastOutcome] ?? "muted"]}`}
                          >
                            {S.company.calendarOutcomes[ev.lastOutcome] ?? ev.lastOutcome}
                          </span>
                        )}
                        {ev.lastOutcome === "fired" && (
                          <button
                            type="button"
                            className="ml-2 underline"
                            onClick={() => void openDesk(ev.agentId)}
                          >
                            {S.company.openDesk}
                          </button>
                        )}
                      </p>
                    )}
                    {ev.nextFireAt !== undefined && (
                      <p>
                        {S.company.calendar.nextFire}: {formatDateTime(ev.nextFireAt)}
                      </p>
                    )}
                    {ev.paused && (
                      <p className={toneInk.attention}>{S.company.calendar.pausedNote}</p>
                    )}
                    {ev.invalidReason !== undefined && (
                      <p className={toneInk.danger}>{ev.invalidReason}</p>
                    )}
                  </div>
                );
              })()}
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={confirmSave}
        title={S.common.confirmSaveTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmSave(false))}
        onConfirm={() => void save()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.calendar.saveConfirm(form?.name ?? "")}
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={deleting !== null}
        title={S.company.calendar.delete}
        confirmLabel={S.common.delete}
        busy={busy}
        onClose={() => (busy ? undefined : setDeleting(null))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.calendar.deleteConfirm(deleting?.name ?? "")}
        </p>
      </ConfirmModal>
    </OrgPage>
  );
}

/**
 * The organization calendar: month / week / day views over every employee's events
 * (geometry in calendar-geom.ts), events coloured per employee from the categorical
 * palette, a legend that names each employee's cadence and doubles as the employee filter,
 * and one dialog for creating and editing an event — the scheduled-task dialog minus its
 * target fields, with the employee as a select. The grid is always on screen: a skeleton of
 * it while the first fetch is out, the empty grid with a one-line hint when the organization
 * has no events yet, the grid plus an error strip when a refetch fails. Past instances carry
 * the outcome the scheduler recorded; every write confirms first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  OrgCalendarItem,
  OrgCalendarOutcome,
  OrgChartResponse,
} from "@prismshadow/penguin-server/api";
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
import { Switch } from "../../components/ui/switch";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Skeleton } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { OrgPage, useOrg } from "./org-layout";
import {
  cadenceOf,
  chipLanes,
  dayFraction,
  dayKey,
  expandEvents,
  instancesByDay,
  monthGrid,
  shiftAnchor,
  timeLabel,
  toLocalInput,
  viewRange,
  weekDays,
} from "./calendar-geom";
import type { Cadence, CalendarView, EventInstance, GridDay } from "./calendar-geom";

const PREV_ICON = "M15 18 9 12l6-6";
const NEXT_ICON = "m9 18 6-6-6-6";

const OUTCOME_TONE: Record<OrgCalendarOutcome, Tone> = {
  fired: "success",
  queued: "attention",
  paused: "muted",
  missed: "danger",
  error: "danger",
};

/** The mark a recorded outcome leaves on its instance: a check, an hourglass, a pause, a cross, an alert. */
const OUTCOME_ICON: Record<OrgCalendarOutcome, string> = {
  fired: "M5 13l4 4L19 7",
  queued: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  paused: "M9 5v14M15 5v14",
  missed: "M18 6 6 18M6 6l12 12",
  error: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v4m0 4h.01",
};

/** Hour rows of the day and week columns (px per hour): a day is 24 × this tall. */
const HOUR_PX = 44;
/** The footprint of a chip in those columns: half an hour, the smallest slot a line of text fits at this row height. */
const CHIP_SLOT_MS = 30 * 60_000;
/** The columns open scrolled to 06:00 and show sixteen hours; the night is reached by scrolling. */
const VISIBLE_FROM_HOUR = 6;
const VISIBLE_HOURS = 16;
/** Chips shown per month cell before the rest fold into a count. */
const MONTH_CELL_CHIPS = 3;

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

function cadenceLabel(c: Cadence): string {
  const t = S.company.calendar.cadence;
  switch (c.kind) {
    case "once":
      return t.once;
    case "minutes":
      return t.minutes(c.n);
    case "hours":
      return t.hours(c.n);
    case "days":
      return c.n === 1 ? t.daily(c.time) : t.days(c.n, c.time);
    case "weeks":
      return c.n === 1 ? t.weekly(c.time) : t.weeks(c.n, c.time);
    default:
      return t.invalid;
  }
}

const hourLabel = (h: number) => `${h < 10 ? "0" : ""}${h}:00`;

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
  const [now, setNow] = useState(() => Date.now());
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"name" | "prompt" | "startAt" | "agentId", string>>
  >({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [deleting, setDeleting] = useState<{ agentId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  // A fired slot arrives as an org_run event; a budget pause flips `paused` on every event of that employee.
  const { runs, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, runs, budget]);

  // The "now" the past marks and the time line read: a minute's precision is all they show.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loaded = events !== null;
  // The day and week columns open at the working hours (the hour label sits astride its
  // line, so the scroll stops a few pixels short of it); the night above is one scroll away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && view !== "month") el.scrollTop = VISIBLE_FROM_HOUR * HOUR_PX - 10;
  }, [view, loaded]);

  const employees = chart?.employees ?? [];
  const names = new Map(employees.map((e) => [e.agentId, e.name]));
  /** Colour index by chart order, so an employee keeps its hue across days and views. */
  const colorOf = (agentId: string) => {
    const i = employees.findIndex((e) => e.agentId === agentId);
    return employeeColor(i === -1 ? employees.length : i);
  };

  const range = viewRange(anchor, view);
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
      agentId: employeeFilter || (employees[0]?.agentId ?? ""),
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

  const todayKey = dayKey(now);

  /**
   * One event instance as a chip. Employee colour carries identity; the recorded outcome (on
   * the one instance it belongs to) rides at the end as a toned glyph; a past instance fades,
   * and a disabled or paused event is struck through so the chip says it will not fire.
   */
  const chip = (i: EventInstance, opts: { block?: boolean } = {}) => {
    const color = colorOf(i.event.agentId);
    const outcome = i.outcome;
    const label = i.event.title ?? i.event.name;
    const inert = !i.event.enabled || i.event.paused;
    const title = [
      `${timeLabel(i.atMs)} · ${label}`,
      names.get(i.event.agentId) ?? i.event.agentId,
      outcome !== null
        ? (S.company.calendarOutcomes[outcome] ?? outcome)
        : i.past
          ? S.company.calendar.past
          : null,
      !i.event.enabled ? S.company.calendar.disabledNote : null,
      i.event.paused ? S.company.calendar.pausedNote : null,
    ]
      .filter((p) => p !== null)
      .join(" · ");
    return (
      <button
        key={i.key}
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          openEdit(i.event);
        }}
        className={`flex min-w-0 items-center gap-1 rounded px-1 text-left text-[11px] leading-5 transition-opacity ${color.chip} ${
          opts.block ? "h-full w-full" : "w-full"
        } ${i.past && outcome === null ? "opacity-60" : ""} ${
          inert ? "line-through decoration-1 opacity-60" : ""
        }`}
      >
        <span className="shrink-0 font-mono tabular-nums">{timeLabel(i.atMs)}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {outcome !== null && (
          <span className={`inline-flex shrink-0 items-center ${toneInk[OUTCOME_TONE[outcome]]}`}>
            <GlyphIcon d={OUTCOME_ICON[outcome]} size={ICON_SIZE.inlineGlyph} />
            <span className="sr-only">{S.company.calendarOutcomes[outcome] ?? outcome}</span>
          </span>
        )}
      </button>
    );
  };

  const heading =
    view === "month"
      ? S.company.calendar.monthTitle(
          new Date(anchor).getFullYear(),
          new Date(anchor).getMonth() + 1,
        )
      : view === "week"
        ? `${dayKey(range.startMs)} – ${dayKey(range.endMs - 1)}`
        : `${dayKey(anchor)} ${S.company.calendar.weekdays[(new Date(anchor).getDay() + 6) % 7] ?? ""}`;

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

  const navButtonClass =
    "flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200";

  /** A month cell: the day number, up to three chips, the rest folded into a count; the cell itself creates at 09:00. */
  const monthCell = (day: GridDay) => {
    const list = byDay.get(day.key) ?? [];
    const shown = list.slice(0, MONTH_CELL_CHIPS);
    const isToday = day.key === todayKey;
    const createMs = day.dayStartMs + 9 * 3_600_000;
    return (
      <div
        key={day.key}
        title={S.company.calendar.createAt(`${day.key} 09:00`)}
        onClick={() => openCreate(createMs)}
        className={`min-h-24 cursor-pointer border-r border-gray-100 p-1 transition-colors duration-150 last:border-r-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900/60 ${
          day.inMonth ? "" : "bg-gray-50/60 text-gray-400 dark:bg-gray-900/40 dark:text-gray-600"
        }`}
      >
        <p className="mb-1 flex h-5 items-center">
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums ${
              isToday
                ? "bg-[var(--accent-bg)] font-semibold text-[var(--accent-fg)]"
                : day.inMonth
                  ? "text-gray-600 dark:text-gray-300"
                  : "text-gray-400 dark:text-gray-600"
            }`}
          >
            {new Date(day.dayStartMs).getDate()}
          </span>
        </p>
        <div className="space-y-0.5">
          {shown.map((i) => chip(i))}
          {list.length > shown.length && (
            <p className="px-1 text-[10px] text-gray-400 dark:text-gray-500">
              {S.company.calendar.moreEvents(list.length - shown.length)}
            </p>
          )}
        </div>
      </div>
    );
  };

  /** A day column of the week and day views: hour rows that create on click, chips placed by time and packed into lanes. */
  const timeColumn = (day: GridDay) => {
    const slots = chipLanes(byDay.get(day.key) ?? [], CHIP_SLOT_MS);
    const chipHeight = (CHIP_SLOT_MS / 3_600_000) * HOUR_PX - 2;
    const isToday = day.key === todayKey;
    return (
      <div
        key={day.key}
        className={`relative border-l border-gray-100 dark:border-gray-800 ${
          isToday ? "bg-[var(--accent-bg)]/[0.03]" : ""
        }`}
        style={{ height: HOUR_PX * 24 }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            title={S.company.calendar.createAt(`${day.key} ${hourLabel(h)}`)}
            className="absolute inset-x-0 cursor-pointer border-t border-gray-100 transition-colors duration-150 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900/60"
            style={{ top: h * HOUR_PX, height: HOUR_PX }}
            onClick={() => openCreate(day.dayStartMs + h * 3_600_000)}
          />
        ))}
        {isToday && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
            style={{ top: dayFraction(now) * HOUR_PX * 24 - 1 }}
          >
            <span className="-ml-1 h-2 w-2 rounded-full bg-[var(--accent-bg)]" />
            <span className="h-0.5 flex-1 bg-[var(--accent-bg)]" />
          </div>
        )}
        {slots.map(({ item, lane, lanes }) => (
          <div
            key={item.key}
            className="absolute"
            style={{
              top: dayFraction(item.atMs) * HOUR_PX * 24 + 1,
              height: chipHeight,
              left: `calc(${(lane / lanes) * 100}% + 2px)`,
              width: `calc(${100 / lanes}% - 4px)`,
            }}
          >
            {chip(item, { block: true })}
          </div>
        ))}
      </div>
    );
  };

  /** The week and day views share one frame: a day header, then the scrolling hour grid with its gutter. */
  const timeGrid = (days: GridDay[]) => {
    const cols = days.length === 1 ? "grid-cols-[3rem_1fr]" : "grid-cols-[3rem_repeat(7,1fr)]";
    return (
      <div className="overflow-x-auto">
        <div
          className={`${days.length === 1 ? "" : "min-w-[52rem]"} overflow-hidden rounded-md border border-gray-200 dark:border-gray-800`}
        >
          <div
            className={`grid ${cols} border-b border-gray-200 text-[11px] font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400`}
          >
            <div />
            {days.map((day) => {
              const d = new Date(day.dayStartMs);
              const isToday = day.key === todayKey;
              return (
                <div
                  key={day.key}
                  className={`flex items-center gap-1.5 border-l border-gray-100 px-2 py-1.5 dark:border-gray-800 ${
                    isToday ? "font-semibold text-gray-900 dark:text-gray-100" : ""
                  }`}
                >
                  {S.company.calendar.weekdays[(d.getDay() + 6) % 7]}
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 tabular-nums ${
                      isToday ? "bg-[var(--accent-bg)] text-[var(--accent-fg)]" : ""
                    }`}
                  >
                    {d.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          <div
            ref={scrollRef}
            className="overflow-y-auto"
            style={{ height: VISIBLE_HOURS * HOUR_PX }}
          >
            <div className={`grid ${cols}`}>
              <div className="relative" style={{ height: HOUR_PX * 24 }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <span
                    key={h}
                    className="absolute right-2 font-mono text-[10px] tabular-nums text-gray-400 dark:text-gray-500"
                    style={{ top: h * HOUR_PX - 6 }}
                  >
                    {h === 0 ? "" : hourLabel(h)}
                  </span>
                ))}
              </div>
              {days.map(timeColumn)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const grid =
    view === "month" ? (
      <div className="overflow-x-auto">
        <div className="min-w-[44rem] overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-7 border-b border-gray-200 text-[11px] font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {S.company.calendar.weekdays.map((w) => (
              <div key={w} className="px-2 py-1.5">
                {w}
              </div>
            ))}
          </div>
          {monthGrid(anchor).map((row, r) => (
            <div
              key={r}
              className="grid grid-cols-7 border-b border-gray-100 last:border-b-0 dark:border-gray-800"
            >
              {row.map(monthCell)}
            </div>
          ))}
        </div>
      </div>
    ) : view === "week" ? (
      timeGrid(weekDays(anchor))
    ) : (
      timeGrid([{ key: dayKey(anchor), dayStartMs: range.startMs, inMonth: true }])
    );

  const editingEvent =
    form?.editing != null
      ? (events ?? []).find(
          (e) => e.agentId === form.editing?.agentId && e.name === form.editing?.name,
        )
      : undefined;

  return (
    <OrgPage title={S.nav.org.calendar} info={S.company.calendar.info} actions={toolbar} wide>
      {/* Navigation row: previous / today / next, the heading, and the employee filter. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          title={S.company.calendar.prev}
          aria-label={S.company.calendar.prev}
          onClick={() => setAnchor((a) => shiftAnchor(a, view, -1))}
          className={navButtonClass}
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
          className={navButtonClass}
        >
          <GlyphIcon d={NEXT_ICON} size={ICON_SIZE.iconButton} />
        </button>
        <span className="text-sm font-semibold tabular-nums">{heading}</span>
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

      {/* Legend: one entry per employee in the chart's colour order, naming its cadence; a click filters to it. */}
      {employees.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-1 gap-y-1 text-[11px]">
          {employees.map((e) => {
            const own = (events ?? []).filter((ev) => ev.agentId === e.agentId);
            const cadences = own.map(
              (ev) => `${ev.title ?? ev.name} ${cadenceLabel(cadenceOf(ev))}`,
            );
            const shown = cadences.slice(0, 2);
            const rest = cadences.length - shown.length;
            const active = employeeFilter === e.agentId;
            return (
              <button
                key={e.agentId}
                type="button"
                title={
                  active ? S.company.calendar.allEmployees : S.company.calendar.legendFilter(e.name)
                }
                aria-pressed={active}
                onClick={() => setEmployeeFilter(active ? "" : e.agentId)}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  active ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${colorOf(e.agentId).dot}`} />
                <span className="font-medium text-gray-700 dark:text-gray-200">{e.name}</span>
                <span
                  className="truncate text-gray-500 dark:text-gray-400"
                  title={cadences.join(" · ")}
                >
                  {cadences.length === 0
                    ? S.company.calendar.legendEmpty
                    : `${shown.join(" · ")}${rest > 0 ? ` +${rest}` : ""}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error !== null && (
        <div
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}
        >
          <span>{S.company.calendar.loadFailed(error)}</span>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      )}

      {events !== null && events.length === 0 && invalidFiles.length === 0 && (
        <div
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${toneStrip.muted}`}
        >
          <span>{S.company.calendar.emptyHint}</span>
          <Button
            size="sm"
            variant="primary"
            disabled={employees.length === 0}
            onClick={() => openCreate()}
          >
            {S.company.calendar.create}
          </Button>
        </div>
      )}

      {events === null && error === null ? <CalendarSkeleton view={view} /> : grid}

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
          form?.editing != null
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
            {editingEvent !== undefined && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                {editingEvent.nextFireAt !== undefined && (
                  <span>
                    {S.company.calendar.nextFire}{" "}
                    <span className="font-mono tabular-nums">
                      {formatDateTime(editingEvent.nextFireAt)}
                    </span>
                  </span>
                )}
                {editingEvent.lastFiredAt !== undefined && (
                  <span className="inline-flex items-center gap-1">
                    {S.company.calendar.lastFired}{" "}
                    <span className="font-mono tabular-nums">
                      {formatDateTime(editingEvent.lastFiredAt)}
                    </span>
                    {editingEvent.lastOutcome !== undefined && (
                      <span className={toneInk[OUTCOME_TONE[editingEvent.lastOutcome]]}>
                        {S.company.calendarOutcomes[editingEvent.lastOutcome] ??
                          editingEvent.lastOutcome}
                      </span>
                    )}
                    {editingEvent.lastOutcome === "fired" && (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void openDesk(editingEvent.agentId)}
                      >
                        {S.company.openDesk}
                      </button>
                    )}
                  </span>
                )}
                {editingEvent.paused && (
                  <span className={toneInk.attention}>{S.company.calendar.pausedNote}</span>
                )}
                {editingEvent.invalidReason !== undefined && (
                  <span className={toneInk.danger}>{editingEvent.invalidReason}</span>
                )}
              </div>
            )}
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
                placeholder="daily_sweep"
              />
            </div>
            <Input
              size="sm"
              label={S.common.name}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
            <Textarea
              label={S.company.calendar.prompt}
              required
              size="sm"
              rows={4}
              hint={S.company.calendar.promptHint}
              {...(fieldErrors.prompt !== undefined ? { error: fieldErrors.prompt } : {})}
              value={form.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                label={S.company.calendar.period}
                value={form.period}
                hint={S.company.calendar.periodHint}
                onChange={(e) => set({ period: e.target.value })}
                className="font-mono"
                placeholder="1d"
              />
              <Input
                size="sm"
                label={S.company.calendar.endAt}
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => set({ endAt: e.target.value })}
                className="font-mono"
              />
              <label className="flex items-center gap-2 self-end pb-1.5 text-xs text-gray-600 dark:text-gray-300">
                <Switch checked={form.enabled} onChange={(v) => set({ enabled: v })} />
                {S.company.calendar.enabled}
              </label>
            </div>
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

/** The grid's shape while the first fetch is out: the same frame, cells of placeholder instead of days. */
function CalendarSkeleton({ view }: { view: CalendarView }) {
  if (view === "month") {
    return (
      <div className="overflow-x-auto">
        <div className="min-w-[44rem] overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="px-2 py-2">
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
          {Array.from({ length: 5 }, (_, r) => (
            <div
              key={r}
              className="grid grid-cols-7 border-b border-gray-100 last:border-b-0 dark:border-gray-800"
            >
              {Array.from({ length: 7 }, (_, c) => (
                <div
                  key={c}
                  className="min-h-24 space-y-1 border-r border-gray-100 p-1.5 last:border-r-0 dark:border-gray-800"
                >
                  <Skeleton className="h-3 w-4" />
                  {(r + c) % 3 === 0 && <Skeleton className="h-4 w-full" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
      <div className="flex gap-4 border-b border-gray-200 px-14 py-2 dark:border-gray-800">
        {Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => (
          <Skeleton key={i} className="h-3 w-12" />
        ))}
      </div>
      <div className="space-y-px p-2" style={{ height: VISIBLE_HOURS * HOUR_PX }}>
        {Array.from({ length: VISIBLE_HOURS }, (_, i) => (
          <div key={i} className="flex items-start gap-3" style={{ height: HOUR_PX }}>
            <Skeleton className="h-2.5 w-8" />
            {i % 4 === 1 && <Skeleton className="h-5 w-40" />}
          </div>
        ))}
      </div>
    </div>
  );
}

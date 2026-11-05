/**
 * The Agent export dialog, shared by the Agents page (a card's export icon) and the settings
 * page's Overview ("Export…"). The zip always carries the config (`system_config.yaml`,
 * `AGENTS.md`, `tools/`); the dialog picks the rest: Skills, Hooks, Memory, Workbenches (and,
 * under them, their data), Schedules — off by default, since an imported schedule starts running
 * on its new server — and which conversations, as none, the latest N, or those of a date range.
 *
 * Under the choices, one line says what that comes to, from the server's preview: files, size
 * and conversations, with a note when the selection is larger than an import takes and how many
 * conversations are left out for a file too large. It is asked again 300 ms after the last change,
 * and the previous answer stays (dimmed) until the new one arrives, so the line changes only
 * when its numbers do. Export saves `<agentId>-<yyyymmdd>.zip` through the fetch-then-save
 * helper (archive-download.ts), so a refused export is a toast rather than a saved error page.
 *
 * Instant controls under the settings commit model: nothing here is a draft, so closing loses
 * nothing and asks nothing; the dialog is mounted only while open, so every opening starts at the
 * defaults, and no choice is remembered.
 */
import { useEffect, useRef, useState } from "react";
import {
  AGENT_ARCHIVE_MAX_LAST_SESSIONS as MAX_TRACE_COUNT,
  AGENT_ARCHIVE_MAX_UPLOAD_BYTES,
} from "@prismshadow/penguin-server/api";
import type { AgentArchivePreview, TraceSelection } from "@prismshadow/penguin-server/api";
import { Button, Checkbox, FieldLegend, Input, Modal, Segmented } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes, localYmd } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { toastApiError } from "../../lib/toast-api-error";
import { downloadArchive } from "./archive-download";
import { DEFAULT_SWITCHES, DEFAULT_TRACE_COUNT, archivePartsQuery } from "./archive-parts";
import type { ArchiveSwitch } from "./archive-parts";

/** How long the preview waits after the last change before it is asked again. */
export const PREVIEW_DEBOUNCE_MS = 300;

/** How many days a date range spans when it is first chosen: the last 30, today included. */
const RANGE_DAYS = 30;

type TraceMode = TraceSelection["kind"];

export interface AgentExportDialogProps {
  open: boolean;
  projectId: string;
  agentId: string;
  /** The Agent's display name, for the title. */
  agentName: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
  onClose: () => void;
}

export function AgentExportDialog(props: AgentExportDialogProps) {
  return props.open ? <ExportForm {...props} /> : null;
}

const isLocalDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The Trace selection the controls stand for; null while they hold something the server would refuse. */
function selectionOf(
  mode: TraceMode,
  count: string,
  range: { from: string; to: string },
): TraceSelection | null {
  if (mode === "none") return { kind: "none" };
  if (mode === "last") {
    const n = Number(count);
    return /^\d+$/.test(count.trim()) && n >= 1 && n <= MAX_TRACE_COUNT
      ? { kind: "last", count: n }
      : null;
  }
  return isLocalDate(range.from) && isLocalDate(range.to) && range.from <= range.to
    ? { kind: "range", from: range.from, to: range.to }
    : null;
}

/** What the preview answered, for the query it was asked with; or why it could not answer. */
type PreviewState =
  { query: string; answer: AgentArchivePreview } | { query: string; error: string } | null;

function ExportForm({ projectId, agentId, agentName, machineId, onClose }: AgentExportDialogProps) {
  const [switches, setSwitches] = useState<Record<ArchiveSwitch, boolean>>({ ...DEFAULT_SWITCHES });
  const [mode, setMode] = useState<TraceMode>("none");
  const [count, setCount] = useState(String(DEFAULT_TRACE_COUNT));
  const [range, setRange] = useState({ from: "", to: "" });
  const [downloading, setDownloading] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);

  const selection = selectionOf(mode, count, range);
  const query = selection === null ? null : archivePartsQuery({ ...switches, traces: selection });
  /** The query as text: what the preview effect keys on, and what an answer is matched against. */
  const queryText = query === null ? null : new URLSearchParams(query).toString();

  // The opening preview goes out at once; every later one waits for the changes to stop.
  const asked = useRef(false);
  useEffect(() => {
    if (queryText === null) return;
    let cancelled = false;
    const delay = asked.current ? PREVIEW_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => {
      // Marked when it goes out, so an effect run that is cleaned up before (StrictMode's second
      // mount) leaves the opening preview immediate.
      asked.current = true;
      const parts = Object.fromEntries(new URLSearchParams(queryText));
      api.previewAgentArchive(projectId, agentId, parts, machineId).then(
        (answer) => {
          if (!cancelled) setPreview({ query: queryText, answer });
        },
        (e: unknown) => {
          if (!cancelled) setPreview({ query: queryText, error: apiErrorText(e) });
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, agentId, machineId, queryText]);

  const toggle = (key: ArchiveSwitch) => (on: boolean) => setSwitches((s) => ({ ...s, [key]: on }));

  /** A date range starts as the last 30 days, the first time it is chosen. */
  const chooseMode = (next: TraceMode) => {
    setMode(next);
    if (next === "range" && range.from === "" && range.to === "") {
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - (RANGE_DAYS - 1));
      setRange({ from: localYmd(start), to: localYmd(today) });
    }
  };

  const runExport = async () => {
    if (query === null || downloading) return;
    setDownloading(true);
    try {
      await downloadArchive(api.agentArchiveUrl(projectId, agentId, query, machineId), agentId);
      onClose();
    } catch (e) {
      toastApiError(e);
    } finally {
      setDownloading(false);
    }
  };

  const countValid = mode !== "last" || selection !== null;
  const rangeReversed =
    mode === "range" && isLocalDate(range.from) && isLocalDate(range.to) && range.from > range.to;

  return (
    <Modal
      open
      title={S.agent.exportTitle(agentName)}
      onClose={onClose}
      widthClass="sm:max-w-md"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={query === null || downloading}
            aria-busy={downloading}
            onClick={() => void runExport()}
          >
            {downloading ? S.agent.exporting : S.agent.exportAction}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <FieldLegend>{S.agent.exportInclude}</FieldLegend>
          {/* A labelled checkbox is an inline row: the column stacks them. */}
          <div className="flex flex-col items-start gap-2">
            <Checkbox
              size="sm"
              label={S.agent.tabSkills}
              checked={switches.skills}
              onChange={toggle("skills")}
            />
            <Checkbox
              size="sm"
              label={S.agent.tabHooks}
              checked={switches.hooks}
              onChange={toggle("hooks")}
            />
            <Checkbox
              size="sm"
              label={S.agent.tabMemory}
              checked={switches.memory}
              onChange={toggle("memory")}
            />
            <Checkbox
              size="sm"
              label={S.agent.tabWorkbenches}
              checked={switches.workbenches}
              onChange={toggle("workbenches")}
            />
            {/* Indented under its parent, and off with it: the data means nothing without the source. */}
            <div className="flex pl-6">
              <Checkbox
                size="sm"
                label={S.agent.exportWorkbenchData}
                checked={switches.workbenches && switches.workbenchData}
                disabled={!switches.workbenches}
                onChange={toggle("workbenchData")}
              />
            </div>
            <Checkbox
              size="sm"
              label={S.agent.tabSchedules}
              hint={S.agent.exportSchedulesHint}
              checked={switches.schedules}
              onChange={toggle("schedules")}
            />
          </div>
        </fieldset>

        <fieldset>
          <FieldLegend>{S.agent.exportTraces}</FieldLegend>
          <Segmented<TraceMode>
            options={[
              { value: "none", label: S.agent.exportTracesNone },
              { value: "last", label: S.agent.exportTracesLast },
              { value: "range", label: S.agent.exportTracesRange },
            ]}
            value={mode}
            onChange={chooseMode}
          />
          {mode === "last" && (
            <div className="mt-2 w-40">
              <Input
                size="sm"
                type="number"
                min={1}
                max={MAX_TRACE_COUNT}
                aria-label={S.agent.exportTracesCount}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                {...(countValid
                  ? { hint: S.agent.exportTracesCountHint(MAX_TRACE_COUNT) }
                  : { error: S.agent.exportTracesCountError(MAX_TRACE_COUNT) })}
              />
            </div>
          )}
          {mode === "range" && (
            <div className="mt-2">
              {/* A dash between the two inputs stands in for a "from/to" label, as on the usage page. */}
              <div className="flex items-center gap-1.5">
                <Input
                  size="sm"
                  type="date"
                  aria-label={S.agent.exportTracesFrom}
                  value={range.from}
                  invalid={rangeReversed}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                />
                <span className="shrink-0 text-fg-subtle" aria-hidden>
                  –
                </span>
                <Input
                  size="sm"
                  type="date"
                  aria-label={S.agent.exportTracesTo}
                  value={range.to}
                  invalid={rangeReversed}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                />
              </div>
              {rangeReversed && (
                <p role="alert" className={`mt-1 text-xs ${toneInk.danger}`}>
                  {S.agent.exportTracesRangeError}
                </p>
              )}
            </div>
          )}
        </fieldset>

        <PreviewLine preview={preview} current={queryText} withTraces={mode !== "none"} />
      </div>
    </Modal>
  );
}

/**
 * The preview's line: what the zip would hold, the note past the import limit, and how many
 * conversations are left out (the preview names them by id only, which tells a reader nothing).
 * An answer for an earlier choice stays, dimmed, until the current one arrives.
 */
function PreviewLine({
  preview,
  current,
  withTraces,
}: {
  preview: PreviewState;
  /** The query the controls stand for now; null while they hold something invalid. */
  current: string | null;
  withTraces: boolean;
}) {
  if (preview === null) {
    return <p className="text-xs text-fg-muted">{S.agent.exportEstimating}</p>;
  }
  const stale = preview.query !== current ? "opacity-60" : "";
  if ("error" in preview) {
    return <p className={`text-xs ${toneInk.danger} ${stale}`}>{preview.error}</p>;
  }
  const { answer } = preview;
  const files =
    Object.values(answer.parts).reduce((sum, part) => sum + part.files, 0) + answer.traces.files;
  const skipped = answer.traces.skipped;
  return (
    <div aria-live="polite" className={`space-y-1 text-xs ${stale}`}>
      <p className="text-fg-muted">
        {S.agent.exportSummary(
          files,
          formatBytes(answer.totalBytes),
          withTraces ? answer.traces.sessions : null,
        )}
      </p>
      {answer.totalBytes > AGENT_ARCHIVE_MAX_UPLOAD_BYTES && (
        <p className={toneInk.attention}>
          {S.agent.exportOverLimit(formatBytes(AGENT_ARCHIVE_MAX_UPLOAD_BYTES))}
        </p>
      )}
      {skipped.length > 0 && (
        <p className={toneInk.attention}>{S.agent.exportSkipped(skipped.length)}</p>
      )}
    </div>
  );
}

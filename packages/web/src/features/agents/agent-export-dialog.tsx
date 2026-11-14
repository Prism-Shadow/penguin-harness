/**
 * The export dialog of an Agent card and the settings Overview: the parts beside the config
 * (Schedules off, since an imported task runs) and the conversations. Instant controls, mounted
 * only while open, so every opening starts at the defaults; a refused download is a toast.
 */
import { useState } from "react";
import { Button, Checkbox, FieldLegend, Input, Modal, Segmented } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { downloadArchive } from "./archive-download";

/** The most Sessions "Latest N" may ask for, as the server caps it. */
const MAX_SESSIONS = 500;

const PARTS = ["skills", "hooks", "memory", "workbenches", "workbenchData", "schedules"] as const;
type Part = (typeof PARTS)[number];
type TraceMode = "none" | "last" | "range";

/** The `traces=` value the controls stand for; null while they hold one the server would refuse. */
function tracesQuery(mode: TraceMode, count: string, from: string, to: string): string | null {
  if (mode === "none") return "none";
  if (mode === "last") {
    const n = Number(count);
    return /^\d+$/.test(count) && n >= 1 && n <= MAX_SESSIONS ? `last:${n}` : null;
  }
  return from !== "" && to !== "" && from <= to ? `${from}..${to}` : null;
}

export interface AgentExportDialogProps {
  projectId: string;
  agentId: string;
  /** The Agent's display name, for the title. */
  agentName: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
  onClose: () => void;
}

export function AgentExportDialog(props: AgentExportDialogProps) {
  const { projectId, agentId, agentName, machineId, onClose } = props;
  const [parts, setParts] = useState(
    () => Object.fromEntries(PARTS.map((p) => [p, p !== "schedules"])) as Record<Part, boolean>,
  );
  const [mode, setMode] = useState<TraceMode>("none");
  const [count, setCount] = useState("20");
  const [range, setRange] = useState({ from: "", to: "" });
  const [busy, setBusy] = useState(false);
  const traces = tracesQuery(mode, count.trim(), range.from, range.to);
  // A workbench's data means nothing without its source: off with it.
  const on = (part: Part) => parts[part] && (part !== "workbenchData" || parts.workbenches);

  const runExport = async () => {
    if (traces === null) return;
    const query = { ...Object.fromEntries(PARTS.map((p) => [p, on(p) ? "1" : "0"])), traces };
    setBusy(true);
    try {
      await downloadArchive(api.agentArchiveUrl(projectId, agentId, query, machineId), agentId);
      onClose();
    } catch (e) {
      toastApiError(e);
      setBusy(false);
    }
  };

  const box = (part: Part, label: string, hint?: string) => (
    <Checkbox
      size="sm"
      label={label}
      checked={on(part)}
      disabled={part === "workbenchData" && !parts.workbenches}
      onChange={(checked) => setParts((p) => ({ ...p, [part]: checked }))}
      {...(hint ? { hint } : {})}
    />
  );

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
            disabled={traces === null || busy}
            onClick={() => void runExport()}
          >
            {busy ? S.agent.exporting : S.agent.exportAction}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset className="flex flex-col items-start gap-2">
          <FieldLegend>{S.agent.exportInclude}</FieldLegend>
          {box("skills", S.agent.exportSkills)}
          {box("hooks", S.agent.exportHooks)}
          {box("memory", S.agent.tabMemory)}
          {box("workbenches", S.agent.exportWorkbenches)}
          <div className="pl-6">{box("workbenchData", S.agent.exportWorkbenchData)}</div>
          {box("schedules", S.agent.tabSchedules, S.agent.exportSchedulesHint)}
        </fieldset>
        <fieldset className="space-y-2">
          <FieldLegend>{S.agent.exportTraces}</FieldLegend>
          <Segmented<TraceMode>
            options={[
              { value: "none", label: S.agent.exportTracesNone },
              { value: "last", label: S.agent.exportTracesLast },
              { value: "range", label: S.agent.exportTracesRange },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === "last" && (
            <div className="w-40">
              <Input
                size="sm"
                type="number"
                min={1}
                max={MAX_SESSIONS}
                aria-label={S.agent.exportTracesCount}
                value={count}
                invalid={traces === null}
                hint={`1–${MAX_SESSIONS}`}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
          )}
          {mode === "range" && (
            <div className="flex items-center gap-1.5">
              {(["from", "to"] as const).map((end) => (
                <Input
                  key={end}
                  size="sm"
                  type="date"
                  aria-label={end === "from" ? S.agent.exportTracesFrom : S.agent.exportTracesTo}
                  value={range[end]}
                  invalid={traces === null && range.from !== "" && range.to !== ""}
                  onChange={(e) => setRange((r) => ({ ...r, [end]: e.target.value }))}
                />
              ))}
            </div>
          )}
        </fieldset>
        <p className="text-xs text-fg-muted">{S.agent.exportVaultNote}</p>
      </div>
    </Modal>
  );
}

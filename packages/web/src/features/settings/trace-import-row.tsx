/**
 * Trace import (Settings → General): a `.jsonl` Trace exported from another install
 * becomes a conversation of the chosen Agent.
 *
 * Both halves of the destination are picked here, Project included. The endpoint is
 * per-Agent and a Trace file cannot name one: its `session_meta` carries an `agent_state`
 * path belonging to the machine that exported it. The Project is asked for rather than
 * inherited because this dialog does not show which one is current — every other row in it
 * belongs to the account or the server — and an import that silently landed in whichever
 * Project the sidebar happened to have selected would be a hard mistake to notice. It also
 * means a Trace can be imported into a Project other than the open one, as long as the viewer
 * owns it: importing is the owner's, so the picker lists owned Projects only, and a viewer who
 * owns none gets no row.
 *
 * The row sits beside the CLI-sessions filter because both decide what the conversation
 * list holds. Export is deliberately not here: a Trace is downloaded from the conversation
 * it belongs to, in the chat's Trace panel.
 */
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { AgentSummary, ProjectSummary } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { UploadIcon } from "../../components/ui/icons";
import { Select } from "../../components/ui/select";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { agentDisplayName, projectDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { PrefRow } from "./setting-row";

/** Client-side pre-check before reading the picked file (the same cap as the server's import route). */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

/**
 * The Projects the row offers, and the one it is on. The import route answers anyone but the
 * Project's owner with 403, so a Project the viewer is only a member of is left out rather than
 * offered for an import that can only fail. The pick stands while it is still one of them;
 * otherwise the open Project, when the viewer owns it, and then the first Project they own. With
 * none owned, `projects` is empty and `projectId` is "".
 */
export function traceImportTargets(
  projects: readonly ProjectSummary[],
  currentProjectId: string | null,
  picked: string,
): { projects: ProjectSummary[]; projectId: string } {
  const owned = projects.filter((p) => p.role === "owner");
  const isOwned = (id: string | null): id is string =>
    id !== null && owned.some((p) => p.projectId === id);
  const projectId = isOwned(picked)
    ? picked
    : isOwned(currentProjectId)
      ? currentProjectId
      : (owned[0]?.projectId ?? "");
  return { projects: owned, projectId };
}

export function TraceImportRow() {
  const { projects, currentProject } = useProject();
  const { reload } = useSessions();
  /** Explicit picks; "" means "not chosen yet", which resolves to the defaults below. */
  const [pickedProject, setPickedProject] = useState("");
  const [pickedAgent, setPickedAgent] = useState("");
  const [agents, setAgents] = useState<readonly AgentSummary[]>([]);
  const [importing, setImporting] = useState(false);

  /** Destination Project, derived like the Agent below: only owned Projects are offered at all. */
  const { projects: ownedProjects, projectId } = traceImportTargets(
    projects,
    currentProject?.projectId ?? null,
    pickedProject,
  );
  /**
   * Destination Agent, derived rather than stored: a pick that the selected Project has no
   * Agent for falls back on its own, so switching Project cannot leave a stale id behind.
   */
  const agentId = agents.some((a) => a.agentId === pickedAgent)
    ? pickedAgent
    : ((agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId ?? "");

  // The Agent list of whichever Project is selected — the Project context only holds the
  // open Project's, and this row can target any of them.
  useEffect(() => {
    if (projectId === "") return;
    let cancelled = false;
    void api
      .listAgents(projectId)
      .then((res) => {
        if (!cancelled) setAgents(res.agents);
      })
      .catch(() => {
        // Unreachable list: the row disables itself rather than offering an empty picker.
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const busy = importing || agentId === "";

  const runImport = async (dataBase64: string) => {
    if (projectId === "" || agentId === "") return;
    setImporting(true);
    try {
      await api.importAgentTrace(projectId, agentId, { dataBase64 });
      const project = ownedProjects.find((p) => p.projectId === projectId);
      const target = `${project ? projectDisplayName(project) : projectId} · ${
        agents.find((a) => a.agentId === agentId)?.name ?? agentId
      }`;
      // Only the open Project's conversation list is on screen behind the dialog; refresh it
      // so the imported Session is there, and let the toast name the destination either way.
      if (projectId === currentProject?.projectId) await reload();
      toastSuccess(S.settings.importTraceDone(target));
    } catch (e: unknown) {
      // Transient action failure → toast (the app's one notification rule).
      toastError(apiErrorText(e));
    } finally {
      setImporting(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset before reading so re-picking the same file fires change again.
    e.target.value = "";
    if (!file || agentId === "") return;
    if (file.size > MAX_TRACE_BYTES) {
      toastError(S.settings.importTraceTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      void runImport(url.slice(url.indexOf(",") + 1)); // strip the data:...;base64, prefix
    };
    reader.onerror = () => toastError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  // Nowhere the viewer may import into: no row, rather than pickers for an import that the
  // server would refuse.
  if (ownedProjects.length === 0) return null;

  return (
    <PrefRow label={S.settings.importTrace} info={S.settings.importTraceInfo}>
      {/* Each picker is boxed to a fixed width — a Select fills its container, and three
          full-width controls would stack one per line. Long names truncate in the trigger.
          The row still wraps at phone width, where three controls do not fit side by side. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="w-32">
          <Select
            size="sm"
            value={projectId}
            disabled={importing}
            onChange={(e) => {
              setPickedProject(e.target.value);
              // The new Project decides the Agent; `agentId` falls back until a pick lands in it.
              setPickedAgent("");
            }}
            aria-label={S.settings.importTraceProject}
          >
            {ownedProjects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {projectDisplayName(p)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32">
          <Select
            size="sm"
            value={agentId}
            disabled={busy}
            onChange={(e) => setPickedAgent(e.target.value)}
            aria-label={S.settings.importTraceAgent}
          >
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {agentDisplayName(a)}
              </option>
            ))}
          </Select>
        </div>
        {/* The file pick doubles as the confirm action (button styling on a label, so the
            native picker opens without a detour). It sits in a row with the two Selects above,
            so it carries their sm metrics rather than Button's md ones. */}
        <label
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium transition-colors duration-150 dark:border-gray-700 ${
            busy
              ? "pointer-events-none opacity-60"
              : "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <HiddenFileInput accept=".jsonl" disabled={busy} onChange={onPickFile} />
          <UploadIcon size={14} />
          {importing ? S.settings.importTraceRunning : S.settings.importTracePick}
        </label>
      </div>
    </PrefRow>
  );
}

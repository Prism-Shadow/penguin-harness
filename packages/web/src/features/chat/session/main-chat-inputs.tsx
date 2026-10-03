import { scopedValue, type Scoped } from "../../../lib/project-scope";
import { useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type {
  CostParts,
  ModelRefDto,
  ModelsResponse,
  SessionProcessInfo,
} from "@prismshadow/penguin-server/api";
import { useCompany } from "../../company";
import { useAuth } from "../../../state/auth";
import { useTheme } from "../../../state/theme";
import { useProject } from "../../../state/project";
import { useSessions } from "../../../state/sessions";
import type { StagedThinkingSwitch } from "../../model-picker";
import { createCostStatHold } from "../header-stats";
import type { SwitchContextShape } from "../model-switch";

/** Exact consecutive main ChatPage statements 0..24; called once, in original order. */
export function useMainChatInputs() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ sessionId?: string }>();
  const { user } = useAuth();
  const company = useCompany();
  const { currency } = useTheme();
  const { currentProject, currentAgent, setCurrentAgentId, reloadAgents, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const agentId = currentAgent?.agentId ?? null;
  const {
    sessions,
    loading: sessionsLoading,
    machineLabels,
    machinesUnreachable,
    offlineMachineIds,
    reload: reloadSessions,
    add: addSession,
    remove: removeSession,
    isDeleted: isSessionDeleted,
    replace,
    setStatus,
    setTitle,
  } = useSessions();

  // Cost chip state lives in a mutable per-session hold (header-stats.ts, pure/unit-tested):
  // the fetched session cost + a client-settled live base + the last shown value, advanced once
  // per render by advanceCostStat (which also resets it on session switch). usageAppliedRef
  // marks the session whose usage fetch has applied ("initial fetch done"); usageStamp only
  // forces a repaint when a fetch resolves outside the stream's own version bumps.
  const costHoldRef = useRef(createCostStatHold());
  const usageAppliedRef = useRef<string | null>(null);
  const [, bumpUsageStamp] = useState(0);
  const [credentialGuide, setCredentialGuide] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  /** This server's model configuration for the Project (the page's own while it acts here). */
  const [localModelsRead, setLocalModels] = useState<Scoped<ModelsResponse> | null>(null);
  const localModels = scopedValue(localModelsRead, projectId);
  // Background processes the conversation started (the details popover list), refreshed by
  // the polling effect below; procBusy marks the rows whose Stop / Remove requests are in
  // flight (every exited row at once while "clear exited" runs).
  const [processes, setProcesses] = useState<SessionProcessInfo[]>([]);
  const [procBusy, setProcBusy] = useState<readonly string[] | null>(null);
  /** A running process whose Stop awaits confirmation: it ends the process and drops its output. */
  const [procToKill, setProcToKill] = useState<SessionProcessInfo | null>(null);
  // Session Token buckets from the last usage fetch (the popover's tokens-line breakdown):
  // server-recorded values — they can trail the live chip mid-run and reconcile on idle.
  const [usageBuckets, setUsageBuckets] = useState<{
    cacheRead: number;
    cacheWrite: number;
    output: number;
  } | null>(null);
  // The recorded cost's priced parts from the same fetch (the details card's cost "?"). They
  // sum to the recorded cost, not to the live estimate the chip adds on top mid-run, so they
  // can trail it until the idle refresh reconciles the two.
  const [usageCostParts, setUsageCostParts] = useState<CostParts | null>(null);
  // A mid-chat thinking-level pick staged behind the confirm dialog (issue #310): some
  // providers key their prompt PREFIX on the thinking level, so switching with history in
  // place invalidates the provider's prefix cache and the next request re-bills the whole
  // history as uncached input. The pick is only applied on an explicit choice; null = no
  // dialog, "ask" = dialog open, "compacting" = the user chose "compact, then switch" and
  // the pick is held until the compaction completes. Logic in thinking-level.ts
  // (needsThinkingSwitchConfirm / thinkingSwitchAfterCompaction).
  const [thinkingSwitch, setThinkingSwitch] = useState<StagedThinkingSwitch | null>(null);
  // A pick in the session toolbar's model picker, waiting on its confirm dialog (null = no
  // dialog). `shape` is what the switch will do to the context — compact it first, switch an
  // empty conversation at once, or continue from a summary already held — so the dialog and
  // the toast promise only that. See onPickSessionModel / confirmModelSwitch.
  const [modelSwitchAsk, setModelSwitchAsk] = useState<{
    to: ModelRefDto;
    shape: SwitchContextShape;
  } | null>(null);
  // The dialog stays open (its buttons busy) until the switch request answers, so a double
  // click cannot post the switch twice.
  const [modelSwitchPosting, setModelSwitchPosting] = useState(false);
  return {
    navigate,
    location,
    params,
    user,
    company,
    currency,
    currentProject,
    currentAgent,
    setCurrentAgentId,
    reloadAgents,
    agents,
    projectId,
    agentId,
    sessions,
    sessionsLoading,
    machineLabels,
    machinesUnreachable,
    offlineMachineIds,
    reloadSessions,
    addSession,
    removeSession,
    isSessionDeleted,
    replace,
    setStatus,
    setTitle,
    costHoldRef,
    usageAppliedRef,
    bumpUsageStamp,
    credentialGuide,
    setCredentialGuide,
    infoOpen,
    setInfoOpen,
    modeSaving,
    setModeSaving,
    models: localModels,
    setModels: setLocalModels,
    processes,
    setProcesses,
    procBusy,
    setProcBusy,
    procToKill,
    setProcToKill,
    usageBuckets,
    setUsageBuckets,
    usageCostParts,
    setUsageCostParts,
    thinkingSwitch,
    setThinkingSwitch,
    modelSwitchAsk,
    setModelSwitchAsk,
    modelSwitchPosting,
    setModelSwitchPosting,
  };
}

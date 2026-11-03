import * as api from "@prismshadow/penguin-web/internal";
import type { MemoryLocateTarget } from "@prismshadow/penguin-web/internal";
import { bucketCostUsd, type BucketPricing } from "@prismshadow/penguin-web/internal";


import { openPanel } from "@prismshadow/penguin-web/internal";
import type { StreamRenderContext } from "../message-stream";
import type { SessionStreamState } from "../use-session-stream";

export interface StreamContextDeps {
  stream: SessionStreamState;
  selected: SessionInfo | null;
  onApprove: StreamRenderContext["onApprove"];
  onSendToBackground: NonNullable<StreamRenderContext["onSendToBackground"]>;
  /** A Model's current pricing, promotion applied; undefined when it has none. */
  pricingOf: (ref: ModelRefDto | null) => BucketPricing | undefined;
  /** The Session's own Model's pricing. */
  modelPricing: BucketPricing | undefined;
  onStop: () => Promise<void>;
  openWorkspaceFile: (path: string) => void;
  setSubagentTaskScope: (scope: { anchorSessionId: string }) => void;
  setSubagentFocus: (focus: { sessionId: string; origin: string[] }) => void;
  setMemoryRequest: (request: { target: MemoryLocateTarget | null }) => void;
  deletedMemoryKeys: ReadonlySet<string> | undefined;
  statFiles: NonNullable<StreamRenderContext["statFiles"]>;
  onFork: NonNullable<StreamRenderContext["onFork"]>;
  /** What a reply's interactive blocks do (see useSessionControls). */
  a2uiActions: NonNullable<StreamRenderContext["a2uiActions"]>;
}

export function streamRenderContext({
  stream,
  selected,
  onApprove,
  onSendToBackground,
  pricingOf,
  modelPricing,
  onStop,
  openWorkspaceFile,
  setSubagentTaskScope,
  setSubagentFocus,
  setMemoryRequest,
  deletedMemoryKeys,
  statFiles,
  onFork,
  a2uiActions,
}: StreamContextDeps): StreamRenderContext {
  return {
    pendingApprovals: stream.pendingApprovals,
    onApprove,
    onSendToBackground,
    origin: [],
    // Any non-idle state (running / compacting) counts as "not yet stopped": compaction can
    // happen mid-turn, and if only running were checked, the trailing group would flash
    // "finished running" during compaction before flipping back to "running".
    taskRunning: stream.taskState !== "idle",
    taskCost: (stats, model) =>
      bucketCostUsd(stats.tokensByBucket, model ? pricingOf(model) : modelPricing),
    // Reconnect countdown controls (live waiting state only): retry-now skips the
    // remaining backoff server-side (benign no-op on timing races), give-up is the
    // ordinary session abort — the engine's abort-during-backoff path ends the turn.
    onRetryNow: () => {
      if (selected) void api.postRetryNow(selected.sessionId).catch(() => undefined);
    },
    onGiveUp: () => {
      void onStop();
    },
    onOpenFile: openWorkspaceFile,
    onOpenSubagent: (sessionId, origin) => {
      // Chip click: the agents tab focused on that child (the focus chain ends with the
      // child's own id), with the graph pinned to this chip's Task.
      openPanel("agents");
      setSubagentTaskScope({ anchorSessionId: origin[0] ?? sessionId });
      setSubagentFocus({ sessionId, origin: [...origin, sessionId] });
    },
    onOpenMemory: () => {
      // The Memory tab on its list.
      openPanel("memory");
      setMemoryRequest({ target: null });
    },
    onLocateMemoryChange: (row) => {
      openPanel("memory");
      setMemoryRequest({
        target: {
          scope: row.scope,
          ...(row.scopeKey !== undefined ? { scopeKey: row.scopeKey } : {}),
          file: row.file,
        },
      });
    },
    ...(deletedMemoryKeys !== undefined ? { deletedMemoryKeys } : {}),
    workspace: selected?.workspace ?? null,
    statFiles,
    onFork,
    a2uiActions,
  };
}

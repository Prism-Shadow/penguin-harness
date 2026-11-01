/**
 * Company-mode workflow API shapes. Self-contained (no imports beyond types) so the Web
 * App's `@prismshadow/penguin-server/api` path mapping pulls a shallow graph; the runtime
 * (`organization/workflow-files.ts`) imports these rather than defining its own.
 */

export type WorkflowStepState = "pending" | "active" | "done" | "rejected";
export type WorkflowInstanceEventKind =
  | "created"
  | "advanced"
  | "rejected"
  | "attached"
  | "note";

export interface WorkflowStageGate {
  /** Human-readable exit criterion, e.g. "要点表预算/限价已确认". */
  text: string;
  /** Where to fulfill it: a tracker deep link template (`{bizKey}` expands to the instance key). */
  link?: string;
  /** Ticket prefix that proves it (e.g. `resp-`), read-only against the board. */
  ticketPrefix?: string;
}

export interface WorkflowStage {
  key: string;
  name: string;
  /** Owning role label (free text). */
  ownerRole: string;
  /** Entry criteria (shown before the stage activates). */
  entries: WorkflowStageGate[];
  /** Exit criteria (all must hold before `advance`). */
  exits: WorkflowStageGate[];
  /** Stages that may run alongside this one (converge at the next serial stage). */
  parallelWith?: string[];
  /** Skip condition label for conditional branches (e.g. `no-demo`). */
  skipWhen?: string;
}

export interface WorkflowDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  bizKeyPrefix: string;
  stages: WorkflowStage[];
}

export interface WorkflowInstanceEvent {
  kind: WorkflowInstanceEventKind;
  at: string;
  by: string;
  from?: string;
  to?: string;
  ticketId?: string;
  reason?: string;
  text?: string;
}

export interface WorkflowInstanceSnapshot {
  instanceId: string;
  definitionId: string;
  definitionVersion: number;
  bizKey: string;
  title: string;
  currentStage: string;
  stepStates: Record<string, WorkflowStepState>;
  attachments: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface WorkflowDefinitionItem {
  id: string;
  version: number;
  name: string;
  description: string;
  stageCount: number;
  instanceCount: number;
  invalid?: string;
}

export interface WorkflowInstanceItem extends WorkflowInstanceSnapshot {
  definitionName: string;
  snapshotStale: boolean;
}

export interface WorkflowInstanceDetail extends WorkflowInstanceItem {
  events: WorkflowInstanceEvent[];
  definition: WorkflowDefinition | null;
  /** True when the instance was started on an older definition version than the current one. */
  versionMismatch: boolean;
}

export interface WorkflowDefinitionsResponse {
  definitions: WorkflowDefinitionItem[];
}

export interface WorkflowInstancesResponse {
  instances: WorkflowInstanceItem[];
}

export interface WorkflowInstanceCreateRequest {
  definitionId: string;
  bizKey: string;
  title: string;
}

export interface WorkflowInstanceAdvanceRequest {
  /** Skip a skippable stage (e.g. `demo` when `no-demo`); otherwise advance to the next stage. */
  skip?: string;
}

export interface WorkflowInstanceRejectRequest {
  /** Stage to return to; defaults to the previous stage. */
  to?: string;
  reason: string;
}

export interface WorkflowInstanceAttachRequest {
  ticketId: string;
}

export interface WorkflowInstanceNoteRequest {
  text: string;
}

export interface WorkflowInstanceExport {
  instanceId: string;
  filename: string;
  markdown: string;
}

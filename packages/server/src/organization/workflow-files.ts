/**
 * Workflow definitions and instance events: parsing, validation and canonical
 * serialization. Pure string work, no I/O — the workflow store reads and writes, the
 * service decides. Same contract as files.ts: hand-edited YAML and API-written YAML parse
 * under one set of rules; an invalid file is reported, never repaired in place.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  WorkflowDefinition,
  WorkflowInstanceDetail,
  WorkflowInstanceEvent,
  WorkflowInstanceEventKind,
  WorkflowInstanceSnapshot,
  WorkflowStage,
  WorkflowStageGate,
  WorkflowStepState,
} from "../api/workflow-types.js";
import type { ParseResult } from "./files.js";

export type {
  WorkflowDefinition,
  WorkflowInstanceEvent,
  WorkflowInstanceSnapshot,
  WorkflowStage,
  WorkflowStageGate,
} from "../api/workflow-types.js";
export type { WorkflowInstanceEventKind, WorkflowStepState } from "../api/workflow-types.js";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const STAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseGate(v: unknown): WorkflowStageGate | null {
  if (typeof v === "string") return v.trim() === "" ? null : { text: v.trim() };
  if (!isRecord(v) || typeof v.text !== "string" || v.text.trim() === "") return null;
  const gate: WorkflowStageGate = { text: v.text.trim() };
  if (typeof v.link === "string" && v.link.trim() !== "") gate.link = v.link.trim();
  if (typeof v.ticketPrefix === "string" && v.ticketPrefix.trim() !== "")
    gate.ticketPrefix = v.ticketPrefix.trim();
  return gate;
}

function parseStage(v: unknown): WorkflowStage | null {
  if (!isRecord(v)) return null;
  if (typeof v.key !== "string" || !STAGE_KEY_PATTERN.test(v.key)) return null;
  if (typeof v.name !== "string" || v.name.trim() === "") return null;
  const ownerRole = typeof v.ownerRole === "string" ? v.ownerRole.trim() : "";
  const entries: WorkflowStageGate[] = [];
  const exits: WorkflowStageGate[] = [];
  if (Array.isArray(v.entries)) {
    for (const e of v.entries) {
      const g = parseGate(e);
      if (g === null) return null;
      entries.push(g);
    }
  }
  if (Array.isArray(v.exits)) {
    for (const e of v.exits) {
      const g = parseGate(e);
      if (g === null) return null;
      exits.push(g);
    }
  }
  const stage: WorkflowStage = {
    key: v.key,
    name: v.name.trim(),
    ownerRole,
    entries,
    exits,
  };
  if (Array.isArray(v.parallelWith)) {
    const p = v.parallelWith.filter(
      (s): s is string => typeof s === "string" && STAGE_KEY_PATTERN.test(s),
    );
    if (p.length !== v.parallelWith.length) return null;
    stage.parallelWith = p;
  }
  if (typeof v.skipWhen === "string" && v.skipWhen.trim() !== "")
    stage.skipWhen = v.skipWhen.trim();
  return stage;
}

export function parseWorkflowDefinition(raw: string): ParseResult<WorkflowDefinition> {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    return fail(`Failed to parse workflow YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(doc)) return fail("Workflow definition is not a YAML mapping");
  if (typeof doc.id !== "string" || doc.id.trim() === "") return fail("id must be a non-empty string");
  if (typeof doc.version !== "number" || !Number.isInteger(doc.version) || doc.version < 1)
    return fail("version must be a positive integer");
  if (typeof doc.name !== "string" || doc.name.trim() === "") return fail("name must be non-empty");
  if (!Array.isArray(doc.stages) || doc.stages.length === 0)
    return fail("stages must be a non-empty list");
  const stages: WorkflowStage[] = [];
  const keys = new Set<string>();
  for (const s of doc.stages) {
    const stage = parseStage(s);
    if (stage === null) return fail("Each stage needs key/name/ownerRole and well-formed gates");
    if (keys.has(stage.key)) return fail(`Duplicate stage key: ${stage.key}`);
    keys.add(stage.key);
    stages.push(stage);
  }
  for (const s of stages) {
    for (const p of s.parallelWith ?? []) {
      if (!keys.has(p)) return fail(`parallelWith target missing: ${p}`);
    }
  }
  return {
    ok: true,
    value: {
      id: doc.id.trim(),
      version: doc.version,
      name: doc.name.trim(),
      description: typeof doc.description === "string" ? doc.description.trim() : "",
      bizKeyPrefix: typeof doc.bizKeyPrefix === "string" ? doc.bizKeyPrefix.trim() : "",
      stages,
    },
  };
}

export function serializeWorkflowDefinition(def: WorkflowDefinition): string {
  return stringifyYaml({
    id: def.id,
    version: def.version,
    name: def.name,
    description: def.description,
    bizKeyPrefix: def.bizKeyPrefix,
    stages: def.stages.map((s) => ({
      key: s.key,
      name: s.name,
      ownerRole: s.ownerRole,
      entries: s.entries,
      exits: s.exits,
      ...(s.parallelWith ? { parallelWith: s.parallelWith } : {}),
      ...(s.skipWhen ? { skipWhen: s.skipWhen } : {}),
    })),
  });
}

export function initialSnapshot(
  instanceId: string,
  def: WorkflowDefinition,
  bizKey: string,
  title: string,
  by: string,
  at: string,
): WorkflowInstanceSnapshot {
  const stepStates: Record<string, WorkflowStepState> = {};
  const first = def.stages[0];
  def.stages.forEach((s, i) => {
    stepStates[s.key] = i === 0 ? "active" : "pending";
  });
  return {
    instanceId,
    definitionId: def.id,
    definitionVersion: def.version,
    bizKey,
    title,
    currentStage: first?.key ?? "",
    stepStates,
    attachments: [],
    updatedAt: at,
    updatedBy: by,
  };
}

/** Replays an event stream onto an initial snapshot; unknown stages are skipped, never fatal. */
export function replayEvents(
  initial: WorkflowInstanceSnapshot,
  stages: string[],
  events: WorkflowInstanceEvent[],
): WorkflowInstanceSnapshot {
  const snap: WorkflowInstanceSnapshot = {
    ...initial,
    stepStates: { ...initial.stepStates },
    attachments: [...initial.attachments],
  };
  for (const e of events) {
    if (e.kind === "advanced" && e.to && stages.includes(e.to)) {
      for (const k of stages) {
        if (snap.stepStates[k] === "active") snap.stepStates[k] = "done";
      }
      snap.stepStates[e.to] = "active";
      snap.currentStage = e.to;
    } else if (e.kind === "rejected" && e.to && stages.includes(e.to)) {
      if (snap.currentStage && stages.includes(snap.currentStage))
        snap.stepStates[snap.currentStage] = "pending";
      snap.stepStates[e.to] = "active";
      snap.currentStage = e.to;
    } else if (e.kind === "attached" && e.ticketId && !snap.attachments.includes(e.ticketId)) {
      snap.attachments.push(e.ticketId);
    }
    snap.updatedAt = e.at;
    snap.updatedBy = e.by;
  }
  return snap;
}

/** Auditable Markdown of an instance: stages with states and gates, attachments, timeline. */
export function renderWorkflowExport(detail: WorkflowInstanceDetail): string {
  const lines: string[] = [];
  lines.push(`# 工作流实例：${detail.title}`);
  lines.push("");
  lines.push(`- 流程：${detail.definitionName}（定义版本 v${detail.definitionVersion}，实例基于 v${detail.definitionVersion}）`);
  lines.push(`- 业务键：${detail.bizKey}`);
  lines.push(`- 当前阶段：${detail.currentStage}`);
  lines.push(`- 更新：${detail.updatedAt}（${detail.updatedBy}）`);
  if (detail.versionMismatch) lines.push(`- 注意：定义已有新版本，实例仍按旧版本阶段重放`);
  lines.push("");
  lines.push("## 阶段");
  lines.push("");
  lines.push("| 阶段 | 负责人 | 状态 |");
  lines.push("|---|---|---|");
  const stages = detail.definition?.stages ?? [];
  const nameOf = (key: string): string => stages.find((s) => s.key === key)?.name ?? key;
  const ownerOf = (key: string): string => stages.find((s) => s.key === key)?.ownerRole ?? "";
  const keys = stages.length > 0 ? stages.map((s) => s.key) : Object.keys(detail.stepStates);
  for (const key of keys) {
    lines.push(`| ${nameOf(key)} | ${ownerOf(key)} | ${detail.stepStates[key] ?? "pending"} |`);
  }
  lines.push("");
  if (stages.length > 0) {
    lines.push("## 准出门");
    lines.push("");
    for (const s of stages) {
      if (s.exits.length === 0) continue;
      lines.push(`### ${s.name}`);
      for (const g of s.exits) {
        lines.push(`- ${g.text}${g.ticketPrefix ? `（需 ${g.ticketPrefix}* 工单进入评审）` : ""}${g.link ? `［${g.link}］` : ""}`);
      }
      lines.push("");
    }
  }
  lines.push("## 挂载工单");
  lines.push("");
  lines.push(detail.attachments.length > 0 ? detail.attachments.map((a) => `- ${a}`).join("\n") : "（无）");
  lines.push("");
  lines.push("## 时间线");
  lines.push("");
  const stagesForNames = detail.definition?.stages ?? [];
  const stageName = (key: string): string =>
    stagesForNames.find((s) => s.key === key)?.name ?? key;
  for (const e of detail.events) {
    const what =
      e.kind === "advanced"
        ? `推进 ${stageName(e.from ?? "")} → ${stageName(e.to ?? "")}`
        : e.kind === "rejected"
          ? `驳回 ${stageName(e.from ?? "")} → ${stageName(e.to ?? "")}，原因：${e.reason ?? ""}`
          : e.kind === "attached"
            ? `挂载工单 ${e.ticketId ?? ""}`
            : e.kind === "note"
              ? `备注：${e.text ?? ""}`
              : `创建（${e.text ?? ""} ${e.reason ?? ""}）`;
    lines.push(`- ${e.at} ${e.by}：${what}`);
  }
  lines.push("");
  return lines.join("\n");
}

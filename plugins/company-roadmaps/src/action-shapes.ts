/**
 * The shapes of company-proposals' Action registry this plugin contributes to
 * (`CompanyActionRegistry.actions`), declared here as far as the roadmap Actions use them. This
 * plugin does not import company-proposals; the registry hands its contributions values of these
 * shapes, and its manifest names the slot by key.
 */
import type { DatabaseSync } from "node:sqlite";
import type { OrgActor, OrgView } from "@prismshadow/penguin-server/plugin";

export interface ActionCaller {
  principal: string;
  agentId: string | null;
  userId: string;
  sessionId?: string;
}

export interface Subject {
  kind: string;
  /** The part after the prefix: `3` of `roadmap:3`, `3/<key>` of `item:3/<key>`. */
  id: string;
  text: string;
}

export interface GuardInput {
  caller: ActionCaller;
  subject: Subject;
  state: unknown;
  params: Record<string, unknown>;
  running: number;
  tx?: unknown;
}

/**
 * A guard returns to allow (what it returns is its verdict, which the write may read) and throws
 * to refuse; `options` is what a replacing guard hands the default it wraps.
 */
export type Guard = (input: GuardInput, options?: Record<string, unknown>) => unknown;

/** A guard replacement: handed the guard it replaces. */
export type GuardCode = (defaults: Guard) => Guard;

export interface RunContext {
  runId: string;
  key: string;
  org: OrgView;
  actor: OrgActor;
  caller: ActionCaller;
  subject: Subject;
  params: Record<string, unknown>;
  act: {
    guard(input: Omit<GuardInput, "running">): unknown;
    inTx?: (db: DatabaseSync) => void;
  };
}

export interface ActionCode {
  guard?: Guard;
  run(ctx: RunContext): Promise<unknown>;
}

export interface SubjectCode {
  state(scope: { org: OrgView; caller: ActionCaller }, subject: Subject): Promise<unknown>;
}

/** The roadmap number of a `roadmap:<n>` or `item:<n>/<key>` subject. */
export function subjectNumber(subject: Subject): number {
  return Number(subject.id.split("/")[0]);
}

/** The item key of an `item:<n>/<key>` subject. */
export function subjectKey(subject: Subject): string {
  const at = subject.id.indexOf("/");
  return at < 0 ? "" : subject.id.slice(at + 1);
}

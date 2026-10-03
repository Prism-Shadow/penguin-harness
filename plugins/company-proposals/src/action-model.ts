/**
 * The Action model. Every write to the proposals and roadmaps of an organization is an Action:
 * a contribution with a dotted key (`proposal.approve`, `roadmap.item.approve`,
 * `deploy.desktop`), the kinds of subject it acts on, a parameter schema, a guard and a run.
 * Each execution is an ActionRun (action-store.ts), recorded whether it succeeded, was
 * refused or failed. The registry (action-registry.ts) resolves a key to one bound
 * contribution and runs it; the routes (action-routes.ts) are the one way in.
 *
 * The contributions arrive on one slot, `CompanyActionRegistry.actions`, declared here beside
 * the interface the registry implements. A contribution is one of four kinds:
 *
 *   action   a new Action: its key, subjects, params and description; its code is an
 *            {@link ActionCode} (a default guard and the run)
 *   guard    replaces the guard of `key`: its code is a {@link GuardCode}, handed the default
 *            guard to tighten, loosen or rewrite
 *   hook     runs `before` or `after` the Action of `key`: its code is a {@link HookCode}
 *   subject  reads the subject kinds it names: its code is a {@link SubjectCode} — the state a
 *            guard is asked about, and the commit of a subject that has one
 *
 * The plugins' own contributions are bound in every organization; a company module's take
 * effect only once the organization binds them (`action.bind`, action_bindings).
 */
import type { DatabaseSync } from "node:sqlite";
import { Interface } from "@prismshadow/penguin-core/plugin";
import type { Opaque, Slot } from "@prismshadow/penguin-core/plugin";
import type { OrgActor, OrgView } from "@prismshadow/penguin-server/plugin";

/** What an Action acts on. */
export const SUBJECT_KINDS = [
  "organization",
  "proposal",
  "comment",
  "discussion",
  "roadmap",
  "item",
  "branch",
  "change_request",
  "target",
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * A subject as a caller names it: `organization`, `proposal:12`, `comment:12/c3-ab12cd`,
 * `discussion:12/<sessionId>`, `roadmap:3`, `item:3/<key>`, `branch:origin/dev`,
 * `pr:owner/repo#5` (or `pr:5`, the delivery repository's), `target:<deployment id>`.
 */
export interface Subject {
  kind: SubjectKind;
  /** The part after the prefix ("" for the organization). */
  id: string;
  /** The subject as written, the form ActionRuns record. */
  text: string;
}

/** The outcome of a run; a run without one is still running. */
export type ActionOutcome = "succeeded" | "refused" | "failed" | "aborted" | "abandoned";

/** Where a run came from. */
export type ActionVia = "web" | "cli" | "session" | "api";

/** The caller, resolved: the principal a run is recorded under, and the person behind it. */
export interface ActionCaller {
  /** `user:<id>` or `agent:<id>`. */
  principal: string;
  /** The employee, when the caller is one (or speaks from one's session). */
  agentId: string | null;
  /** The signed-in user the request came with. */
  userId: string;
  /** The session the call came from, when it came from one. */
  sessionId?: string;
}

/**
 * A refusal: a guard, a before hook or a check of the registry answers it, and the run is
 * recorded as `refused` with this status and code. The plugins' own domain errors carry the
 * same two fields and are read the same way.
 */
export class ActionRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra members of the error body (the contributions an ambiguous key names). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ActionRefusal";
  }
}

/** A failure a run reports (a process that exited non-zero): recorded as `failed` with this status and code. */
export class ActionFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ActionFailure";
  }
}

/** What a guard is asked. */
export interface GuardInput {
  caller: ActionCaller;
  subject: Subject;
  /**
   * The subject as it stands: what the subject resolver read (the check before the hooks), or
   * what the write transaction holds (the check inside it); null when the kind has no state.
   */
  state: unknown;
  params: Record<string, unknown>;
  /** The organization's binding of the Action's contribution: its `config`. */
  config: Record<string, unknown>;
  /** Runs of this Action in the organization that have not ended. */
  running: number;
  /** Lookups only the write transaction offers (the plugin's own type); absent before it. */
  tx?: unknown;
}

/** A guard: synchronous and pure, it returns to allow and throws an {@link ActionRefusal} to refuse. */
export type Guard = (input: GuardInput) => void;

/**
 * What one write of a run carries into the use case: the guard as the organization binds it
 * (the use case asks it again inside its transaction) and the run's transaction hook — called
 * inside each write transaction the run makes, so the run's start row commits with the write.
 */
export interface Act {
  guard(input: Omit<GuardInput, "config" | "running">): void;
  inTx?: (db: DatabaseSync) => void;
}

/** A subject's commit, resolved when a run starts: what a deploy runs on. */
export interface SubjectCommit {
  sha: string;
  /** `owner/repo` of the commit. */
  repo: string;
  branch: string;
  /** The change request on that head, when there is one. */
  pr: number | null;
  prUrl: string | null;
  /** The proposal whose impl it is, when one is. */
  proposal: number | null;
}

/** How a process run ended. */
export interface ProcessEnd {
  /** null when killed by a signal or never started. */
  exitCode: number | null;
  /** Why it never started or was stopped, when it did not simply exit. */
  error: string | null;
  timedOut: boolean;
}

/** What a process of a run is started with. */
export interface ProcessOptions {
  /** Added to the server's environment. */
  env?: Record<string, string>;
  /** The organization's shared workspace by default. */
  cwd?: string;
}

/** What a run is handed. */
export interface RunContext {
  runId: string;
  org: OrgView;
  actor: OrgActor;
  caller: ActionCaller;
  subject: Subject;
  params: Record<string, unknown>;
  /** The subject's commit, resolved when the run started; null for a subject without one. */
  commit: SubjectCommit | null;
  config: Record<string, unknown>;
  act: Act;
  /**
   * Starts a process for this run: the argument vector as is (no shell), stdout and stderr kept
   * as the run's output (a bounded tail), stopped after the timeout. One per run.
   */
  process(argv: readonly string[], opts?: ProcessOptions): Promise<ProcessEnd>;
}

/** The code half of an `action` contribution. */
export interface ActionCode {
  /** The default guard; none allows everyone. */
  guard?: Guard;
  /** The run; what it returns is the run's result (JSON). */
  run(ctx: RunContext): Promise<unknown>;
}

/** The code half of a `guard` contribution: the replacement, built over the default guard. */
export type GuardCode = (defaults: Guard) => Guard;

/** What a hook is told. */
export interface HookEvent {
  when: "before" | "after";
  key: string;
  contribution: string;
  runId: string;
  org: OrgView;
  caller: ActionCaller;
  subject: Subject;
  params: Record<string, unknown>;
  commit: SubjectCommit | null;
  /** The hook's own binding config. */
  config: Record<string, unknown>;
  /** After: how the run ended, and its result. */
  outcome?: ActionOutcome;
  result?: unknown;
}

/** The code half of a `hook` contribution; a before hook refuses by throwing. */
export type HookCode = (event: HookEvent) => void | Promise<void>;

/** Where a subject resolver reads: the organization. */
export interface SubjectScope {
  org: OrgView;
  caller: ActionCaller;
}

/** The code half of a `subject` contribution. */
export interface SubjectCode {
  /** The subject's state for a guard; throws a 404 refusal for one that does not exist. */
  state(scope: SubjectScope, subject: Subject): Promise<unknown>;
  /** The subject's commit now, for a kind that has one. */
  commit?(scope: SubjectScope, subject: Subject): Promise<SubjectCommit | null>;
}

/** One contribution to the slot, its data half. */
export interface ActionContribution {
  kind: "action" | "guard" | "hook" | "subject";
  /** The Action's key (action, guard, hook). */
  key?: string;
  /** The subject kinds an action acts on, or a subject resolver reads. */
  subjects?: string[];
  /** An action's parameters: name (`?` suffix: optional) to an arktype expression. */
  params?: Record<string, string>;
  description?: string;
  /** A hook's moment. */
  when?: "before" | "after";
  /** An action: resolve the subject's commit when a run starts (a deploy), checked against an `expectedHead` parameter. */
  commit?: boolean;
}

type NoMembers = Record<never, never>;

/**
 * CompanyActions: the registry of an organization's Actions. Its one face is its slot; the
 * runs go through its routes.
 */
export abstract class CompanyActions extends Interface<NoMembers>() {}

export interface CompanyActionsSlots {
  /**
   * The Actions, their guards, hooks and subject resolvers. A contribution's code half is the
   * code of its kind (action-model.ts). Ids are unique across the tree; keys may repeat, and a
   * key two bound contributions answer is ambiguous only when it is invoked.
   */
  actions: Slot<ActionContribution, Opaque<"CompanyActionCode">>;
}

const PREFIX: Record<string, SubjectKind> = {
  proposal: "proposal",
  comment: "comment",
  discussion: "discussion",
  roadmap: "roadmap",
  item: "item",
  branch: "branch",
  pr: "change_request",
  target: "target",
};

const SHAPE: Record<SubjectKind, RegExp> = {
  organization: /^$/,
  proposal: /^[1-9]\d{0,8}$/,
  comment: /^[1-9]\d{0,8}\/[A-Za-z0-9_-]{1,64}$/,
  discussion: /^[1-9]\d{0,8}\/[A-Za-z0-9_.:-]{1,128}$/,
  roadmap: /^[1-9]\d{0,8}$/,
  item: /^[1-9]\d{0,8}\/[^\s/]{1,64}$/,
  branch: /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?\/[^\s]{1,255}$/,
  change_request: /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#?[1-9]\d{0,8}$/,
  target: /^[a-z0-9][a-z0-9_.-]{0,63}$/,
};

/** A subject as written, checked: a 400 refusal for one that is not. */
export function parseSubject(text: unknown): Subject {
  if (typeof text !== "string" || text.length > 400) {
    throw new ActionRefusal(400, "bad_subject", "subject must be a string such as proposal:12.");
  }
  if (text === "organization") return { kind: "organization", id: "", text };
  const at = text.indexOf(":");
  const kind = at < 0 ? undefined : PREFIX[text.slice(0, at)];
  const id = at < 0 ? "" : text.slice(at + 1);
  if (kind === undefined || !SHAPE[kind].test(id)) {
    throw new ActionRefusal(
      400,
      "bad_subject",
      `Not a subject: ${text} (organization, proposal:<n>, comment:<n>/<id>, discussion:<n>/<session>, roadmap:<n>, item:<n>/<key>, branch:<remote>/<branch>, pr:<owner>/<repo>#<n>, target:<id>).`,
    );
  }
  return { kind, id, text };
}

/** The leading number of a subject id (`12` of `comment:12/c3`). */
export function subjectNumber(subject: Subject): number {
  return Number(subject.id.split("/")[0]);
}

/** The part after the number (`c3` of `comment:12/c3`). */
export function subjectRest(subject: Subject): string {
  const at = subject.id.indexOf("/");
  return at < 0 ? "" : subject.id.slice(at + 1);
}

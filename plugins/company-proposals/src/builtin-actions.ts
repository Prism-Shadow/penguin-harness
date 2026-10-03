/**
 * The built-in proposal Actions: the code halves of this plugin's contributions to
 * `CompanyActionRegistry.actions` (their data halves are the manifest, plugin.ts). Each runs
 * one use case of ProposalService under the Action's guard as the organization binds it; the
 * guard defaults are guards.ts's.
 *
 * Besides the Actions, the plugin contributes the subject resolver of the kinds it owns —
 * the organization, proposals, comments, discussions, branches, change requests and deploy
 * targets — and an after hook on every `deploy.*`: the PR graph probes the deployments again
 * once a deploy ended.
 */
import type { ProposalImplRequest, ProposalMaterialKind } from "@prismshadow/penguin-server/api";
import {
  subjectNumber,
  subjectRest,
  type ActionCode,
  type HookCode,
  type RunContext,
  type SubjectCode,
} from "./action-model.js";
import { proposalGuards, type WriteAct } from "./guards.js";
import { branchCommit, changeRequestHead, proposalHead } from "./heads.js";
import { branchRefOf } from "./impl-branch.js";
import { MATERIAL_KINDS, ProposalError, type ProposalService } from "./service.js";

/** The Act a use case runs under, from the run's. */
export function writeActOf(ctx: RunContext): WriteAct {
  return {
    check: (state, opts) =>
      ctx.act.guard({
        caller: ctx.caller,
        subject: ctx.subject,
        state,
        params: { ...ctx.params, ...opts?.params },
        ...(opts?.tx !== undefined ? { tx: opts.tx } : {}),
      }),
    ...(ctx.act.inTx !== undefined ? { inTx: ctx.act.inTx } : {}),
  };
}

const badRequest = (message: string): ProposalError =>
  new ProposalError(400, "bad_request", message);

/** A string parameter, non-empty, at most `max` characters. */
function text(params: Record<string, unknown>, name: string, max = 20_000): string {
  const v = params[name];
  if (typeof v !== "string" || v.trim() === "")
    throw badRequest(`${name} must be a non-empty string.`);
  if (v.length > max) throw badRequest(`${name} is too long (max ${max} characters).`);
  return v;
}

/** An optional string parameter, at most `max` characters. */
function optional(params: Record<string, unknown>, name: string, max = 4000): string | undefined {
  const v = params[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw badRequest(`${name} must be a string.`);
  if (v.length > max) throw badRequest(`${name} is too long (max ${max} characters).`);
  return v;
}

/** The ids of the built-in proposal Actions, by key. */
export const PROPOSAL_ACTION_IDS = {
  "proposal.create": "company-proposals.action.create",
  "proposal.publish": "company-proposals.action.publish",
  "proposal.brief": "company-proposals.action.brief",
  "proposal.ready": "company-proposals.action.ready",
  "proposal.approve": "company-proposals.action.approve",
  "proposal.reject": "company-proposals.action.reject",
  "proposal.merged": "company-proposals.action.merged",
  "proposal.implement": "company-proposals.action.implement",
  "proposal.impl": "company-proposals.action.impl",
  "proposal.impl.adopt": "company-proposals.action.impl-adopt",
  "proposal.material": "company-proposals.action.material",
  "proposal.feedback": "company-proposals.action.feedback",
  "proposal.discuss": "company-proposals.action.discuss",
  "proposal.conclude": "company-proposals.action.conclude",
  "proposal.comment": "company-proposals.action.comment",
  "proposal.comment.edit": "company-proposals.action.comment-edit",
  "proposal.comment.withdraw": "company-proposals.action.comment-withdraw",
  "proposal.requestChanges": "company-proposals.action.request-changes",
  "proposal.resolve": "company-proposals.action.resolve",
  "target.register": "company-proposals.action.target-register",
} as const;

export type ProposalActionKey = keyof typeof PROPOSAL_ACTION_IDS;

export const SUBJECTS_ID = "company-proposals.subjects";
export const DEPLOY_REFRESH_ID = "company-proposals.hook.deploy-refresh";

type Run = (service: ProposalService, ctx: RunContext, act: WriteAct) => Promise<unknown>;

const RUNS: Record<ProposalActionKey, Run> = {
  "proposal.create": (s, ctx, act) => {
    const title = optional(ctx.params, "title", 200);
    return s.create(
      ctx.org.projectId,
      ctx.org.orgId,
      {
        author: text(ctx.params, "author", 64),
        brief: text(ctx.params, "brief"),
        ...(title !== undefined ? { title } : {}),
      },
      ctx.actor,
      act,
    );
  },
  "proposal.publish": (s, ctx, act) =>
    s.publish(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      text(ctx.params, "markdown", 200_000),
      ctx.actor,
      act,
    ),
  "proposal.brief": (s, ctx, act) =>
    s.editBrief(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      text(ctx.params, "brief"),
      ctx.actor,
      act,
    ),
  "proposal.ready": (s, ctx, act) =>
    s.ready(ctx.org.projectId, ctx.org.orgId, subjectNumber(ctx.subject), ctx.actor, act),
  "proposal.approve": (s, ctx, act) =>
    s.approve(ctx.org.projectId, ctx.org.orgId, subjectNumber(ctx.subject), ctx.actor, act),
  "proposal.reject": (s, ctx, act) =>
    s.reject(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      text(ctx.params, "reason", 4000),
      ctx.actor,
      act,
    ),
  "proposal.merged": (s, ctx, act) =>
    s.merged(ctx.org.projectId, ctx.org.orgId, subjectNumber(ctx.subject), ctx.actor, act),
  "proposal.implement": (s, ctx, act) => {
    const agentId = optional(ctx.params, "agent", 64);
    const message = optional(ctx.params, "message");
    const workspace = optional(ctx.params, "workspace", 1000);
    return s.implement(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      {
        ...(agentId !== undefined ? { agentId } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(workspace !== undefined ? { workspace } : {}),
      },
      ctx.actor,
      act,
    );
  },
  "proposal.impl": (s, ctx, act) => {
    const url = optional(ctx.params, "url", 2000);
    const req: ProposalImplRequest = {
      ...(url !== undefined ? { url } : {}),
      ...(ctx.params.head !== undefined ? { head: branchRefOf(ctx.params.head, "head") } : {}),
      ...(ctx.params.base !== undefined ? { base: branchRefOf(ctx.params.base, "base") } : {}),
    };
    return s.setImpl(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      req,
      ctx.actor,
      act,
    );
  },
  "proposal.impl.adopt": (s, ctx, act) =>
    s.adoptImpl(ctx.org.projectId, ctx.org.orgId, ctx.actor, act),
  "proposal.material": (s, ctx, act) => {
    const kind = text(ctx.params, "kind", 16) as ProposalMaterialKind;
    if (!MATERIAL_KINDS.includes(kind)) {
      throw badRequest(`kind must be one of ${MATERIAL_KINDS.join(", ")}.`);
    }
    const label = optional(ctx.params, "label", 200);
    return s.addMaterial(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      { kind, url: text(ctx.params, "url", 2000), ...(label !== undefined ? { label } : {}) },
      ctx.actor,
      act,
    );
  },
  "proposal.feedback": (s, ctx, act) =>
    s.feedback(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      {
        text: text(ctx.params, "text"),
        ...(ctx.params.runtime !== undefined ? { runtime: ctx.params.runtime === true } : {}),
      },
      ctx.actor,
      act,
    ),
  "proposal.discuss": (s, ctx, act) =>
    s.discuss(ctx.org.projectId, ctx.org.orgId, subjectNumber(ctx.subject), ctx.actor, act),
  "proposal.conclude": (s, ctx, act) =>
    s.conclude(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      subjectRest(ctx.subject),
      text(ctx.params, "text"),
      ctx.actor,
      act,
    ),
  "proposal.comment": (s, ctx, act) => {
    const offset = (name: "start" | "end"): number => {
      const v = ctx.params[name];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        throw badRequest(`${name} must be a non-negative integer.`);
      }
      return v;
    };
    return s.comment(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      {
        sectionId: text(ctx.params, "sectionId", 64),
        start: offset("start"),
        end: offset("end"),
        quote: text(ctx.params, "quote"),
        text: text(ctx.params, "text"),
      },
      ctx.actor,
      act,
    );
  },
  "proposal.comment.edit": (s, ctx, act) =>
    s.editComment(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      subjectRest(ctx.subject),
      text(ctx.params, "text"),
      ctx.actor,
      act,
    ),
  "proposal.comment.withdraw": (s, ctx, act) =>
    s.deleteComment(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      subjectRest(ctx.subject),
      ctx.actor,
      act,
    ),
  "proposal.requestChanges": (s, ctx, act) =>
    s.requestChanges(ctx.org.projectId, ctx.org.orgId, subjectNumber(ctx.subject), ctx.actor, act),
  "proposal.resolve": (s, ctx, act) =>
    s.resolve(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      subjectRest(ctx.subject),
      optional(ctx.params, "text"),
      ctx.actor,
      act,
    ),
  "target.register": (s, ctx, act) => {
    const url = optional(ctx.params, "url", 2000);
    return s.registerDeployment(
      ctx.org.projectId,
      ctx.org.orgId,
      { id: text(ctx.params, "id", 64), ...(url !== undefined ? { url } : {}) },
      ctx.actor,
      act,
    );
  },
};

/** The code half of every built-in contribution of this plugin, by contribution id. */
export function proposalCode(
  service: ProposalService,
): Record<string, ActionCode | HookCode | SubjectCode> {
  const out: Record<string, ActionCode | HookCode | SubjectCode> = {};
  for (const [key, id] of Object.entries(PROPOSAL_ACTION_IDS) as Array<
    [ProposalActionKey, string]
  >) {
    const run = RUNS[key];
    const code: ActionCode = { run: (ctx) => run(service, ctx, writeActOf(ctx)) };
    const guard = proposalGuards[key];
    if (guard !== undefined) code.guard = guard;
    out[id] = code;
  }
  const subjects: SubjectCode = {
    state: async ({ org }, subject) => {
      if (
        subject.kind !== "proposal" &&
        subject.kind !== "comment" &&
        subject.kind !== "discussion"
      ) {
        return null;
      }
      return (await service.subjects(org.projectId, org.orgId)).proposal(subjectNumber(subject));
    },
    commit: async ({ org }, subject) => {
      const scope = await service.subjects(org.projectId, org.orgId);
      if (subject.kind === "proposal") return proposalHead(scope, subjectNumber(subject), scope.gh);
      if (subject.kind === "change_request") return changeRequestHead(scope, subject.id, scope.gh);
      if (subject.kind === "branch") return branchCommit(scope, subject.id, scope.gh);
      return null;
    },
  };
  out[SUBJECTS_ID] = subjects;
  const refresh: HookCode = ({ org }) => {
    service.deployFinished(org.projectId, org.orgId);
  };
  out[DEPLOY_REFRESH_ID] = refresh;
  return out;
}

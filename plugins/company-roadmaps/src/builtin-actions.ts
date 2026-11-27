/**
 * The built-in roadmap Actions: the code halves of this plugin's contributions to
 * company-proposals' `CompanyActionRegistry.actions` (their data halves are the manifest,
 * index.ts). Each runs one use case of RoadmapService under the Action's guard in force in the
 * organization (a company workflow may replace it); the defaults are guards.ts's. The plugin also contributes the subject
 * resolver of roadmaps and their items, and the built-in notify Actions its writes send (notices.ts).
 */
import {
  subjectKey,
  subjectNumber,
  type ActionCode,
  type RunContext,
  type SubjectCode,
} from "./action-shapes.js";
import { roadmapGuards, type WriteAct } from "./guards.js";
import { RoadmapError } from "./domain.js";
import { ROADMAP_NOTICE_IDS } from "./notices.js";
import type { RoadmapService } from "./service.js";

/** The ids of the built-in roadmap Actions, by key. */
export const ROADMAP_ACTION_IDS = {
  "roadmap.open": "company-roadmaps.action.open",
  "roadmap.draft": "company-roadmaps.action.draft",
  "roadmap.item.add": "company-roadmaps.action.item-add",
  "roadmap.item.remove": "company-roadmaps.action.item-remove",
  "roadmap.establish": "company-roadmaps.action.establish",
  "roadmap.item.approve": "company-roadmaps.action.item-approve",
  "roadmap.item.link": "company-roadmaps.action.item-link",
  "roadmap.adopt": "company-roadmaps.action.adopt",
  "roadmap.reopen": "company-roadmaps.action.reopen",
  "roadmap.rename": "company-roadmaps.action.rename",
  "roadmap.room": "company-roadmaps.action.room",
  "roadmap.members": "company-roadmaps.action.members",
} as const;

export type RoadmapActionKey = keyof typeof ROADMAP_ACTION_IDS;

export const ROADMAP_SUBJECTS_ID = "company-roadmaps.subjects";

/** The Act a use case runs under, from the run's. */
export function writeActOf(ctx: RunContext): WriteAct {
  return {
    check: (state, opts) =>
      ctx.act.guard({
        caller: ctx.caller,
        subject: ctx.subject,
        state,
        params: { ...ctx.params, ...opts?.params },
      }),
    ...(ctx.act.inTx !== undefined ? { inTx: ctx.act.inTx } : {}),
    ...(ctx.act.notify !== undefined ? { notify: ctx.act.notify } : {}),
  };
}

type Run = (service: RoadmapService, ctx: RunContext, act: WriteAct) => Promise<unknown>;

const RUNS: Record<RoadmapActionKey, Run> = {
  "roadmap.open": (s, ctx, act) => {
    const p = ctx.params;
    return s.create(
      ctx.org.projectId,
      ctx.org.orgId,
      {
        name: p.name as string,
        employees: p.employees as string[],
        ...(p.channelId !== undefined ? { channelId: p.channelId as string } : {}),
        ...(typeof p.brief === "string" ? { brief: p.brief } : {}),
        ...(p.parent !== undefined ? { parent: p.parent as number } : {}),
      },
      ctx.actor,
      act,
    );
  },
  "roadmap.draft": (s, ctx, act) =>
    s.draft(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      {
        ...(ctx.params.record !== undefined ? { record: ctx.params.record as string } : {}),
        ...(ctx.params.body !== undefined ? { body: ctx.params.body as string } : {}),
        ...(ctx.params.items !== undefined ? { items: ctx.params.items } : {}),
      },
      ctx.actor,
      act,
    ),
  "roadmap.item.add": (s, ctx, act) =>
    s.addItem(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      ctx.params,
      ctx.actor,
      act,
    ),
  "roadmap.item.remove": (s, ctx, act) =>
    s.removeItem(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      ctx.params.key,
      ctx.actor,
      act,
    ),
  "roadmap.establish": (s, ctx, act) =>
    s.establish(ctx.org.projectId, ctx.org.orgId, subjectNumber(ctx.subject), ctx.actor, act),
  "roadmap.item.approve": (s, ctx, act) =>
    s.approve(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      subjectKey(ctx.subject),
      ctx.actor,
      act,
    ),
  "roadmap.item.link": (s, ctx, act) =>
    s.link(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      subjectKey(ctx.subject),
      ctx.params.proposal,
      ctx.actor,
      act,
    ),
  "roadmap.adopt": (s, ctx, act) =>
    s.adopt(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      {
        proposal: ctx.params.proposal,
        title: ctx.params.title,
        owner: ctx.params.owner,
        brief: ctx.params.brief,
      },
      ctx.actor,
      act,
    ),
  "roadmap.reopen": (s, ctx, act) =>
    s.reopen(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      ctx.params.reason,
      ctx.actor,
      act,
    ),
  "roadmap.rename": (s, ctx, act) =>
    s.rename(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      ctx.params.name,
      ctx.actor,
      act,
    ),
  "roadmap.room": (s, ctx, act) =>
    s.bindRoom(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      ctx.params.channelId,
      ctx.actor,
      act,
    ),
  "roadmap.members": (s, ctx, act) =>
    s.members(
      ctx.org.projectId,
      ctx.org.orgId,
      subjectNumber(ctx.subject),
      { employees: ctx.params.employees, moderator: ctx.params.moderator },
      ctx.actor,
      act,
    ),
};

/** The code half of every built-in contribution of this plugin, by contribution id. */
export function roadmapCode(service: RoadmapService): Record<string, ActionCode | SubjectCode> {
  const out: Record<string, ActionCode | SubjectCode> = {};
  for (const [key, id] of Object.entries(ROADMAP_ACTION_IDS) as Array<[RoadmapActionKey, string]>) {
    const run = RUNS[key];
    const code: ActionCode = { run: (ctx) => run(service, ctx, writeActOf(ctx)) };
    const guard = roadmapGuards[key];
    if (guard !== undefined) code.guard = guard;
    out[id] = code;
  }
  const subjects: SubjectCode = {
    state: async ({ org, caller }, subject) => {
      const number = subjectNumber(subject);
      const r = await service.get(org.projectId, org.orgId, number, {
        userId: caller.userId,
        ...(caller.agentId !== null ? { agentId: caller.agentId } : {}),
        ...(caller.sessionId !== undefined ? { sessionId: caller.sessionId } : {}),
      });
      if (subject.kind === "item" && !r.items.some((i) => i.key === subjectKey(subject))) {
        throw new RoadmapError(
          404,
          "item_not_found",
          `Roadmap #${number} has no item ${subjectKey(subject)}.`,
        );
      }
      return r;
    },
  };
  out[ROADMAP_SUBJECTS_ID] = subjects;
  // The built-in notices (notices.ts): every one is a line on each desk of `to`.
  const desk: ActionCode = {
    run: (ctx) =>
      service.notices.desk(
        ctx.org.projectId,
        ctx.org.orgId,
        subjectNumber(ctx.subject),
        ctx.params.to as string[],
        ctx.params.text as string,
        ctx.caller.principal,
      ),
  };
  for (const id of Object.values(ROADMAP_NOTICE_IDS)) out[id] = desk;
  return out;
}

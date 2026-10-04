/**
 * The proposal notices: what a proposal write tells employees, as built-in notify Actions, one
 * key per event (`notify.proposal.approved`). A write runs its notice by key once it committed
 * (ProposalService.tell, through the run's `act.notify`), so an organization's company workflow
 * that contributes an `action` on the key replaces the built-in one — a company that wants the
 * event elsewhere, or nowhere, says so there — and its guard and hooks apply as to any Action.
 *
 * Each takes the recipients (`to`) and the line (`text`), and the id of the run that sent it
 * (`runId`). The built-in one puts the line on each recipient's desk, in nobody's name, and
 * records a `notify_failed` event for a desk that could not take it (ProposalService.deliverNotice).
 * A notify Action runs only as a notice (action-notice.ts), never on its own.
 *
 * The contributions live in a module of their own (the proposals module is at its size limit);
 * it reaches the proposal service through the proposals module, by name.
 */
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import { subjectNumber, type ActionCode, type NoticeResult } from "./action-model.js";

/** The events a proposal write tells employees of. */
export const PROPOSAL_NOTICE_EVENTS = [
  "created",
  "approved",
  "rejected",
  "changes_requested",
  "revised_after_approval",
  "feedback",
  "brief_edited",
  "discussion_concluded",
] as const;

export type ProposalNoticeEvent = (typeof PROPOSAL_NOTICE_EVENTS)[number];

/** The notify Action's key of an event. */
export function noticeKey(event: ProposalNoticeEvent): string {
  return `notify.proposal.${event}`;
}

/** The ids of the built-in notify Actions, by event. */
export const PROPOSAL_NOTICE_IDS: Record<ProposalNoticeEvent, string> = {
  created: "company-proposals.notify.created",
  approved: "company-proposals.notify.approved",
  rejected: "company-proposals.notify.rejected",
  changes_requested: "company-proposals.notify.changes-requested",
  revised_after_approval: "company-proposals.notify.revised-after-approval",
  feedback: "company-proposals.notify.feedback",
  brief_edited: "company-proposals.notify.brief-edited",
  discussion_concluded: "company-proposals.notify.discussion-concluded",
};

/** Where the built-in notices deliver: the proposal service, through the proposals module. */
@Interface()
export abstract class ProposalNoticeDesk {
  /** `line` on each desk of `to`; a desk that cannot take it recorded `notify_failed` under `caller`. */
  abstract deliverNotice(
    projectId: string,
    orgId: string,
    number: number,
    to: readonly string[],
    line: string,
    caller: { principal: string },
  ): Promise<NoticeResult>;
}

/** The code half of every built-in notify Action, by contribution id. */
export function noticeCode(desk: ProposalNoticeDesk): Record<string, ActionCode> {
  const out: Record<string, ActionCode> = {};
  for (const id of Object.values(PROPOSAL_NOTICE_IDS)) {
    out[id] = {
      run: (ctx) =>
        desk.deliverNotice(
          ctx.org.projectId,
          ctx.org.orgId,
          subjectNumber(ctx.subject),
          ctx.params.to as string[],
          ctx.params.text as string,
          ctx.caller,
        ),
    };
  }
  return out;
}

/** The built-in proposal notices on the Action registry's slot. Its manifest is generated into ifaces.json. */
@Component({
  contributes: {
    "CompanyActionRegistry.actions": [
      {
        id: "company-proposals.notify.created",
        kind: "action",
        key: "notify.proposal.created",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the author a proposal was delegated to it.",
      },
      {
        id: "company-proposals.notify.approved",
        kind: "action",
        key: "notify.proposal.approved",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the implementer (else the author) a proposal was approved.",
      },
      {
        id: "company-proposals.notify.rejected",
        kind: "action",
        key: "notify.proposal.rejected",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the author and the implementer a proposal was rejected.",
      },
      {
        id: "company-proposals.notify.changes-requested",
        kind: "action",
        key: "notify.proposal.changes_requested",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the author changes were requested.",
      },
      {
        id: "company-proposals.notify.revised-after-approval",
        kind: "action",
        key: "notify.proposal.revised_after_approval",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the implementer an approved proposal was revised.",
      },
      {
        id: "company-proposals.notify.feedback",
        kind: "action",
        key: "notify.proposal.feedback",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the author (and, for runtime feedback, the implementer) of feedback.",
      },
      {
        id: "company-proposals.notify.brief-edited",
        kind: "action",
        key: "notify.proposal.brief_edited",
        subjects: ["proposal"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the author its proposal's brief was rewritten.",
      },
      {
        id: "company-proposals.notify.discussion-concluded",
        kind: "action",
        key: "notify.proposal.discussion_concluded",
        subjects: ["discussion"],
        params: { to: "string[]", text: "string", runId: "string" },
        description:
          "Tell the owner a discussion of its proposal concluded, and what was concluded.",
      },
    ],
  },
})
export class ProposalNotices {
  @Use("CompanyProposalsPlugin") private readonly desk!: ProposalNoticeDesk;
  @Bind("company-proposals.notify.created") created!: unknown;
  @Bind("company-proposals.notify.approved") approved!: unknown;
  @Bind("company-proposals.notify.rejected") rejected!: unknown;
  @Bind("company-proposals.notify.changes-requested") changesRequested!: unknown;
  @Bind("company-proposals.notify.revised-after-approval") revisedAfterApproval!: unknown;
  @Bind("company-proposals.notify.feedback") feedback!: unknown;
  @Bind("company-proposals.notify.brief-edited") briefEdited!: unknown;
  @Bind("company-proposals.notify.discussion-concluded") discussionConcluded!: unknown;

  setup() {
    const code = noticeCode(this.desk);
    const id = PROPOSAL_NOTICE_IDS;
    this.created = code[id.created];
    this.approved = code[id.approved];
    this.rejected = code[id.rejected];
    this.changesRequested = code[id.changes_requested];
    this.revisedAfterApproval = code[id.revised_after_approval];
    this.feedback = code[id.feedback];
    this.briefEdited = code[id.brief_edited];
    this.discussionConcluded = code[id.discussion_concluded];
  }
}

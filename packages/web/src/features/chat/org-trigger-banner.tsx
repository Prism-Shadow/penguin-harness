/**
 * Origin hint for a message the organization scheduler sent (the `[org_trigger]` block): the
 * block is not rendered verbatim; it folds into one harness note (TranscriptNote) — the fixed
 * phrase, which organization, what kind of trigger, the event / message / ticket it names, and
 * the budget line — the same shape as the scheduled-task banner beside it. The trigger's body renders as
 * usual below.
 */
import { Badge, TranscriptNote } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import { summarizeOrgTrigger } from "./org-trigger";
import type { OrgTriggerOrigin } from "./org-trigger";

export function OrgTriggerBanner({ origin }: { origin: OrgTriggerOrigin }) {
  const t = summarizeOrgTrigger(origin);
  const kind = S.chat.orgTriggerKinds[t.kind] ?? t.kind;
  return (
    <TranscriptNote
      className="anim-msg my-2"
      label={S.chat.orgTriggerLabel}
      subject={t.org}
      tag={<Badge variant="solid">{kind}</Badge>}
      {...(t.subject !== null
        ? { code: t.change !== null ? `${t.subject} · ${t.change}` : t.subject }
        : {})}
      meta={[
        t.firedAt !== null ? formatDateTime(t.firedAt) : null,
        t.budget !== null ? S.chat.orgTriggerBudget(t.budget) : null,
      ]}
    />
  );
}

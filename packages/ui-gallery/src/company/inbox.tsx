/**
 * The left column, laid out as the Agent sidebar is. Its fixed block holds the line to the lead,
 * the one way in for anything new, and the company's pages; under it, the inbox in three groups:
 * what waits on the reader's call, what moves without them, what is settled. Only a blocker, a
 * breaker, verified work or a proposal is ever in the first group.
 *
 * A row whose ticket holds words the reader typed and has not sent (a half-answered decision
 * card, a send-back note) is tinted and carries a pen, so a draft left behind while switching
 * between tickets is never lost track of.
 *
 * Before the company exists the column lists the steps of setting it up instead.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Fold,
  GlyphIcon,
  GroupHeader,
  ICONS,
  NAV_FILL,
  NavRow,
  Pill,
  SidebarListHeader,
  SidebarNavArea,
} from "@prismshadow/penguin-ui";
import { ticketWait, ticketsIn } from "./model";
import type { CompanyState, Ticket } from "./model";
import { PersonAvatar } from "./people";
import { INBOX_GROUPS } from "./spec";
import type { InboxGroup } from "./spec";
import { lineOf, titleOf } from "./text";
import { useWords } from "./use-words";

const ROW_BOX = "flex w-full gap-2 rounded-md px-2 py-1.5 text-left transition-colors";
const ROW = `${ROW_BOX} items-start`;

function TicketRow({
  ticket,
  active,
  draft,
  onOpen,
}: {
  ticket: Ticket;
  active: boolean;
  draft: boolean;
  onOpen: () => void;
}) {
  const W = useWords();
  const wait = ticketWait(ticket);
  const fill = active
    ? `${NAV_FILL.selected} duration-200`
    : draft
      ? "bg-tone-attention-bg duration-150"
      : `${NAV_FILL.hover} duration-150`;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
      className={`${ROW} ${fill}`}
    >
      <span className="mt-0.5 shrink-0">
        <PersonAvatar id={ticket.owner} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm text-fg ${ticket.unread ? "font-semibold" : ""}`}
          >
            {titleOf(ticket, W)}
          </span>
          {draft && (
            <span
              className="shrink-0 text-tone-attention-fg"
              role="img"
              aria-label={W.nav.draft}
              data-tooltip={W.nav.draft}
            >
              <GlyphIcon d={ICONS.pencil} size={13} />
            </span>
          )}
          {wait !== null && (
            <Pill tone={wait === "halt" ? "danger" : wait === "decide" ? "success" : "attention"}>
              {W.waits[wait]}
            </Pill>
          )}
        </span>
        <span className="block truncate text-xs text-fg-muted">{lineOf(ticket, W)}</span>
      </span>
    </button>
  );
}

const GROUP_GLYPH: Record<InboxGroup, string> = {
  decide: ICONS.bell,
  moving: ICONS.play,
  settled: ICONS.checkCircle,
};

export function InboxList({
  state,
  selected,
  hasDraft,
  onOpen,
}: {
  state: CompanyState;
  selected: string | null;
  hasDraft: (id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  const [open, setOpen] = useState<Record<InboxGroup, boolean>>({
    decide: true,
    moving: true,
    settled: false,
  });
  return (
    <div className="flex flex-col pb-3">
      <SidebarListHeader label={W.nav.inbox}>{null}</SidebarListHeader>
      <div className="flex flex-col gap-1 px-2 pt-1">
        {INBOX_GROUPS.map((group) => {
          const tickets = ticketsIn(state, group);
          return (
            <section key={group} aria-label={W.groups[group]}>
              <GroupHeader
                open={open[group]}
                onToggle={() => setOpen((current) => ({ ...current, [group]: !current[group] }))}
                glyph={GROUP_GLYPH[group]}
                label={W.groups[group]}
                count={tickets.length}
              />
              <Fold open={open[group]}>
                {() =>
                  tickets.length === 0 ? (
                    <p className="px-7 pb-2 pt-0.5 text-xs text-fg-subtle">{W.groupEmpty[group]}</p>
                  ) : (
                    <div className="flex flex-col gap-px pb-2">
                      {tickets.map((ticket) => (
                        <TicketRow
                          key={ticket.id}
                          ticket={ticket}
                          active={selected === ticket.id}
                          draft={hasDraft(ticket.id)}
                          onOpen={() => onOpen(ticket.id)}
                        />
                      ))}
                    </div>
                  )
                }
              </Fold>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** The company's pages, beside the line to the lead. */
export type CompanyPage = "team" | "rules" | "handbook" | "review";

const PAGE_GLYPH: Record<CompanyPage, string> = {
  team: ICONS.users,
  rules: ICONS.shieldCheck,
  handbook: ICONS.bookOpen,
  review: ICONS.barChart,
};

export function PinnedRows({
  current,
  leadDraft,
  onLead,
  onPage,
}: {
  current: "lead" | CompanyPage | null;
  leadDraft: boolean;
  onLead: () => void;
  onPage: (page: CompanyPage) => void;
}) {
  const W = useWords();
  return (
    <SidebarNavArea>
      <NavRow
        surface="muted"
        label={W.nav.lead}
        glyph={<PersonAvatar id="lead" size={16} />}
        active={current === "lead"}
        tooltip={W.nav.leadHint}
        tooltipExtra
        {...(leadDraft
          ? {
              badge: (
                <span className="text-tone-attention-fg" role="img" aria-label={W.nav.draft}>
                  <GlyphIcon d={ICONS.pencil} size={13} />
                </span>
              ),
            }
          : {})}
        onClick={onLead}
        className="font-medium"
      />
      {(["team", "rules", "handbook", "review"] as const).map((page) => (
        <NavRow
          key={page}
          surface="muted"
          label={W.nav[page]}
          glyph={PAGE_GLYPH[page]}
          active={current === page}
          onClick={() => onPage(page)}
        />
      ))}
    </SidebarNavArea>
  );
}

/** Before the company exists: the steps of setting it up, the current one marked. */
export function SetupSteps({ step }: { step: number }) {
  const W = useWords();
  return (
    <div className="flex flex-col pb-3">
      <SidebarListHeader label={W.steps.title}>{null}</SidebarListHeader>
      <ol className="flex flex-col gap-px px-2 pt-1">
        {W.steps.items.map((item, index) => {
          const state: ReactNode =
            index < step ? (
              <GlyphIcon d={ICONS.check} size={13} className="text-fg-muted" />
            ) : (
              <span className="w-[13px] text-center text-xs tabular-nums">{index + 1}</span>
            );
          return (
            <li
              key={item}
              aria-current={index === step ? "step" : undefined}
              className={`${ROW_BOX} ${index === step ? NAV_FILL.selected : ""} items-center text-sm ${
                index > step ? "text-fg-subtle" : "text-fg"
              }`}
            >
              <span className="flex w-4 shrink-0 justify-center text-fg-muted">{state}</span>
              <span className="truncate">{item}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

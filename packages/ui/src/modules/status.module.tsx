/**
 * Status & feedback: how the app says what is going on.
 *
 * - Live: a Task's plan with its run states (done, running with its live clock, waiting for
 *   approval, failed, stopped) and nav rows carrying counts;
 * - Settled: tickets with their status and priority badges (two at most per row), and stop reasons;
 * - Notices: a neutral strip, the one callout a view may have, an inline error, and toasts;
 * - Loading & empty: progress against a budget, a skeleton list, a page's empty state and a
 *   settings slot's.
 *
 * Static stand-ins for W1's `Dot`, `Spinner`, `StatusIcon`, `Badge`, `Count`, `Skeleton` and
 * `EmptyState`, and W4's `Notice` and `ProgressBar`.
 */
import type { ToneName } from "../tokens";
import { TICKET_STATUSES, fixturesFor } from "../fixtures";
import type { Fixtures, RunState, StopReason, TicketFixture } from "../fixtures";
import { defineModule, viewFor } from "../module";
import { duration, liveDuration, usd } from "../screens/format";
import {
  Badge,
  Button,
  Dot,
  EmptyState,
  GlyphIcon,
  Heading,
  Link,
  NavRow,
  Notice,
  ProgressBar,
  RunSpinner,
  Skeleton,
  TONE_INK,
  Toast,
} from "./parts";
import type { IconName } from "./parts";

const STATE_MARK: Record<RunState, { tone: ToneName; icon: IconName | "spinner" }> = {
  done: { tone: "success", icon: "circleCheck" },
  running: { tone: "success", icon: "spinner" },
  waiting: { tone: "attention", icon: "hourglass" },
  failed: { tone: "danger", icon: "circleCross" },
  stopped: { tone: "neutral", icon: "circleCross" },
};

const TICKET_TONE: Record<
  TicketFixture["status"],
  { tone: ToneName; variant: "soft" | "outline" | "solid" }
> = {
  proposed: { tone: "neutral", variant: "soft" },
  in_progress: { tone: "info", variant: "soft" },
  review: { tone: "attention", variant: "outline" },
  done: { tone: "done", variant: "soft" },
  rejected: { tone: "danger", variant: "outline" },
};

const PRIORITY_TONE: Record<
  TicketFixture["priority"],
  { tone: ToneName; variant: "soft" | "outline" | "solid" }
> = {
  P0: { tone: "danger", variant: "solid" },
  P1: { tone: "attention", variant: "outline" },
  P2: { tone: "neutral", variant: "outline" },
};

function Live({ f }: { f: Fixtures }) {
  const states = f.copy.chat.runStates;
  const workspace = f.sessionGroups[0]!;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <Heading level={5}>{f.copy.chat.plan}</Heading>
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {f.plan.map((step) => {
            const mark = STATE_MARK[step.state];
            return (
              <li
                key={step.title}
                className="flex items-center gap-2 border-t border-line-muted py-2 text-sm"
              >
                <span className="w-4 shrink-0">
                  {mark.icon === "spinner" ? (
                    <RunSpinner tone={mark.tone} label={states.running} />
                  ) : (
                    <StatusIcon tone={mark.tone} icon={mark.icon} />
                  )}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${step.state === "stopped" ? "text-fg-muted" : "text-fg"}`}
                >
                  {step.title}
                </span>
                {step.state === "waiting" ? (
                  <span className="shrink-0 text-xs font-(--ui-weight-medium) text-tone-attention-fg">
                    {states.waiting}
                  </span>
                ) : step.state === "stopped" ? (
                  <span className="shrink-0 text-xs text-fg-muted">{states.stopped}</span>
                ) : (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                    {step.state === "running"
                      ? liveDuration(step.elapsedMs ?? 0)
                      : duration(step.durationMs ?? 0)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <nav className="grid grid-cols-[minmax(0,1fr)] max-w-xs gap-px">
        <NavRow
          icon="kanban"
          label={f.copy.company.tickets}
          count={f.company.tickets.length}
          active
        />
        <span className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg-muted">
          <GlyphIcon name="message" size={16} className="text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate">{f.copy.nav.sessions}</span>
          <Dot tone="success" live size="xs" />
          <span className="text-xs tabular-nums">{workspace.items.length}</span>
        </span>
      </nav>
    </div>
  );
}

/** A run state's static glyph (W1's `StatusIcon`). */
function StatusIcon({ tone, icon }: { tone: ToneName; icon: IconName }) {
  return (
    <span className={TONE_INK[tone]}>
      <GlyphIcon name={icon} size={14} />
    </span>
  );
}

const REASON_TONE: Record<StopReason, ToneName> = {
  completed: "neutral",
  tool_use: "info",
  max_tokens: "attention",
  error: "danger",
};

function Settled({ f }: { f: Fixtures }) {
  const company = f.copy.company;
  // The reasons this run reported, read off its own events — not a list typed into the module.
  const reasons = [
    ...new Set(f.trace.turns.flatMap((t) => t.events.flatMap((e) => e.stopReason ?? []))),
  ];
  // One ticket per state, so every state's badge is on screen and none is cut off the end.
  const tickets = TICKET_STATUSES.map((s) => f.company.tickets.find((t) => t.status === s)!);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <Heading level={5}>{company.tickets}</Heading>
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {tickets.map((ticket) => {
            const status = TICKET_TONE[ticket.status];
            const priority = PRIORITY_TONE[ticket.priority];
            return (
              <li
                key={ticket.ticketId}
                className="flex items-center gap-2 border-t border-line-muted py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{ticket.title}</span>
                  <span className="block truncate font-mono text-xs text-fg-subtle">
                    {ticket.ticketId} · {usd(ticket.costUsd)}
                  </span>
                </span>
                <Badge tone={priority.tone} variant={priority.variant}>
                  {ticket.priority}
                </Badge>
                <Badge tone={status.tone} variant={status.variant}>
                  {company.ticketStatus[ticket.status]}
                </Badge>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <Heading level={5}>{f.copy.traces.stopReasons}</Heading>
        <p className="flex flex-wrap items-center gap-2">
          {reasons.map((reason) => (
            <Badge key={reason} tone={REASON_TONE[reason]} variant="outline">
              {reason}
            </Badge>
          ))}
        </p>
      </section>
    </div>
  );
}

function Notices({ f }: { f: Fixtures }) {
  const { byTone, toasts } = f.notices;
  const { success: strip, attention: callout, danger: inline } = byTone;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Notice tone={strip.tone} title={strip.title}>
        {strip.body}
      </Notice>
      <Notice
        tone={callout.tone}
        variant="callout"
        title={callout.title}
        action={callout.action && <Button variant="secondary">{callout.action}</Button>}
      >
        {callout.body}
      </Notice>
      <Notice
        tone={inline.tone}
        variant="inline"
        action={inline.action && <Link>{inline.action}</Link>}
      >
        {inline.title}
      </Notice>
      <div className="grid grid-cols-[minmax(0,1fr)] justify-items-end gap-2 pt-2">
        {toasts.map((toast) => (
          <Toast
            key={toast.title}
            tone={toast.tone}
            title={toast.title}
            description={toast.body}
            action={toast.action ? <Link>{toast.action}</Link> : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function LoadingAndEmpty({ f }: { f: Fixtures }) {
  const agents = f.copy.agents;
  const spend = f.company.org.spend;
  // The employee past their budget: the one bar that turns danger.
  const over = f.company.employees.find(
    (e) => e.budgetUsd !== undefined && e.spendUsd > e.budgetUsd,
  );
  const rows = [
    {
      title: f.copy.company.monthlyBudget,
      spent: spend.costUsd,
      budget: spend.budgetUsd,
      tone: "neutral" as const,
    },
    ...(over?.budgetUsd === undefined
      ? []
      : [
          {
            title: `${over.name} · ${over.title}`,
            spent: over.spendUsd,
            budget: over.budgetUsd,
            tone: "danger" as const,
          },
        ]),
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <section className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {rows.map((row) => (
          <div key={row.title} className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-fg">{row.title}</span>
              <span
                className={`text-xs tabular-nums ${row.tone === "danger" ? "text-tone-danger-fg" : "text-fg-muted"}`}
              >
                {f.copy.common.spentOf(usd(row.spent), usd(row.budget))}
              </span>
            </div>
            <ProgressBar value={row.spent / row.budget} tone={row.tone} label={row.title} />
          </div>
        ))}
      </section>
      <section aria-busy className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {[0, 1, 2].map((row) => (
          <span key={row} className="flex items-center gap-3">
            <Skeleton className="size-6" />
            <span className="grid grid-cols-[minmax(0,1fr)] flex-1 gap-1.5">
              <Skeleton className={`h-3 ${row === 1 ? "w-2/3" : "w-4/5"}`} />
              <Skeleton className="h-2.5 w-1/3" />
            </span>
          </span>
        ))}
      </section>
      <EmptyState
        title={agents.empty.title}
        description={agents.empty.body}
        action={
          <Button variant="primary" leading={<GlyphIcon name="plus" size={13} />}>
            {agents.newAgent}
          </Button>
        }
      />
      <EmptyState
        variant="slot"
        title={agents.mcpEmpty.title}
        description={agents.mcpEmpty.body}
        action={<Button variant="secondary">{agents.mcpEmpty.action}</Button>}
      />
    </div>
  );
}

const VARIANTS = {
  live: Live,
  settled: Settled,
  notices: Notices,
  "loading-empty": LoadingAndEmpty,
} as const;

export const module = defineModule({
  id: "status",
  title: "Status & feedback",
  description:
    "Run states, badges and counts on a task list; notices and toasts; progress, skeletons and empty states.",
  width: "narrow",
  variants: [
    { key: "live", title: "Live" },
    { key: "settled", title: "Settled" },
    { key: "notices", title: "Notices" },
    { key: "loading-empty", title: "Loading & empty" },
  ],
  parts: [
    "icons-dot",
    "icons-spinner",
    "icons-status-icon",
    "icons-update-dot",
    "feedback-badge",
    "feedback-count",
    "feedback-notice",
    "feedback-todo-notice",
    "feedback-skeleton",
    "feedback-empty-state",
    "feedback-progress-bar",
    "feedback-duration-slot",
    "feedback-beta-badge",
    "overlays-toaster",
  ],
  render: (variant, { lang }) => {
    const View = viewFor(VARIANTS, variant);
    return <View f={fixturesFor(lang)} />;
  },
});

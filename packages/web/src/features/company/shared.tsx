/**
 * Small pieces every organization page shares: the organization's status pill and dot, the
 * budget bar and ring, the budget field and the two marks a budget box wears (its unit, and
 * what a converted amount will be stored as), a field title with its "?" for a control that
 * has no info slot of its own, the ticket status and priority pills, the blocked badge, the
 * failed-refresh line, the two ways out of a summary — the title that opens what it names, and
 * the corner button a titleless card or row uses instead — and principal naming. The bordered
 * KPI tile is the shared UI package's `StatTile`. Every status colour here is a tone from
 * lib/tone.ts, picked by meaning.
 */
import { useId } from "react";
import type { ReactNode } from "react";
import type {
  OrgStatus,
  OrgTicketPriority,
  OrgTicketStatus,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  FieldError,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  InfoPopover,
  Input,
  Notice,
  ProgressBar,
  Ring,
} from "@prismshadow/penguin-ui";
import type { BadgeStyle, ToneName } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatMoney, formatPercent } from "../../lib/format";
import { toneDot, toneInk } from "../../lib/tone";
import type { Currency } from "../../state/theme";
import { EmployeeAvatar } from "./employee-avatar";
import { toStoredUsd, unitLabel } from "./budget-input";
import { budgetTone } from "./finance-tree";
import type { BudgetTone } from "./finance-tree";
import { parsePrincipal } from "./principals";
import { ORG_STATUS_TONE, orgStatusKind } from "./shell-org-status";
import type { OrgStatusKind } from "./shell-org-status";

/** Circled exclamation: the mark of an invalid chart entry or ticket file, and of the finance page's alert count. */
export const INVALID_ICON = ICONS.alertCircle;

/**
 * The way out of a card or a row that has no title to click: a flat glyph button that opens the
 * page, the session or the ticket the thing beside it stands for, named for its destination
 * ("Open the org chart", 「查看工单」). It sits in a KPI card's corner and at the end of a
 * titleless row.
 *
 * Neither the card nor the row is itself the link. A whole-area click swallows the controls
 * living inside it and leaves a reader guessing where the click would land, so the surface stays
 * inert and the navigation is this button — always drawn, never revealed on hover, since a
 * control that appears only under a pointer cannot be reached by touch at all. Where the thing
 * does have a title, TitleButton carries the jump instead and this button is not drawn at all.
 */
export function JumpButton({
  label,
  onClick,
  className = "",
}: {
  /** Where it goes, as the tooltip and the accessible name both read it. */
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tooltip={label}
      aria-label={label}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${className}`}
    >
      <GlyphIcon d={ICONS.arrowUpRight} size={ICON_SIZE.inlineGlyph} />
    </button>
  );
}

/**
 * A title that opens what it names: the click target of a card or a row that has one. The
 * title is the one part of a surface that already says where a click would land, so it is the
 * link — a real button, focusable and underlined on hover — while the rest of the surface stays
 * inert. Where a row has no natural title, JumpButton is the way out instead. (The ticket
 * board's card is the one surface that is a button whole: see tickets-page.tsx.)
 *
 * The visible text is the accessible name. Its tooltip opens only when a row cuts that text off,
 * so `hint` is the text whole, never the verb of the click.
 */
export function TitleButton({
  onClick,
  hint,
  className = "",
  children,
}: {
  onClick: () => void;
  /**
   * The whole of what the button shows, for when the row cuts it (a long ticket title), with
   * the id when the reader may need it ("<title> · <id>"). Shown as text, so it wraps at words.
   * The click needs no hint: the underline on hover already says the title opens something.
   */
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(hint !== undefined ? { "data-tooltip": hint, "data-tooltip-content": "text" } : {})}
      className={`min-w-0 text-left hover:underline focus-visible:underline ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A cut-off line's whole text for its hint: the title with the id after it, or the id alone when
 * no title is known (a blank title, or a stand-in that is the id itself, counts as none).
 */
export function titledHint(title: string | undefined, id: string): string {
  return title === undefined || title.trim() === "" || title === id ? id : `${title} · ${id}`;
}

/** The label of an organization's headline state. */
function orgStatusLabel(kind: OrgStatusKind): string {
  if (kind === "invalid") return S.company.orgInvalid;
  return kind === "paused" ? S.company.statusPaused : S.company.statusActive;
}

/** An organization's headline state in words, for an accessible name that has to carry it. */
export function orgStatusText(org: { status: OrgStatus; invalid?: string }): string {
  return orgStatusLabel(orgStatusKind(org));
}

const ORG_STATUS_BADGE: Record<OrgStatusKind, ToneName> = {
  invalid: "danger",
  paused: "attention",
  active: "success",
};

/** An organization's headline state as a pill: invalid configuration outranks paused, paused outranks active. The reason rides in the tooltip when the configuration is invalid. */
export function OrgStatusPill({ org }: { org: { status: OrgStatus; invalid?: string } }) {
  const kind = orgStatusKind(org);
  return (
    <span
      {...(org.invalid !== undefined ? { "data-tooltip": org.invalid } : {})}
      className="inline-flex"
    >
      <Badge tone={ORG_STATUS_BADGE[kind]}>{orgStatusLabel(kind)}</Badge>
    </span>
  );
}

/** The same state as a 6px dot (the switcher's rows), its name in the tooltip and sr text. */
export function OrgStatusDot({ org }: { org: { status: OrgStatus; invalid?: string } }) {
  const kind = orgStatusKind(org);
  const label = orgStatusLabel(kind);
  return (
    <span data-tooltip={label} className="inline-flex shrink-0 items-center">
      <span className={`block h-1.5 w-1.5 rounded-full ${toneDot[ORG_STATUS_TONE[kind]]}`} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A refresh that failed while the page still holds what it last read: one danger strip
 * naming the failure, the server's reason beside it, and the retry — never a skeleton over
 * data that is already on screen.
 */
export function ErrorLine({
  message,
  detail,
  onRetry,
  className = "",
}: {
  message: string;
  /** The server's own wording (apiErrorText), shown after the message. */
  detail?: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Notice
      tone="danger"
      role="alert"
      className={className}
      retry={{ label: S.common.retry, onClick: onRetry }}
    >
      <span className="font-medium">{message}</span>
      {detail !== undefined && detail !== message && (
        <span className="ml-2 opacity-80">{detail}</span>
      )}
    </Notice>
  );
}

/**
 * Spend against a budget as a ring (the package's `Ring`): the used share drawn clockwise from
 * the top in the budget's tone (attention from 80%, danger from 100%, the ring full when over)
 * over a track of that tone faded, the percent inside; a muted, empty ring with a dash when there
 * is no budget. The exact amounts ride in the accessible name and tooltip.
 */
export function SpendRing({
  cost,
  budget,
  ratio,
  currency,
  size = 64,
}: {
  cost: number;
  budget?: number;
  ratio?: number;
  currency: Currency;
  size?: number;
}) {
  const tone = budgetTone(ratio);
  const share = ratio === undefined ? 0 : Math.min(1, Math.max(0, ratio));
  const label =
    budget === undefined
      ? `${formatMoney(cost, currency)} · ${S.company.noBudget}`
      : `${S.company.spendOfBudget(formatMoney(cost, currency), formatMoney(budget, currency))} · ${formatPercent(ratio)}`;
  return (
    // Without a budget the ring has no tone and takes this span's line ink, track only.
    <span className={`relative block shrink-0 ${tone === "muted" ? "text-line-emphasis" : ""}`}>
      <Ring
        segments={share > 0 ? [{ value: share }] : []}
        max={1}
        size={size}
        width={Math.max(3, Math.round(size * 0.1))}
        {...(tone !== "muted" ? { tone } : {})}
        trackOpacity={0.25}
        label={label}
      />
      {/* Sized to the ring rather than to a text rung: at the overview's 40px it must fit
          "100%" inside the stroke. The ring carries the name, so the figure is hidden from
          assistive technology and lets the pointer through to the ring's tooltip. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center leading-none font-semibold text-gray-700 dark:text-gray-200"
        style={{ fontSize: Math.round(size * 0.22) }}
      >
        {budget === undefined ? "—" : formatPercent(ratio)}
      </span>
    </span>
  );
}

/** A budget reading as the progress bar's fill; no budget draws an empty neutral bar. */
const BUDGET_FILL: Record<BudgetTone, ToneName> = {
  muted: "neutral",
  success: "success",
  attention: "attention",
  danger: "danger",
};

/** Spend against a budget as a bar: attention from 80%, danger from 100%; an empty bar when there is no budget. */
export function BudgetBar({
  cost,
  budget,
  ratio,
  currency,
  compact = false,
}: {
  cost: number;
  budget?: number;
  ratio?: number;
  currency: Currency;
  compact?: boolean;
}) {
  const tone = budgetTone(ratio);
  const width = ratio === undefined ? 0 : Math.min(100, Math.max(0, ratio * 100));
  const label =
    budget === undefined
      ? `${formatMoney(cost, currency)} · ${S.company.noBudget}`
      : `${S.company.spendOfBudget(formatMoney(cost, currency), formatMoney(budget, currency))} · ${formatPercent(ratio)}`;
  return (
    <div className={compact ? "min-w-24" : ""}>
      {!compact && (
        <p
          className={`mb-1 text-xs font-medium ${tone === "muted" ? "text-gray-500 dark:text-gray-400" : toneInk[tone]}`}
        >
          {label}
        </p>
      )}
      <ProgressBar
        value={Math.round(width)}
        tone={BUDGET_FILL[tone]}
        label={label}
        data-tooltip={label}
      />
    </div>
  );
}

/**
 * The unit that follows a budget box: the currency the reader picked, and the period the cap
 * covers ("$ / month"). It sits after the box rather than inside the label, so one mark
 * serves both a form field and the finance table's in-place editor.
 */
export function MoneyPerMonthUnit({ currency }: { currency: Currency }) {
  return (
    <span className="shrink-0 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
      {unitLabel(currency, S)}
    </span>
  );
}

/**
 * What a budget typed in another currency will actually be stored as. Budgets live in USD in
 * the organization's chart file and this App converts at one fixed rate, so a reader working
 * in CNY is told the amount the file is about to hold. Nothing to say to a reader already
 * working in USD, or while the box is empty.
 */
export function StoredUsdNote({ usd, currency }: { usd: number | null; currency: Currency }) {
  if (currency === "USD" || usd === null) return null;
  return (
    <span className="mt-1 block text-xs text-gray-400 dark:text-gray-500">
      {S.company.budgetStoredAs(formatMoney(usd, "USD"))}
    </span>
  );
}

/**
 * A field's title with its "?" beside it, for a control that has no `info` slot of its own: a
 * `Select`, a picker, the budget box. The "?" is a `<button>`, so it cannot sit inside a
 * wrapping `<label>` (it would take the title's name, the trap the UI package's field.tsx
 * documents); this row stands above the control instead. Pass `htmlFor` when the control has
 * an id, otherwise the control names itself with `aria-label`. `required` draws the mark here
 * only: the control's own `required` is what sets `aria-required`, and the caller keeps the two
 * in step.
 */
export function InfoFieldLabel({
  label,
  info,
  required,
  htmlFor,
}: {
  label: string;
  /** What the field means, disclosed by the "?". */
  info: ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <span className="mb-1 flex items-center gap-1">
      <FieldLabel block={false} required={required} htmlFor={htmlFor}>
        {label}
      </FieldLabel>
      <InfoPopover label={label}>{info}</InfoPopover>
    </span>
  );
}

/**
 * A budget field: a number box in the reader's currency with the unit after it, what the cap
 * means behind the title's "?", the error beneath, and the stored amount under that while the
 * two currencies differ. The three dialogs that set a budget share it; the finance table edits
 * inside a cell and wears the two marks above on their own.
 *
 * The box is bare — an `Input` with no title of its own — and the title is associated by
 * `htmlFor`, because a wrapping `<label>` names its first labelable descendant and this
 * field's row holds more than the box.
 */
export function MoneyPerMonthInput({
  label,
  currency,
  value,
  info,
  error,
  placeholder,
  disabled = false,
  autoFocus = false,
  onChange,
}: {
  label: string;
  currency: Currency;
  /** The typed text, in the reader's currency; budget-input.ts converts it to what is stored. */
  value: string;
  info?: ReactNode;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (text: string) => void;
}) {
  const controlId = useId();
  const errorId = `${controlId}-error`;
  return (
    <div>
      {info !== undefined ? (
        <InfoFieldLabel label={label} info={info} htmlFor={controlId} />
      ) : (
        <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={controlId}
          size="sm"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          className="min-w-0 flex-1"
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          invalid={error !== undefined}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(error !== undefined ? { "aria-describedby": errorId } : {})}
          onChange={(e) => onChange(e.target.value)}
        />
        <MoneyPerMonthUnit currency={currency} />
      </div>
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
      <StoredUsdNote usd={toStoredUsd(value, currency)} currency={currency} />
    </div>
  );
}

/** A finished ticket is settled, neither good nor bad news: a neutral tag, solid so it reads. */
const STATUS_BADGE: Record<OrgTicketStatus, BadgeStyle> = {
  proposed: { tone: "neutral" },
  in_progress: { tone: "success" },
  review: { tone: "attention" },
  done: { tone: "neutral", variant: "solid" },
  rejected: { tone: "danger" },
};

export function TicketStatusBadge({ status }: { status: OrgTicketStatus }) {
  return <Badge {...STATUS_BADGE[status]}>{S.company.tickets.columns[status] ?? status}</Badge>;
}

const PRIORITY_TONE: Record<OrgTicketPriority, ToneName> = {
  P0: "danger",
  P1: "attention",
  P2: "neutral",
};

export function PriorityBadge({ priority }: { priority: OrgTicketPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{priority}</Badge>;
}

/** The blocked mark: an attention pill whose tooltip carries the reason and who it waits on. */
export function BlockedBadge({ reason, by }: { reason: string; by?: string }) {
  return (
    <span
      data-tooltip={S.company.tickets.blockedTooltip(reason, by ?? "—")}
      className="inline-flex"
    >
      <Badge tone="attention">{S.company.tickets.blocked}</Badge>
    </span>
  );
}

/** A principal's display name: an employee's name (or its id), a member's user id, "System", "Everyone". */
export function principalLabel(principal: string, names: ReadonlyMap<string, string>): string {
  const p = parsePrincipal(principal);
  switch (p.kind) {
    case "agent":
      return names.get(p.id) ?? p.id;
    case "user":
      return p.id;
    case "all":
      return S.company.principalAll;
    case "system":
      return S.company.principalSystem;
    default:
      return p.raw;
  }
}

/** A principal as an avatar plus its name (agents get their tile; people a plain initial disc). */
export function PrincipalChip({
  principal,
  names,
  size = 14,
}: {
  principal: string;
  names: ReadonlyMap<string, string>;
  size?: number;
}) {
  const p = parsePrincipal(principal);
  const label = principalLabel(principal, names);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {p.kind === "agent" ? (
        <EmployeeAvatar id={p.id} name={label} size={size} className="shrink-0 rounded" />
      ) : (
        <span
          aria-hidden
          style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
          className="flex shrink-0 items-center justify-center rounded-full bg-gray-900 font-bold text-white dark:bg-gray-200 dark:text-gray-900"
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

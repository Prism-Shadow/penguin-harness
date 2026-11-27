/**
 * Small pieces every page here shares: the two ways out of a summary — the title that opens
 * what it names, and the corner button a titleless card or row uses instead — the
 * failed-refresh line, and principal naming. Every status colour here is a tone from the
 * bridge, picked by meaning.
 */
import type { ReactNode } from "react";
import { GlyphIcon, ICONS, ICON_SIZE, Notice } from "@prismshadow/penguin-ui";
import { S } from "./strings";
import { parsePrincipal } from "./principals";
import { EmployeeAvatar } from "./employee-avatar";

/**
 * The way out of a card or a row that has no title to click: a flat glyph button that opens the
 * page, the session or the ticket the thing beside it stands for, named for its destination.
 * It sits in a KPI card's corner and at the end of a titleless row.
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
 * inert. Where a row has no natural title, JumpButton is the way out instead.
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

/** Kept for the pages that colour a principal's dot by kind (re-exported beside the parser). */
export { parsePrincipal } from "./principals";
export type { ParsedPrincipal } from "./principals";

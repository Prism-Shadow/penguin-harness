/**
 * The notice: one component for the strip across a panel, the callout above a form and the
 * inline notice inside one, built on {@link NoticeStrip} — which owns the tone, the neutral line
 * and the theme's notice hook — so this file only lays the parts out.
 *
 * Three variants, one anatomy:
 *
 * - `strip` — a band across its container: no radius, a rule under it (a load error above a
 *   channel, a failure over a workflow tab).
 * - `callout` — a block standing on its own in a page or a form: roomier, rounder, with the
 *   actions at its end (a page's to-do, a template missing its placeholder).
 * - `inline` — a compact box inside the content (a form's auth failure, a refresh that failed
 *   while the old data stays on screen, with its retry).
 * - `banner` — a strip laid edge to edge across a column (the initial-password reminder): one
 *   centred line, its action an underlined word right after the sentence, and the close cross at
 *   the strip's far edge, out of the flow so the sentence stays centred (a labelled dismiss names
 *   the cross; a title and a retry have no place in one line). A theme that draws notices as
 *   cards insets it (`data-banner`).
 *
 * The parts are marked with the hook's slots: the leading mark in `icon` (a theme that draws its
 * own tone mark hides it, so the mark never shows twice), an optional `title`, the `body`, and the
 * `actions`. Three action slots, in reading order: `dismiss` (a clearing action with a label of
 * its own, or, with none, the close cross named by the interface's "Dismiss"), `retry`, then the
 * affirmative `action` last — where every dialog in the app puts its confirm. The close cross is
 * flat and takes the notice's own ink (`CloseButton` `ink="inherit"`): it closes this notice, so
 * it reads as part of it, never as a grey control laid on top. A dismissal that should outlive the
 * page is the caller's to keep; the notice only asks.
 */
import type { ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { CloseButton } from "../../actions/close-button/close-button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICON_GAP } from "../../../icon-scale";
import { NoticeStrip } from "./notice-strip";
import type { NoticeStripTone } from "./notice-strip";

export type NoticeVariant = "strip" | "callout" | "inline" | "banner";

/** A button a notice offers. */
export interface NoticeAction {
  label: string;
  onClick: () => void;
  /** The accessible name, when the label needs the notice's own words to say what it acts on. */
  ariaLabel?: string;
  /** In flight: the button shows the spinner and takes no presses. */
  busy?: boolean;
  disabled?: boolean;
}

/** The clearing action: a labelled button, or — with no label — the close cross. */
export interface NoticeDismiss {
  onClick: () => void;
  /** A visible label ("Mark as read"); without one the notice shows the close cross. */
  label?: string;
  /** The accessible name; the cross's defaults to the interface's "Dismiss". */
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Layout per variant; the tone, the line colour and the hook are the strip's. Every variant
 * wraps: the action buttons keep their labels whole, so where the body and the actions do not
 * fit one line the actions take a row of their own rather than squeezing the body. A lone close
 * cross is the exception: it stays at the end of the body's line and the body wraps beside it,
 * since a cross on a row of its own reads as detached from the notice it closes.
 */
const VARIANT: Readonly<Record<NoticeVariant, string>> = {
  strip: "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-1.5 text-xs",
  callout:
    "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-xs",
  inline:
    "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-xs",
  // Symmetric room for the cross at the far edge keeps the centred sentence clear of it.
  banner:
    "relative flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-8 py-1.5 text-xs",
};

export function Notice({
  tone,
  variant = "inline",
  title,
  glyph,
  dismiss,
  retry,
  action,
  role,
  className = "",
  children,
}: {
  tone: NoticeStripTone;
  variant?: NoticeVariant;
  /** A heading above the body. */
  title?: ReactNode;
  /** The leading mark: a 24×24 line path, or a mark the caller draws (a dot). */
  glyph?: string | ReactNode;
  dismiss?: NoticeDismiss;
  retry?: NoticeAction;
  /** The affirmative action, drawn last and in the accent. */
  action?: NoticeAction;
  /** `alert` for a failure the reader must hear at once, `status` for news that can wait. */
  role?: "alert" | "status";
  /** Layout only (a margin); the variant owns the box. */
  className?: string;
  /** The body. */
  children: ReactNode;
}) {
  const strings = useUiStrings();
  const labelledDismiss = dismiss !== undefined && dismiss.label !== undefined;
  const hasActions = dismiss !== undefined || retry !== undefined || action !== undefined;
  // A banner's dismissal is always the cross at its far edge, named by the label it was given.
  const cross =
    dismiss !== undefined && (!labelledDismiss || variant === "banner") ? (
      <CloseButton
        ink="inherit"
        onClose={dismiss.onClick}
        label={dismiss.ariaLabel ?? dismiss.label ?? strings.dismiss}
        disabled={dismiss.disabled}
      />
    ) : null;
  // The body takes the line's remaining room (a zero basis), so the line never breaks before it.
  const crossOnly = cross !== null && retry === undefined && action === undefined;
  if (variant === "banner") {
    return (
      <NoticeStrip
        tone={tone}
        banner
        {...(role !== undefined ? { role } : {})}
        className={`${VARIANT.banner} ${className}`}
      >
        {glyph !== undefined && (
          <span data-slot="icon" aria-hidden className="flex shrink-0">
            {typeof glyph === "string" ? <GlyphIcon d={glyph} /> : glyph}
          </span>
        )}
        <span data-slot="body">{children}</span>
        {action !== undefined && (
          <button
            type="button"
            disabled={action.disabled === true || action.busy === true}
            {...(action.ariaLabel !== undefined ? { "aria-label": action.ariaLabel } : {})}
            onClick={action.onClick}
            className="shrink-0 whitespace-nowrap font-medium underline underline-offset-2 opacity-90 transition-opacity duration-150 hover:opacity-100"
          >
            {action.label}
          </button>
        )}
        {cross !== null && (
          <span data-slot="actions" className="absolute inset-y-0 right-1.5 flex items-center">
            {cross}
          </span>
        )}
      </NoticeStrip>
    );
  }
  return (
    <NoticeStrip
      tone={tone}
      {...(role !== undefined ? { role } : {})}
      className={`${VARIANT[variant]} ${className}`}
    >
      <div className={`flex min-w-0 items-center ${ICON_GAP.menu}${crossOnly ? " flex-1" : ""}`}>
        {glyph !== undefined && (
          <span data-slot="icon" aria-hidden className="flex shrink-0">
            {typeof glyph === "string" ? <GlyphIcon d={glyph} /> : glyph}
          </span>
        )}
        <div className="min-w-0">
          {title !== undefined && (
            <p data-slot="title" className="font-medium">
              {title}
            </p>
          )}
          <div data-slot="body">{children}</div>
        </div>
      </div>
      {hasActions && (
        <div data-slot="actions" className="flex flex-wrap items-center gap-2">
          {labelledDismiss && (
            <Button
              size="sm"
              disabled={dismiss.disabled}
              {...(dismiss.ariaLabel !== undefined ? { "aria-label": dismiss.ariaLabel } : {})}
              onClick={dismiss.onClick}
            >
              {dismiss.label}
            </Button>
          )}
          {retry !== undefined && <NoticeButton {...retry} />}
          {action !== undefined && <NoticeButton {...action} primary />}
          {cross}
        </div>
      )}
    </NoticeStrip>
  );
}

function NoticeButton({
  label,
  onClick,
  ariaLabel,
  busy = false,
  disabled,
  primary = false,
}: NoticeAction & { primary?: boolean }) {
  return (
    <Button
      size="sm"
      variant={primary ? "primary" : "secondary"}
      loading={busy}
      disabled={disabled}
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

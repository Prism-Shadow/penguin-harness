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
 *
 * The parts are marked with the hook's slots: the leading mark in `icon` (a theme that draws its
 * own tone mark hides it, so the mark never shows twice), an optional `title`, the `body`, and the
 * `actions`. Three action slots, in reading order: `dismiss` (a clearing action with a label of
 * its own, or, with none, the close cross named by the interface's "Dismiss"), `retry`, then the
 * affirmative `action` last — where every dialog in the app puts its confirm.
 */
import type { ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { CloseButton } from "../../actions/close-button/close-button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICON_GAP } from "../../../icon-scale";
import { NoticeStrip } from "./notice-strip";
import type { NoticeStripTone } from "./notice-strip";

export type NoticeVariant = "strip" | "callout" | "inline";

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

/** Layout per variant; the tone, the line colour and the hook are the strip's. */
const VARIANT: Readonly<Record<NoticeVariant, string>> = {
  strip: "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-1.5 text-xs",
  callout: "flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-xs",
  inline:
    "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-xs",
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
  return (
    <NoticeStrip
      tone={tone}
      {...(role !== undefined ? { role } : {})}
      className={`${VARIANT[variant]} ${className}`}
    >
      <div className={`flex min-w-0 items-center ${ICON_GAP.menu}`}>
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
        <div data-slot="actions" className="flex shrink-0 items-center gap-2">
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
          {dismiss !== undefined && !labelledDismiss && (
            <CloseButton
              onClose={dismiss.onClick}
              label={dismiss.ariaLabel ?? strings.dismiss}
              disabled={dismiss.disabled}
            />
          )}
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

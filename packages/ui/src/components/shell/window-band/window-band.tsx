/**
 * The desktop window's controls, drawn by the page in the title band the shell leaves it (the
 * band's height is `--window-band-height`, window-band.css):
 *
 * - `WindowBandButton` is a control on the band's left end — the sidebar toggle, back, forward —
 *   handed to `AppShell` as its `band`. It sits on the navigation column's colour, so it takes the
 *   column's ink and wash, and it is a fixed 28px square: the band is window chrome, as tall in
 *   every theme and at every text size, and a control that grew with the text would overflow it.
 * - `WindowControls` is minimize, maximize (restore once maximized) and close at the band's right
 *   end, for a window whose system draws none (Windows and Linux). Each is the full band tall, in
 *   the theme's glyphs; a pointer over one lays the ink's wash on it, and close turns to the danger
 *   tone. It is fixed to the window's corner above every layer of the page, as the system's own
 *   buttons were: a dialog's scrim dims the band under it, yet the window can still be minimized
 *   or closed.
 *
 * Both are buttons on a `data-window-drag` strip, so the band around them drags the window and
 * they do not (window-band.css). Neither names a concept of the app: the caller passes the words.
 */
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export interface WindowBandButtonProps {
  /** The control's accessible name. */
  label: string;
  /** The hint beside it; the name when omitted. */
  tooltip?: string;
  /** The glyph's path, from the icon registry. */
  glyph: string;
  /** Nothing to do right now (no page to go back to): muted, no wash. */
  disabled?: boolean;
  onClick: () => void;
  /** Extra classes: `hidden md:flex` for a control that only means something beside the column. */
  className?: string;
}

export function WindowBandButton({
  label,
  tooltip,
  glyph,
  disabled = false,
  onClick,
  className = "",
}: WindowBandButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={tooltip ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-[28px] shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 enabled:hover:bg-fg/7 enabled:hover:text-fg disabled:opacity-40 ${className}`}
    >
      <GlyphIcon d={glyph} size={ICON_SIZE.navRow} />
    </button>
  );
}

export interface WindowControlsProps {
  /** The window fills the screen: the middle button restores it. */
  maximized: boolean;
  /** The buttons' names, in the interface language. */
  labels: { minimize: string; maximize: string; restore: string; close: string };
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/** A caption button's box: the band's full height, as wide as the system's. */
const CAPTION =
  "flex h-full w-[46px] items-center justify-center text-fg-muted transition-colors duration-150";

export function WindowControls({
  maximized,
  labels,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  const toggle = maximized ? labels.restore : labels.maximize;
  return (
    <div
      data-window-drag
      className="fixed right-0 top-0 z-window-controls flex h-[var(--window-band-height,0px)]"
    >
      <button
        type="button"
        aria-label={labels.minimize}
        data-tooltip={labels.minimize}
        onClick={onMinimize}
        className={`${CAPTION} hover:bg-fg/7 hover:text-fg active:bg-fg/12`}
      >
        <GlyphIcon d={ICONS.minus} size={ICON_SIZE.iconButton} />
      </button>
      <button
        type="button"
        aria-label={toggle}
        data-tooltip={toggle}
        onClick={onToggleMaximize}
        className={`${CAPTION} hover:bg-fg/7 hover:text-fg active:bg-fg/12`}
      >
        <GlyphIcon d={maximized ? ICONS.squareStack : ICONS.square} size={ICON_SIZE.iconButton} />
      </button>
      {/* The close cross carries no hint: it is the window's own, beside nothing else it could
          dismiss, and its name says all a hint would. */}
      <button
        type="button"
        aria-label={labels.close}
        onClick={onClose}
        className={`${CAPTION} hover:bg-tone-danger-emphasis hover:text-tone-danger-emphasis-fg active:bg-tone-danger-emphasis/80`}
      >
        <GlyphIcon d={ICONS.cross} size={ICON_SIZE.iconButton} />
      </button>
    </div>
  );
}

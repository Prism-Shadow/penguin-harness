/**
 * The folded navigation column: a 48px strip of icon entries in place of the pinned sidebar. The
 * head holds the entries that stay put (the unfold button), the middle is a
 * `<nav>` of entries that scrolls on its own when the window is too short for them, and the foot
 * holds the account's avatar. The scrollbar is hidden: at this width it would cost a third of the
 * strip.
 *
 * An entry is an icon with no visible label, so it carries its name as `aria-label` and the same
 * words in the styled `Tooltip` beside it — never also a native `title`, which would stack a
 * second, slower hint under the first. A selected entry (`active`) takes the column's selected
 * wash; a toggle (`pressed`) takes it while on. An entry with nowhere to go keeps its place,
 * muted, with nothing to click or tab to. A router's link draws a link entry through
 * `renderLink`, as a `NavRow` does.
 */
import type { ReactNode, Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { NAV_FILL } from "../../navigation/nav-list/nav-list";
import type { NavRowLinkProps } from "../../navigation/nav-list/nav-list";
import { Tooltip } from "../../overlays/tooltip/tooltip";

/**
 * An entry's square: the selected wash when `active`, the same wash under the pointer otherwise,
 * and a muted glyph with no fill when `disabled`. For an element the rail does not draw itself (a
 * row another module renders onto the rail).
 */
export function railItemClass({
  active = false,
  disabled = false,
}: {
  active?: boolean;
  disabled?: boolean;
} = {}): string {
  const state = disabled
    ? "cursor-not-allowed text-fg-muted opacity-40"
    : active
      ? `${NAV_FILL.selected} text-fg`
      : "text-fg-muted hover:bg-fg/7 hover:text-fg";
  return `relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${state}`;
}

export interface RailProps {
  /** The entries above the scrolling list: the unfold button. */
  head?: ReactNode;
  /** The entries: the rail's `<nav>`, which scrolls when the window is short. */
  children?: ReactNode;
  /** Below the list: the account's avatar. */
  foot?: ReactNode;
  /** The list's accessible name, when the entries need one beyond their own. */
  label?: string;
}

export function Rail({ head, children, foot, label }: RailProps) {
  return (
    <div className="flex h-full flex-col items-center gap-1 py-2.5">
      {head}
      <nav
        {...(label !== undefined ? { "aria-label": label } : {})}
        className="mt-1 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </nav>
      {foot}
    </div>
  );
}

export interface RailItemProps {
  /** The entry's accessible name. */
  label: string;
  /** The hint beside it; the name when omitted. */
  tooltip?: string;
  /** The glyph's path, from the icon registry. */
  glyph: string;
  /** The entry is where the reader is: the selected wash (and `aria-current` on a link). */
  active?: boolean;
  /** A toggle: `aria-pressed`, and the selected wash while on. */
  pressed?: boolean;
  /** Nowhere to go right now: muted, no hover fill, not focusable. */
  disabled?: boolean;
  /** A mark on the entry's corner: an update dot, a count. */
  badge?: ReactNode;
  /** A link to this address instead of a button. */
  href?: string;
  /** With `href`: draws the link through the caller's own element (a router's). */
  renderLink?: (link: NavRowLinkProps) => ReactNode;
  onClick?: () => void;
  /** Extra classes on the entry's place in the column (`shrink-0` for a head entry). */
  className?: string;
}

export function RailItem({
  label,
  tooltip,
  glyph,
  active = false,
  pressed,
  disabled = false,
  badge,
  href,
  renderLink,
  onClick,
  className,
}: RailItemProps) {
  const classes = railItemClass({ active: active || pressed === true, disabled });
  const mark = (
    <>
      <GlyphIcon d={glyph} size={ICON_SIZE.sectionMark} />
      {badge}
    </>
  );
  let entry: ReactNode;
  if (href !== undefined && disabled) {
    entry = (
      <span role="link" aria-label={label} aria-disabled="true" className={classes}>
        {mark}
      </span>
    );
  } else if (href !== undefined) {
    const link: NavRowLinkProps = {
      href,
      className: classes,
      ...(active ? { "aria-current": "page" as const } : {}),
      "aria-label": label,
      ...(onClick !== undefined ? { onClick } : {}),
      children: mark,
    };
    entry =
      renderLink !== undefined ? (
        renderLink(link)
      ) : (
        <a
          href={href}
          aria-current={link["aria-current"]}
          aria-label={label}
          onClick={onClick}
          className={classes}
        >
          {mark}
        </a>
      );
  } else {
    entry = (
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={classes}
      >
        {mark}
      </button>
    );
  }
  return (
    <Tooltip label={tooltip ?? label} {...(className !== undefined ? { className } : {})}>
      {entry}
    </Tooltip>
  );
}

/** A hairline between two runs of entries (the pages, then an organization's channels). */
export function RailDivider() {
  return <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-line" />;
}

/**
 * The account's button at the rail's foot: the avatar, which opens the account menu. It keeps the
 * entries' 32px square as its target and draws nothing of its own around the avatar, which is the
 * pinned sidebar's tile at the sidebar's size — the two states swap outright, so a tile that
 * changed size between them would pop on every fold.
 */
export function RailAccountButton({
  label,
  expanded,
  onClick,
  buttonRef,
  children,
}: {
  label: string;
  /** The menu it opens is showing. */
  expanded: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center"
    >
      {children}
    </button>
  );
}

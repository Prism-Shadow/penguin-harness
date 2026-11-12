/**
 * One thing's card in a grid — a plugin on the Plugins page and on an Agent's settings; a model
 * or a Benchmark could wear it later. The grid card twin of `EntityHeader`: a lead mark (an icon
 * tile, an avatar) centred against the title and a one-line description, an optional note under
 * them, a facts line (`MetaLine`), a tag line, and the card's controls beside the body.
 *
 * The body is one button that opens the thing's detail: the title's button is the keyboard's way
 * in. A click elsewhere on the card's surface goes to `onBodyClick`, where the caller decides what
 * counts as the body (the web app's `lib/card-open.ts`); a press on one of the card's controls is
 * that control's alone, since the controls sit outside the body's button. The card itself is no
 * control: a control wrapped around other controls hides them from assistive technology.
 *
 * The text gives way and the lead and the controls never do: title and description truncate to one
 * line each, a cut-off line showing whole on hover (the description through the app's tooltip
 * layer, which reads the line's own text; the title shows `titleHint`, the id behind a display
 * name, when the caller gives one). The card is a size container, so an `EntityCardAction` shows
 * its word once the card is wide enough and only its glyph before that, and every control on the
 * card is one height whether it shows its word or not.
 *
 * `EntityCardGrid` lays cards two to a row once its own column has room for two, one before that —
 * on a phone, and in a narrow column on a wide screen alike: it measures the column it stands in
 * (a container query), never the viewport. Inside a grouped surface (a collapsible section) a card
 * takes `framed={false}`, as one painted card per region asks.
 *
 * Props only: every word is the caller's. Rest props land on the card's own element (a
 * `data-plugin` the page's tests read).
 */
import { createContext, useContext } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { Button } from "../../actions/button/button";
import type { ButtonVariant } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import { UpdateDot } from "../../icons/update-dot/update-dot";
import { Card } from "../../layout/card/card";
import { MetaLine } from "../meta-line/meta-line";

/** Whether an action stands in a card's row of controls, which keeps every control one height. */
const InCardActions = createContext(false);

export interface EntityCardProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  /** The surrounding group owns the surface when false (a card inside a section). */
  framed?: boolean;
  /** The thing's mark — an icon tile, an avatar — centred against the title and the description. */
  lead: ReactNode;
  title: string;
  /** The id behind a display name, on the title's hover. */
  titleHint?: string;
  /** One line under the title; a cut-off line shows whole on hover. */
  description: string;
  /** A line between the description and the facts (why a thing only partly runs). */
  note?: ReactNode;
  /** The facts line's items, in order, as an array (`MetaLine` draws the dots). Omitted: no line. */
  meta?: ReactNode;
  /** The tag line's items, keyed. Empty or omitted: no line. */
  tags?: ReactNode[];
  /** The controls beside the body (`EntityCardAction`), keyed. */
  actions?: ReactNode[];
  /** Opens the detail: the title's button, the keyboard's way in. */
  onOpen: () => void;
  /** A click on the card's own surface; the caller decides what counts as the body (lib/card-open.ts). */
  onBodyClick?: MouseEventHandler<HTMLElement>;
  /** What the card owns besides: its dialogs, an sr-only hint. */
  children?: ReactNode;
}

export function EntityCard({
  framed,
  lead,
  title,
  titleHint,
  description,
  note,
  meta,
  tags,
  actions,
  onOpen,
  onBodyClick,
  children,
  className = "",
  ...rest
}: EntityCardProps) {
  return (
    <Card
      {...rest}
      padding="md"
      {...(framed !== undefined ? { framed } : {})}
      interactive
      onClick={onBodyClick}
      className={`@container flex items-center ${ICON_GAP.card} ${className}`}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        {/* The lead centred across the title and the description, one line each. */}
        <div className={`flex items-center ${ICON_GAP.card}`}>
          <span className="flex shrink-0">{lead}</span>
          <div className="min-w-0 flex-1">
            {/* The display name in the UI font, as a title; the id behind it on hover, as code. */}
            <span
              className="block truncate text-sm font-semibold"
              {...(titleHint !== undefined
                ? { "data-tooltip": titleHint, "data-tooltip-content": "code" }
                : {})}
            >
              {title}
            </span>
            <p
              className="mt-0.5 truncate text-xs leading-5 text-fg-muted"
              data-tooltip={description}
              data-tooltip-content="text"
            >
              {description}
            </p>
          </div>
        </div>
        {note !== undefined && note !== null && (
          <p className="mt-2 text-xs text-fg-muted">{note}</p>
        )}
        {meta !== undefined && (
          <div className="mt-2.5">
            <MetaLine>{meta}</MetaLine>
          </div>
        )}
        {tags !== undefined && tags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">{tags}</div>
        )}
      </button>
      {children}
      {actions !== undefined && actions.length > 0 && (
        <InCardActions.Provider value>
          <div className="flex shrink-0 items-center justify-center gap-1.5">{actions}</div>
        </InCardActions.Provider>
      )}
    </Card>
  );
}

/**
 * Cards in a section: two to a row once the column the grid stands in has room for two (36 rem,
 * about two cards of 18 rem), one before that. The outer box is the container the grid measures.
 */
export function EntityCardGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="@container">
      <div className={`grid grid-cols-1 gap-2 p-2 @xl:grid-cols-2 ${className}`}>{children}</div>
    </div>
  );
}

export interface EntityCardActionProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children" | "title"
> {
  /** A registry path from `ICONS`. */
  glyph: string;
  /** The word: shown as `words` says, and the tooltip while it is not. */
  label: string;
  /** The accessible name when it says more than the word ("Install charts"). */
  name?: string;
  /** A hover sentence that says what the word does not. */
  hint?: string;
  /** `wide` (default): the word shows once the card is wide; `always`: at every width (a dialog's footer, a card's one main action). */
  words?: "wide" | "always";
  variant?: ButtonVariant;
  /** The press's request is in flight: the running mark stands in for the glyph, and it takes no press. */
  busy?: boolean;
  /** Something updatable is behind it: the update dot on its corner. */
  dot?: boolean;
}

/**
 * One of a card's controls, or of its detail dialog's footer: a small button with a glyph and
 * its word. On a card the word shows once the card is wide (`words="wide"`), the glyph alone
 * before that, with the word as its tooltip and in its accessible name; `words="always"` shows it
 * at every width. A `hint` says what the word does not, as a marked tooltip. `busy` swaps the
 * glyph for the running mark and holds the button (`aria-busy`); `dot` hangs the update dot on
 * its corner — the last stop on an update trail.
 */
export function EntityCardAction({
  glyph,
  label,
  name,
  hint,
  words = "wide",
  variant = "secondary",
  busy = false,
  dot = false,
  disabled,
  className = "",
  ...rest
}: EntityCardActionProps) {
  const inCard = useContext(InCardActions);
  return (
    <Button
      size="sm"
      variant={variant}
      className={`${dot ? "relative " : ""}${inCard ? "h-8 " : ""}shrink-0 ${className}`}
      aria-label={name ?? label}
      title={hint ?? label}
      {...(hint !== undefined ? { "data-tooltip-extra": true } : {})}
      {...(busy ? { "aria-busy": true } : {})}
      disabled={disabled === true || busy}
      {...rest}
    >
      {busy ? <StatusIcon state="running" /> : <GlyphIcon d={glyph} size={ICON_SIZE.iconButton} />}
      {words === "wide" ? (
        <span className="hidden @3xl:inline">{label}</span>
      ) : (
        <span>{label}</span>
      )}
      {dot && (
        <UpdateDot size="inline" position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2" />
      )}
    </Button>
  );
}

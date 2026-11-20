/**
 * A cover card: one thing in a showcase grid, led by its cover — a plugin in the market, in the
 * Web App and on the public site alike. Under the cover: the title on one line — and, in a grid
 * that gathers several sources, the card's own (`origin`: the machine it came from) on one line
 * under it — the description on two (the box holds two lines whether the text fills them or not,
 * so a row of cards lines up), then a foot: the tag line across the card's width, and under it
 * the facts with the card's controls at the line's end. The tag line never shares a line with
 * the controls, so two or three controls never squeeze it into wrapping and the feet of one grid
 * row line up.
 *
 * Two optional parts sit outside that flow. `version` is a small chip at the card's top end
 * corner, over the cover. `bar` is a row of text actions across the card's whole width under
 * everything else, in equal columns split by a line (the Web App's market: install and quick
 * start), each with an optional second line (`note`) and a hover sentence (`hint`); a disabled
 * one stays in place in muted ink. In the list layout a card with a bar keeps it under its row.
 *
 * The cover, the title and the description are one opener — a link when the host gives an
 * `href` (the public site, where the detail is a page), a button otherwise (the Web App, where
 * it is a layer over the market). The controls sit outside it: a control wrapped around other
 * controls hides them from assistive technology.
 *
 * `ShowcaseGrid` lays the cards out by the width of the column it stands in: as many columns of
 * at least 14 rem as fit, one on a phone, where a card lies down (its cover a thumbnail beside
 * its text).
 *
 * Props only: every word is the caller's. The look is showcase.css; the card is a `ui-showcase`
 * host (hooks.ts).
 */
import { useEffect, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";

/** One of a cover card's bar actions. */
export interface CoverCardBarAction {
  key: string;
  label: string;
  /** A second, smaller line under the label (who has it, where it is installed). */
  note?: string | undefined;
  /** The sentence on hover. */
  hint?: string | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

export interface CoverCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The card's cover (`Cover`, at its thumbnail rendition). */
  cover: ReactNode;
  title: string;
  /** The id behind a display name, on the title's hover. */
  titleHint?: string;
  /**
   * Where the thing comes from, when the grid gathers several sources (the market across a
   * Project's machines: the machine's name). Part of the opener, so its accessible name says it.
   */
  origin?: string;
  description: string;
  /** The tag line's items, keyed. Empty or omitted: no line. */
  tags?: ReactNode[];
  /** One line of facts under the tags (author, version, status). */
  meta?: ReactNode;
  /** The card's controls, keyed, at the end of the facts' line. */
  actions?: ReactNode[];
  /** The version as the caller writes it (`v1.2.0`), in a chip at the card's top end corner. */
  version?: string;
  /** Text actions in a bar across the card's whole width, under everything else. */
  bar?: readonly CoverCardBarAction[];
  /** Where the detail is, when it is a page; the opener is then a link. */
  href?: string;
  /** Opens the detail: the button's press, or the link's click (the host may route it). */
  onOpen?: (event: MouseEvent<HTMLElement>) => void;
  /** What the card owns besides: its dialogs. */
  children?: ReactNode;
}

export function CoverCard({
  cover,
  title,
  titleHint,
  origin,
  description,
  tags,
  meta,
  actions,
  version,
  bar,
  href,
  onOpen,
  children,
  className = "",
  ...rest
}: CoverCardProps) {
  const inner = (
    <>
      {cover}
      <span className="showcase-card-body">
        <span
          className="showcase-card-title"
          {...(titleHint !== undefined
            ? { "data-tooltip": titleHint, "data-tooltip-content": "code" }
            : {})}
        >
          {title}
        </span>
        {origin !== undefined && <span className="showcase-card-origin">{origin}</span>}
        <span className="showcase-card-desc">{description}</span>
      </span>
    </>
  );
  const hasTags = tags !== undefined && tags.length > 0;
  const hasActions = actions !== undefined && actions.length > 0;
  return (
    <article
      {...rest}
      className={`showcase showcase-card ui-showcase ${className}`}
      data-part="card"
    >
      {href !== undefined ? (
        <a href={href} onClick={onOpen} className="showcase-card-open">
          {inner}
        </a>
      ) : (
        <button type="button" onClick={onOpen} className="showcase-card-open">
          {inner}
        </button>
      )}
      {(hasTags || meta !== undefined || hasActions) && (
        <div className="showcase-card-foot">
          {hasTags && <div className="showcase-card-tags">{tags}</div>}
          {meta !== undefined && <div className="showcase-card-meta">{meta}</div>}
          {hasActions && <div className="showcase-card-actions">{actions}</div>}
        </div>
      )}
      {bar !== undefined && bar.length > 0 && (
        <div className="showcase-card-bar">
          {bar.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={action.disabled}
              // The card's title ends the name: several cards' "Install" are told apart.
              aria-label={[action.label, action.note, title].filter(Boolean).join(" · ")}
              {...(action.hint !== undefined
                ? { "data-tooltip": action.hint, "data-tooltip-content": "text" }
                : {})}
              onClick={action.onClick}
            >
              {action.label}
              {action.note && <small>{action.note}</small>}
            </button>
          ))}
        </div>
      )}
      {/* After the opener, so it paints over the cover, which is positioned itself. */}
      {version !== undefined && <span className="showcase-card-version">{version}</span>}
      {children}
    </article>
  );
}

export type ShowcaseLayout = "cards" | "list";

/** Keep the chosen layout on this browser. A public site's first render must also work on the server. */
export function useShowcaseLayout(storageKey: string) {
  const [layout, setLayout] = useState<ShowcaseLayout>("cards");
  useEffect(() => {
    try {
      setLayout(localStorage.getItem(storageKey) === "list" ? "list" : "cards");
    } catch {
      // The control still works when the browser disallows storage.
    }
  }, [storageKey]);
  const chooseLayout = (next: ShowcaseLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // This visit retains the choice.
    }
  };
  return [layout, chooseLayout] as const;
}

/** The same cards and actions in a responsive grid or a compact one-column list. */
export function ShowcaseGrid({
  children,
  className = "",
  layout = "cards",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { layout?: ShowcaseLayout }) {
  return (
    <div {...rest} className={`showcase showcase-grid ${className}`} data-layout={layout}>
      {children}
    </div>
  );
}

/** A cover card's placeholder while a list is read: the same box, nothing in it. */
export function CoverCardSkeleton() {
  return (
    <div className="showcase showcase-card" data-part="card" aria-hidden>
      <div className="showcase-card-open">
        <div className="showcase-cover" data-part="cover" data-state="loading" data-hue="slate" />
        <span className="showcase-card-body">
          <span className="showcase-skeleton" style={{ width: "45%" }} />
          <span className="showcase-skeleton" style={{ width: "85%", marginTop: "0.5rem" }} />
          <span className="showcase-skeleton" style={{ width: "60%", marginTop: "0.375rem" }} />
        </span>
      </div>
    </div>
  );
}

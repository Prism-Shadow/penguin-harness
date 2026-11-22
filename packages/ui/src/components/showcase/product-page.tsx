/**
 * A product page's parts: how one thing of a showcase presents itself in full — a plugin's
 * detail in the Web App (a layer over the market) and its page on the public site.
 *
 * - `ProductHero`: the name, the one line, the tags, the actions and a line of facts beside the
 *   cover at its full rendition. On a narrow column the cover leads and the text follows.
 * - `ProductGallery`: the screenshots, one row that scrolls sideways and snaps; each opens large
 *   (the host decides how: a lightbox in the app, the picture itself on the site).
 * - `ProductSection`: a titled, ruled section — what it does, what it installs, how to start,
 *   the README.
 * - `ProductParts`: what the thing installs, one ruled row each: a mark, the name, its kind, a
 *   line of description, and an action where the host has one (open a workbench).
 * - `ProductPrompt`: the quick start's prompt, set apart as something to send, with the action
 *   that sends or copies it.
 * - `ProductColumns`: the sections beside a narrow column of facts, which drops under them on a
 *   narrow page.
 *
 * Structure and look only (showcase.css): every word, mark and control is the caller's. The
 * hero is a `ui-showcase` host (hooks.ts); the other parts name themselves in `data-part`.
 */
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";

export interface ProductHeroProps {
  /** The cover at its full rendition (`Cover`). */
  cover: ReactNode;
  /** The thing's own mark beside its name (an icon tile). */
  lead?: ReactNode;
  /** A small line over the name: where it comes from, or that it is selected. */
  eyebrow?: ReactNode;
  title: string;
  /** The id behind a display name (the package), under the name in code type. */
  subtitleCode?: string;
  /** The one line. */
  tagline: string;
  tags?: ReactNode[];
  /** The primary action first. */
  actions?: ReactNode;
  /** One line of facts: version, author, licence. */
  facts?: ReactNode;
  /** The heading's level: 1 on a page of its own, 2 inside a dialog that is already titled. */
  level?: 1 | 2;
  /** The heading's id, for the dialog it names. */
  titleId?: string;
}

export function ProductHero({
  cover,
  lead,
  eyebrow,
  title,
  subtitleCode,
  tagline,
  tags,
  actions,
  facts,
  level = 1,
  titleId,
}: ProductHeroProps) {
  const Title = level === 1 ? "h1" : "h2";
  return (
    <header className="showcase showcase-product-hero ui-showcase" data-part="product-hero">
      <div className="showcase-product-grid">
        <div className="showcase-product-text">
          {eyebrow !== undefined && <p className="showcase-eyebrow">{eyebrow}</p>}
          <div className="showcase-product-heading">
            {lead}
            <div className="showcase-product-names">
              <Title id={titleId} className="showcase-product-title">
                {title}
              </Title>
              {subtitleCode !== undefined && (
                <p className="showcase-product-code">{subtitleCode}</p>
              )}
            </div>
          </div>
          <p className="showcase-product-tagline">{tagline}</p>
          {tags !== undefined && tags.length > 0 && (
            <div className="showcase-card-tags">{tags}</div>
          )}
          {actions !== undefined && <div className="showcase-product-actions">{actions}</div>}
          {facts !== undefined && <div className="showcase-product-facts">{facts}</div>}
        </div>
        <div className="showcase-product-media">{cover}</div>
      </div>
    </header>
  );
}

export interface ProductShot {
  /** The picture at full size: what opens. */
  src: string;
  /** The small rendition the row draws; absent, the row draws `src`. */
  thumb?: string;
  /** What the picture shows: its alternative text, and its caption when `caption` is absent. */
  alt: string;
  caption?: string;
}

export function ProductGallery({
  shots,
  label,
  onOpen,
}: {
  shots: readonly ProductShot[];
  /** The row's accessible name ("Screenshots"). */
  label: string;
  /** Opens a shot large; without it each shot is a link to its picture. */
  onOpen?: (index: number, event: MouseEvent<HTMLElement>) => void;
}) {
  if (shots.length === 0) return null;
  return (
    <ul className="showcase showcase-gallery" data-part="gallery" aria-label={label}>
      {shots.map((shot, i) => {
        const picture = (
          <img
            src={shot.thumb ?? shot.src}
            alt={shot.alt}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        );
        return (
          <li key={shot.src} className="showcase-gallery-item">
            {onOpen !== undefined ? (
              <button type="button" className="showcase-gallery-open" onClick={(e) => onOpen(i, e)}>
                {picture}
              </button>
            ) : (
              <a className="showcase-gallery-open" href={shot.src} target="_blank" rel="noreferrer">
                {picture}
              </a>
            )}
            {shot.caption !== undefined && (
              <p className="showcase-gallery-caption">{shot.caption}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ProductSection({
  title,
  actions,
  level = 2,
  children,
  className = "",
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  /** Controls at the end of the title row. */
  actions?: ReactNode;
  level?: 2 | 3;
}) {
  const Title = level === 2 ? "h2" : "h3";
  return (
    <section {...rest} className={`showcase showcase-section ${className}`} data-part="section">
      <div className="showcase-section-head">
        <Title className="showcase-section-title">{title}</Title>
        {actions !== undefined && <div className="showcase-section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export interface ProductPart {
  key: string;
  /** The part's mark: its kind's glyph, or its own icon. */
  mark: ReactNode;
  name: string;
  /** What kind of part it is, in a word ("Skill", "Workbench"). */
  kind: string;
  description?: string;
  /** What the reader can do with it here (open a workbench). */
  action?: ReactNode;
}

export function ProductParts({ parts }: { parts: readonly ProductPart[] }) {
  return (
    <ul className="showcase showcase-parts" data-part="parts">
      {parts.map((part) => (
        <li key={part.key} className="showcase-part">
          <span className="showcase-part-mark">{part.mark}</span>
          <div className="showcase-part-text">
            <p className="showcase-part-name">
              <span>{part.name}</span>
              <span className="showcase-part-kind">{part.kind}</span>
            </p>
            {part.description !== undefined && (
              <p className="showcase-part-desc">{part.description}</p>
            )}
          </div>
          {part.action !== undefined && <span className="showcase-part-action">{part.action}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ProductPrompt({
  prompt,
  note,
  action,
}: {
  /** The prompt, as it will be sent. */
  prompt: string;
  /** One quiet line under it (which Skills it selects). */
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="showcase showcase-prompt" data-part="prompt">
      <p className="showcase-prompt-text">{prompt}</p>
      {(note !== undefined || action !== undefined) && (
        <div className="showcase-prompt-foot">
          <div className="showcase-prompt-note">{note}</div>
          {action}
        </div>
      )}
    </div>
  );
}

export function ProductColumns({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="showcase showcase-columns" data-part="columns">
      <div className="showcase-columns-grid">
        <div className="showcase-columns-main">{children}</div>
        {aside !== undefined && <aside className="showcase-columns-aside">{aside}</aside>}
      </div>
    </div>
  );
}

/** The facts beside a product page: label and value pairs, ruled. */
export function ProductFacts({
  facts,
}: {
  facts: ReadonlyArray<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="showcase showcase-facts" data-part="facts">
      {facts.map((fact) => (
        <div key={fact.label} className="showcase-fact">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The head of a detail page or dialog about one thing — an agent, a plugin, a model, a
 * Benchmark: its mark (an avatar, a logo, an icon tile), its name as the heading, the facts that
 * sit on the name's line (a version, an id with its copy button), a description under it, and
 * the actions that act on the whole thing at the end.
 *
 * The name is a heading on its level's rung. An identifier-shaped name is still a name: set it in
 * the heading's face and put the raw id in `meta`, where it may be mono — a heading never is.
 */
import type { ReactNode } from "react";
import { Heading } from "../../content/typography/typography";

export interface EntityHeaderProps {
  /** The thing's mark, before everything else. */
  media?: ReactNode;
  name: ReactNode;
  /** The name's outline level and rung: 1 on a detail page (the default), 2 in a dialog. */
  level?: 1 | 2 | 3;
  /** Facts on the name's line, baseline-aligned after it. */
  meta?: ReactNode;
  /** A sentence or two under the name. */
  description?: ReactNode;
  /** Actions on the whole thing, at the end of the header. */
  actions?: ReactNode;
  /** More rows under the description: a row of badges, the hook points a plugin answers at. */
  children?: ReactNode;
  className?: string;
}

export function EntityHeader({
  media,
  name,
  level = 1,
  meta,
  description,
  actions,
  children,
  className = "",
}: EntityHeaderProps) {
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      {media !== undefined && <div className="flex shrink-0 items-center">{media}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Heading level={level} className="min-w-0 [overflow-wrap:anywhere]">
            {name}
          </Heading>
          {meta !== undefined && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">{meta}</span>
          )}
        </div>
        {description !== undefined && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        {children !== undefined && <div className="mt-2">{children}</div>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

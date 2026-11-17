/**
 * A facts line: a thing's short facts in a row — a version, a status mark, a count — a middle dot
 * between each, held on one line, since a wrapped line would strand a dot at its edge. It sits
 * under a card's title (`EntityCard`) and in a detail dialog's header.
 *
 * The items are the line's flex children, in the order given; null, undefined and false items
 * are skipped, dot and all. An item that may run long (a count of agents) brings its own
 * `min-w-0 truncate`, and the rest keep `shrink-0`, so the long one gives way first and the line
 * never asks its container for more room than it has.
 *
 * Props only: the items are the caller's.
 */
import { Fragment } from "react";
import type { ReactNode } from "react";

export function MetaLine({ children }: { children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false,
  );
  return (
    <div className="flex min-w-0 items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs text-fg-muted">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden className="shrink-0">
              ·
            </span>
          )}
          {item}
        </Fragment>
      ))}
    </div>
  );
}

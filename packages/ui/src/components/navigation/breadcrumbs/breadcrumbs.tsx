/**
 * Breadcrumbs: a path on one row that never wraps — the Files panel's header names the open file
 * or folder this way. When the path outgrows the row, its leading items collapse into a single
 * "…" (crumb-fit.ts decides how many fit, from the strip's own measured width), so whatever
 * shares the row keeps its place. The last item is where the path ends and outranks the rest: it
 * does not shrink, so the items before it give way first, and when it alone outruns the strip its
 * stem ellipsizes while its extension stays.
 *
 * The strip measures the space it is given, never its own content: give it `flex-1` (a zero
 * basis) beside the row's other controls, and it reports the width they leave over, with no
 * feedback loop. Until the first measurement it shows the whole path — a "…" for one frame on a
 * path that fits would read as a flicker.
 *
 * An item with `onClick` is a button that goes there; without, the item is read out and nothing
 * more — the Files panel's path is not navigable, because the tree beside it is what navigates.
 * `title` is the strip's tooltip: the whole path, however much of it is on screen.
 */
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { CRUMB_ELLIPSIS, crumbItemWidth, splitFileName, visibleCrumbSegments } from "./crumb-fit";

export interface BreadcrumbItem {
  label: string;
  /** Go to this item; omitted, the item is text. */
  onClick?: () => void;
}

export function Breadcrumbs({
  items,
  title,
  className = "",
}: {
  items: readonly BreadcrumbItem[];
  /** The strip's tooltip — the whole path. */
  title?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = visibleCrumbSegments(
    items.map((item) => item.label),
    width > 0 ? width : Number.POSITIVE_INFINITY,
    crumbItemWidth,
  );
  // The fit keeps a tail, so the items on screen are the last `visible.length` of them.
  const shown = items.slice(items.length - fit.visible.length);

  return (
    <div
      ref={ref}
      data-tooltip={title}
      className={`flex min-w-0 items-center gap-1 overflow-hidden px-1 text-sm ${className}`}
    >
      {fit.collapsed && <span className="shrink-0 text-fg-subtle">{CRUMB_ELLIPSIS}</span>}
      {shown.map((item, i) => {
        const last = i === shown.length - 1;
        const text = last ? (
          // The stem gives way before the extension, which says what kind of file this is.
          <span className="flex min-w-0 max-w-full shrink-0 items-center font-medium text-fg">
            <span className="min-w-0 truncate">{splitFileName(item.label).stem}</span>
            <span className="shrink-0">{splitFileName(item.label).ext}</span>
          </span>
        ) : (
          <span className="min-w-0 shrink truncate text-fg-muted">{item.label}</span>
        );
        return (
          <Fragment key={`${i}-${item.label}`}>
            {(fit.collapsed || i > 0) && <span className="shrink-0 text-line-emphasis">/</span>}
            {item.onClick === undefined ? (
              text
            ) : (
              <button
                type="button"
                onClick={item.onClick}
                className={`flex min-w-0 items-center rounded-sm transition-colors duration-150 hover:text-fg ${last ? "max-w-full shrink-0" : "shrink"}`}
              >
                {text}
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

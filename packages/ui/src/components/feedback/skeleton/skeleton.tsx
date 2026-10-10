/**
 * Loading placeholders shaped like what is coming: a line, a list of rows, a card. Each shares the
 * border, radius and fill of the real container it stands in for, so nothing shifts when the data
 * arrives. The blocks pulse gently while they wait — this file is where a placeholder's pulse
 * lives — and are hidden from assistive technology: the region they sit in announces loading,
 * a grey bar has nothing to say.
 */
import type { ReactNode } from "react";

/** One placeholder block; `className` sets its size (a line of text by default). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={`animate-pulse rounded-sm bg-line ${className ?? "h-4 w-full"}`} />
  );
}

/** A list loading: `rows` row-height blocks. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/**
 * A card loading: the real card's border and radius around a title, a main value and a subline,
 * or the caller's own inner layout. `className` replaces the default `p-4` outright — two
 * utilities for one property resolve by stylesheet order, not by position in the string — so a
 * caller that passes one includes its padding.
 */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-md border border-line bg-surface ${className ?? "p-4"}`}>
      {children ?? (
        <>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2.5 h-6 w-28" />
          <Skeleton className="mt-2.5 h-3 w-24" />
        </>
      )}
    </div>
  );
}

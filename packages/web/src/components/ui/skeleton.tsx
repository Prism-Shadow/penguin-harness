/**
 * Skeleton screen component (list and detail views use
 * skeleton screens while loading).
 * Placeholder blocks share the same border/rounding/background as the real
 * container, giving zero layout shift from "loading" to "loaded" (matching the
 * LangSmith-style feel of pre-loading placeholders shaped like the real layout).
 */
import type { ReactNode } from "react";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className ?? "h-4 w-full"}`}
    />
  );
}

/** Multi-row skeleton (placeholder for list loading). */
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
 * Card skeleton: same border/rounding as a real card; defaults to a three-part
 * placeholder (title + main value + subline), and children can override the
 * inner layout. className fully replaces the default p-4 (when Tailwind classes
 * for the same property coexist, which one wins depends on stylesheet order, so
 * appending an override is unreliable) — when passing className, include padding
 * as well.
 */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 ${className ?? "p-4"}`}
    >
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

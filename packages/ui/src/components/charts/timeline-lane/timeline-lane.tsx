/**
 * A horizontally scrollable lane chart. Labels stay pinned on a transparent column; plots are
 * clipped at that column's edge so scrolled bars and ticks cannot paint underneath the words.
 */
import type { HTMLAttributes, ReactNode, Ref } from "react";

export function TimelineViewport({
  onScroll,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      {...props}
      className={`no-scrollbar overflow-x-auto overflow-y-hidden ${className}`}
      onScroll={(event) => {
        event.currentTarget.style.setProperty(
          "--timeline-scroll-offset",
          `${event.currentTarget.scrollLeft}px`,
        );
        onScroll?.(event);
      }}
    />
  );
}

export function TimelineLane({
  label,
  axis = false,
  children,
}: {
  label?: string;
  /** Axis ticks share the label column and clipping, without the lane's track fill. */
  axis?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center">
      <span
        data-timeline-label
        data-tooltip={label}
        data-tooltip-content="text"
        className="sticky left-0 z-10 flex h-4 w-[5.5rem] shrink-0 items-center justify-end pr-2 text-fg-muted"
      >
        <span className="truncate font-mono text-xs">{label}</span>
      </span>
      <div
        data-part={axis ? undefined : "grid"}
        data-timeline-plot
        className={`relative h-4 min-w-0 flex-1 overflow-hidden [clip-path:inset(0_0_0_var(--timeline-scroll-offset,0px))] ${axis ? "" : "bg-fg/5"}`}
      >
        {children}
      </div>
    </div>
  );
}

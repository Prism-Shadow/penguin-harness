import type { ReactNode } from "react";

export function GroupBlock({
  dropEdge,
  children,
}: {
  /** Which edge of this group a drop would land on while a group drag hovers it. */
  dropEdge: "above" | "below" | null;
  children: ReactNode;
}) {
  return (
    <div className="relative pt-2.5">
      {dropEdge !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent ${
            dropEdge === "above" ? "top-1" : "-bottom-1"
          }`}
        />
      )}
      {children}
    </div>
  );
}

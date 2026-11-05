/**
 * The Machines page's list: one column of machine cards, this server first, with the gap the
 * Agents list keeps between cards. While the list is loading it holds card-shaped placeholders in
 * the card's own band (an info column of three lines beside the buttons), so nothing moves when
 * the cards arrive; `empty` follows the cards when there is nothing else to list.
 */
import type { ReactNode } from "react";
import { Skeleton, SkeletonCard } from "../../feedback/skeleton/skeleton";

export interface MachineListProps {
  /** The cards. */
  children?: ReactNode;
  /** What follows the cards when no machine is in use besides this server (an empty state). */
  empty?: ReactNode;
  /** The list has not been read yet: placeholders stand in for the cards. */
  loading?: boolean;
}

/** How many placeholder cards stand in while the list loads. */
const PLACEHOLDERS = 3;

export function MachineList({ children, empty = null, loading = false }: MachineListProps) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: PLACEHOLDERS }, (_, i) => (
          <SkeletonCard key={i} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <div className="min-w-[14rem] flex-1">
              <Skeleton className="h-[18px] w-40" />
              <Skeleton className="mt-1.5 h-4 w-2/3" />
              <Skeleton className="mt-1.5 h-4 w-48" />
            </div>
            <Skeleton className="h-8 w-40" />
          </SkeletonCard>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {children}
      {empty}
    </div>
  );
}

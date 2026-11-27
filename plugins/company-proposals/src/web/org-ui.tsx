/**
 * The page primitives the organization pages share: the UI package's page frame and header at
 * the organization pages' width, and the one quiet line an empty section shows — so every page
 * here draws one frame and one header row instead of each drawing its own.
 */
import type { ReactNode } from "react";
import { PageFrame, PageHeader, Skeleton } from "@prismshadow/penguin-ui";

/**
 * The page every organization page is: the package's page frame at the organization pages'
 * width, with its header — the page title, its "?" (the page's semantics, disclosed on
 * request) and the header actions on one row — and the content below.
 */
export function OrgPage({
  title,
  heading,
  info,
  actions,
  wide = false,
  children,
}: {
  title: string;
  /** What the heading shows when it is more than the plain title (a title with its changes marked); `title` still names the "?". */
  heading?: ReactNode;
  info?: string;
  actions?: ReactNode;
  /** Board-shaped pages take the whole width; the rest read better in a column. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <PageFrame width={wide ? "full" : "xl"}>
      <PageHeader title={heading ?? title} info={info} actions={actions} />
      {children}
    </PageFrame>
  );
}

/** A section with nothing to list: one quiet line where the rows would be. */
export function OrgEmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-1 text-xs text-gray-400 dark:text-gray-500">{children}</p>;
}

/** A page still fetching: placeholder bands where its header and sections will be. */
export function OrgPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-20" />
      <Skeleton className="h-24" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

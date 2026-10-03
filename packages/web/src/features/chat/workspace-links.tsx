/**
 * Makes the links in the Markdown below Workspace-aware: a link naming a file of `workspace` opens
 * it through `onOpenFile` (the Files panel) instead of a new tab — see lib/reply-link.ts for how an
 * href is sorted. With no `onOpenFile` the links keep the package's default, a new tab for every
 * link.
 *
 * Only a conversation provides it (MessageStream); every other surface — Memory, the handbook,
 * tickets — renders without it and keeps a new tab for every link. The resolver is memoized on its
 * two inputs: a context change re-renders every link in the transcript, memoized message bodies
 * included, so `onOpenFile` has to be a stable callback.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { ProseLinksProvider } from "@prismshadow/penguin-ui";
import type { ProseLinkResolver } from "@prismshadow/penguin-ui";
import { replyLinkBehavior } from "../../lib/reply-link";

export function WorkspaceLinksProvider({
  workspace,
  onOpenFile,
  children,
}: {
  workspace: string | null;
  onOpenFile: ((path: string) => void) | undefined;
  children: ReactNode;
}) {
  const resolve = useMemo<ProseLinkResolver | null>(
    () =>
      onOpenFile === undefined
        ? null
        : (href) => replyLinkBehavior(href, { workspace, openFile: onOpenFile }),
    [workspace, onOpenFile],
  );
  return <ProseLinksProvider resolve={resolve}>{children}</ProseLinksProvider>;
}

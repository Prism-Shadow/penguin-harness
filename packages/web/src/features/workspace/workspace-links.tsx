/**
 * Makes the links in the Markdown below Workspace-aware: a link naming a file of `workspace`
 * opens it through `onOpenFile` (the Files panel) instead of a new tab, and a link to an
 * internal route (`/chat/<sessionId>`, `/org…`) navigates through the app's Router — the
 * `navigate` the conversation hands down, so the history entry and the unsaved-form guard are
 * the Router's own. See lib/reply-link.ts for how an href is sorted.
 *
 * Only a conversation provides it (MessageStream); every other surface — Memory, the handbook,
 * tickets — renders without it and keeps a new tab for every link. The resolver is memoized on
 * its three inputs: a context change re-renders every link in the transcript, memoized message
 * bodies included, so the callbacks have to be stable.
 */
import { useMemo, type ReactNode } from "react";

import { ProseLinksProvider, type ProseLinkResolver } from "@prismshadow/penguin-ui";

import { replyLinkBehavior } from "../../lib/reply-link";

export function WorkspaceLinksProvider({
  workspace,
  onOpenFile,
  navigate,
  children,
}: {
  workspace: string | null;
  onOpenFile: ((path: string) => void) | undefined;
  navigate: (to: string) => void;
  children: ReactNode;
}) {
  const resolve = useMemo<ProseLinkResolver | null>(
    () =>
      (href) =>
        replyLinkBehavior(href, { workspace, openFile: onOpenFile, openRoute: navigate }),
    [workspace, onOpenFile, navigate],
  );
  return <ProseLinksProvider resolve={resolve}>{children}</ProseLinksProvider>;
}

/**
 * Draws the Workspace files a reply links below the paragraph that links them: the server's file
 * renderer rules (lib/file-renderers.ts) joined with this build's named renderers (the chat
 * module's `fileRenderers` slot) and the open conversation's Workspace, handed to the reply's
 * Markdown as a block trailer (the UI package's ProseBlockTrailerProvider). The Markdown is not
 * changed: a link stays a link and keeps its click.
 *
 * Two parts, because the trailer is built where the chat page's state is and applied where a
 * reply is drawn: `ReplyFilesProvider` sits in the chat page's ChatSessionProvider and builds it
 * once per conversation; `ReplyTrailer` wraps an assistant reply's body only — reasoning and
 * compaction summaries are not replies. Outside the chat page (a test rendering the stream alone)
 * nothing is provided and a reply renders as it always has.
 *
 * Every nested reply (a subagent's) shares the conversation's Workspace, so its files are fetched
 * through the conversation's own Session.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { ProseBlockTrailerProvider, type ProseBlockTrailer } from "@prismshadow/penguin-ui";

import * as api from "../../api/endpoints";
import { ChatSessionContext } from "../../lib/chat-session";
import { useFileRendererRules } from "../../lib/file-renderers";
import { chatDeps } from "./deps";
import { replyFilesOf } from "./reply-files";

const ReplyTrailerContext = createContext<ProseBlockTrailer | null>(null);

export function ReplyFilesProvider({ children }: { children: ReactNode }) {
  const rules = useFileRendererRules();
  const { fileRenderers: registry } = chatDeps.useDeps();
  const selected = useContext(ChatSessionContext)?.selected ?? null;
  const sessionId = selected?.sessionId ?? null;
  const workspace = selected?.workspace ?? null;
  // Built from values, not from the session object (a fresh one every render): a new trailer
  // re-renders every paragraph of the transcript.
  const trailer = useMemo<ProseBlockTrailer | null>(() => {
    if (sessionId === null || rules.length === 0) return null;
    const input = {
      workspace,
      rules,
      registry,
      urlOf: (path: string) => api.workspaceFileUrl(sessionId, path),
    };
    return (hrefs) => {
      const files = replyFilesOf(hrefs, input);
      if (files.length === 0) return null;
      return (
        <div data-reply-files className="my-2 flex flex-col gap-2">
          {files.map(({ path, name, url, Renderer }) => (
            <Renderer key={path} url={url} path={path} name={name} />
          ))}
        </div>
      );
    };
  }, [sessionId, workspace, rules, registry]);
  return <ReplyTrailerContext.Provider value={trailer}>{children}</ReplyTrailerContext.Provider>;
}

/** Applies the conversation's trailer to the reply body below. */
export function ReplyTrailer({ children }: { children: ReactNode }) {
  const trailer = useContext(ReplyTrailerContext);
  return <ProseBlockTrailerProvider trailer={trailer}>{children}</ProseBlockTrailerProvider>;
}

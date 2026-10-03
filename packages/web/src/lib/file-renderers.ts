/**
 * File renderers: how a kind of Workspace file is drawn where a reply links it. Two halves meet
 * here, which is why this is a library rather than an export of either side:
 *
 * - the RULES — which extensions take which renderer — are server contributions, state of the
 *   signed-in session: WebApp's one consumer of /api/contributions validates them and provides
 *   them (web-app/contributions.tsx); safe mode leaves them empty;
 * - the RENDERERS a rule may name are this build's own registry: components web modules bind to
 *   the chat module's `fileRenderers` slot under a name (features/chat/iface.ts), `audio` first.
 *
 * The conversation joins the two (features/chat/reply-files-provider.tsx).
 */
import { createContext, useContext, type ComponentType } from "react";

/** What a file renderer is handed: the file's URL, its Workspace-relative path, and its name. */
export interface FileRendererProps {
  url: string;
  path: string;
  name: string;
}

export type FileRenderer = ComponentType<FileRendererProps>;

/** One validated rule: files with one of these extensions (lowercase, no dot) take this builtin. */
export interface FileRendererRule {
  id: string;
  extensions: readonly string[];
  builtin: string;
}

const NO_RULES: readonly FileRendererRule[] = [];

export const FileRendererRulesContext = createContext<readonly FileRendererRule[]>(NO_RULES);

/** A React hook: the signed-in session's file renderer rules, in the server's order. */
export function useFileRendererRules(): readonly FileRendererRule[] {
  return useContext(FileRendererRulesContext);
}

/**
 * The stream-driven JUMP COMMANDS the dock's panel bodies consume: open a Workspace file, land
 * on a memory, focus a subagent and pin its Task. Each is a fresh object per call
 * (identity-compared, so repeating the same jump still re-triggers the view's effect), and each
 * resets on a Session switch, and when its panel's tab closes.
 */
import { useCallback, useEffect, useState } from "react";
import type { MemoryLocateTarget } from "../../../lib/omni/memory-changes";
import { openPanel, panelDock } from "../../dock";

export function usePanelRequests(routeSessionId: string | null) {
  /** Workspace tab: locate this file in the tree (a message file card's click, or a reply's link to a file). */
  const [fileOpenRequest, setFileOpenRequest] = useState<{ path: string } | null>(null);
  /**
   * Brings the Workspace tab up on a Workspace-relative path. Both callers have already
   * normalized the text they hold (toWorkspaceRelative strips an absolute prefix and converts
   * Windows separators). Stable on purpose: every link rendered in the transcript reads it
   * through context, so a fresh function per render would re-render them all on every frame.
   */
  const openWorkspaceFile = useCallback((path: string) => {
    openPanel("workspace");
    setFileOpenRequest({ path });
  }, []);
  /** Memory tab: land on this memory's detail (a card row), or the list (null target). */
  const [memoryRequest, setMemoryRequest] = useState<{
    target: MemoryLocateTarget | null;
  } | null>(null);
  /** Agents tab: select this child conversation (a subagent chip's click; the chain ends with the child's own id). */
  const [subagentFocus, setSubagentFocus] = useState<{
    sessionId: string;
    origin: string[];
  } | null>(null);
  /**
   * Which Task's topology the agents tab displays. Null = the LATEST Task; a chip click
   * pins the graph to the Task containing that chip instead — `anchorSessionId` is the
   * clicked child's TOP-LEVEL ancestor, which the view resolves to its Task slice.
   */
  const [subagentTaskScope, setSubagentTaskScope] = useState<{
    anchorSessionId: string;
  } | null>(null);
  useEffect(() => {
    setFileOpenRequest(null);
    setMemoryRequest(null);
    setSubagentFocus(null);
    setSubagentTaskScope(null);
  }, [routeSessionId]);
  // A command also resets when its panel's TAB closes: the tab body unmounts with the tab,
  // so a re-added tab is a fresh mount that would otherwise replay the stale command —
  // reopening the Workspace would re-locate a long-clicked file, and reopening the agents
  // tab would come back pinned to an old Task instead of the latest.
  const workspaceTabExists = panelDock("workspace") !== null;
  const memoryTabExists = panelDock("memory") !== null;
  const agentsTabExists = panelDock("agents") !== null;
  useEffect(() => {
    if (!workspaceTabExists) setFileOpenRequest(null);
  }, [workspaceTabExists]);
  useEffect(() => {
    if (!memoryTabExists) setMemoryRequest(null);
  }, [memoryTabExists]);
  useEffect(() => {
    if (!agentsTabExists) {
      setSubagentFocus(null);
      setSubagentTaskScope(null);
    }
  }, [agentsTabExists]);
  return {
    fileOpenRequest,
    openWorkspaceFile,
    memoryRequest,
    setMemoryRequest,
    subagentFocus,
    setSubagentFocus,
    subagentTaskScope,
    setSubagentTaskScope,
  };
}

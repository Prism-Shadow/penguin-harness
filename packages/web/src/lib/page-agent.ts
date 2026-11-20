/**
 * The Agent the page on screen works under, where the page knows better than the Project's
 * current Agent: the chat page renders under its conversation's own Agent, and a conversation on
 * a machine runs that machine's copy of it, which this server's Agent list never holds. The
 * sidebar's app list follows it (features/session-list/use-sidebar-apps.ts).
 *
 * A publication outlives the page that made it, as where that Agent was last seen: an app's
 * window over the main area unmounts the conversation under it, and the list must not drop the
 * machine's apps for that. Once the page is gone the publication only says where the current
 * Agent lives, so the reader takes it while the current Agent is that Agent, and the current
 * Agent on this server otherwise.
 *
 * A module-level store, like lib/running-apps.ts: the publisher is a page and the reader is the
 * sidebar, which neither contains the other.
 */
import { useSyncExternalStore } from "react";

export interface PageAgent {
  projectId: string;
  agentId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
}

export interface PublishedAgent {
  agent: PageAgent;
  /** The page that published it is still on screen. */
  live: boolean;
}

let current: PublishedAgent | null = null;
const listeners = new Set<() => void>();

function set(next: PublishedAgent | null): void {
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

/**
 * Says which Agent the page works under; the returned call says the page is gone (a later
 * publication stands: leaving an older one changes nothing).
 */
export function publishPageAgent(agent: PageAgent): () => void {
  const entry: PublishedAgent = { agent, live: true };
  set(entry);
  return () => {
    if (current === entry) set({ agent, live: false });
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

/** The latest publication, its page on screen or gone; null before any. */
export function usePageAgent(): PublishedAgent | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

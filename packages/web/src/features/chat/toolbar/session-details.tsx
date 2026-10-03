/**
 * The details card the toolbar's statistics open: the Session's Agent and Model, its id, its
 * Workspace on its machine, when it was created, its statistics, and (as children) the background
 * processes it started.
 */
import type { ReactNode } from "react";
import type { AgentSummary, SessionInfo } from "@prismshadow/penguin-server/api";
import { CopyButton } from "@prismshadow/penguin-ui";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { S } from "../../../lib/strings";
import { formatDateTime } from "../../../lib/format";
import { nameOnMachine } from "../../../lib/workspace-machines";
import { agentDisplayName } from "../../../state/project";
import type { HeaderStats } from "./session-stats";

/**
 * Session id row in the details card: the id is selectable mono text (styled like the other
 * sections' values) with the shared CopyButton beside it. The copy feedback is the button's
 * icon swapping to the check (#312, no "已复制" text) — the "Session id" label above never
 * changes.
 */
function SessionIdRow({ sessionId }: { sessionId: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {S.chat.sessionIdLabel}
      </p>
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">{sessionId}</span>
        <CopyButton text={sessionId} label={S.chat.copySessionId} size="sm" className="shrink-0" />
      </div>
    </div>
  );
}

export interface SessionDetailsProps {
  selected: SessionInfo;
  agents: readonly AgentSummary[];
  /** The ssh alias of the machine the Session is on, or null for this server's own. */
  machineName: string | null;
  hs: HeaderStats;
  /** Session Token buckets from the last usage fetch: server-recorded, they can trail the live chip mid-run. */
  usageBuckets: { cacheRead: number; cacheWrite: number; output: number } | null;
  /** The background-process section. */
  children: ReactNode;
}

export function SessionDetails({
  selected,
  agents,
  machineName,
  hs,
  usageBuckets,
  children,
}: SessionDetailsProps) {
  // Cache hit rate over the recorded input buckets (cacheRead = hits, cacheWrite =
  // uncached input) — the details card's tokens-line parenthetical. Null until a usage
  // row with any input has applied, so a fresh session shows no "0%" out of thin air.
  const recordedInput = usageBuckets ? usageBuckets.cacheRead + usageBuckets.cacheWrite : 0;
  const cacheHitRate =
    usageBuckets && recordedInput > 0
      ? `${Math.round((100 * usageBuckets.cacheRead) / recordedInput)}%`
      : null;
  // Display name of the Session's own Agent for the details card — null when the Agent has
  // no name of its own (agentDisplayName then returns the id, which the row already shows)
  // or when the Agent list hasn't arrived yet.
  const sessionAgent = agents.find((a) => a.agentId === selected.agentId);
  const sessionAgentName =
    sessionAgent && sessionAgent.name !== undefined ? agentDisplayName(sessionAgent) : null;
  return (
    <div className="space-y-3 px-3.5 py-2.5 text-sm">
      {/* Agent, above the Model: a conversation belongs to an Agent first, and the
          Model it runs on is one of that Agent's settings. Paired the same way as the
          Model row — the id the API speaks, then the display name, which is dropped
          when the Agent has none of its own and the two would simply repeat. */}
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.agent}</p>
        <p className="truncate text-xs">
          <span className="font-mono">{selected.agentId}</span>
          {sessionAgentName !== null && (
            <span className="ml-1.5 text-gray-400 dark:text-gray-500">{sessionAgentName}</span>
          )}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.model}</p>
        {/* Paired display: upstream model_id + provider name (two separate fields on the Session DTO). */}
        <p className="truncate text-xs">
          <span className="font-mono">{selected.modelId}</span>
          <span className="ml-1.5 text-gray-400 dark:text-gray-500">
            {providerInfo(selected.provider)?.label ?? selected.provider}
          </span>
        </p>
      </div>
      <SessionIdRow sessionId={selected.sessionId} />
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.workspace}</p>
        {/* The machine too: a path names a directory only together with the
            filesystem it is on, and the same path exists on more than one of them. */}
        <p className="break-all font-mono text-xs leading-5">
          {nameOnMachine(selected.workspace, machineName)}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.common.created}</p>
        <p className="font-mono text-xs">{formatDateTime(selected.createdAt)}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {S.chat.sessionStats}
        </p>
        {/* A bulleted list, one stat per line. The tokens bullet carries the cache
            hit rate in parentheses (cacheRead ÷ all recorded input); the rate comes
            from the usage fetch, so it can trail the live total mid-run and
            reconciles on idle. No-cost sessions omit the cost bullet entirely, as
            the chip does. */}
        <ul className="list-inside list-disc space-y-1 font-mono text-xs">
          <li>
            {S.chat.statTotalTokens} {hs.tokensText}
            {cacheHitRate !== null &&
              `${S.chat.statParenOpen}${S.chat.statCacheHit(cacheHitRate)}${S.chat.statParenClose}`}
          </li>
          {hs.costText != null && (
            <li>
              {S.common.cost} {hs.costText}
              {hs.costUncosted ? " *" : ""}
            </li>
          )}
          <li>
            {S.chat.statElapsed} {hs.elapsedNode}
            {hs.elapsedSplit}
          </li>
        </ul>
      </div>
      {/* Background processes the conversation started (e.g. a dev server on
          localhost:3000): live rows carry a stop button — the kill signals the whole
          process group and the row drops on the follow-up refresh; exited rows keep
          their "exited" label and carry a remove button that deletes the entry from
          the list (#312), and the heading carries one action removing every exited
          row at once. A command too long for its row shows whole in a tooltip. Hidden
          entirely while there are none. */}
      {children}
    </div>
  );
}

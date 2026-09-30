/**
 * The registered penguin servers on the PR graph page: a mark on the row of the layer each
 * server's commit sits on (company-proposals servers.ts places them; the page draws what it
 * was given), and the servers on no layer listed under the graph with their commit or the
 * reason it could not be read.
 */
import type { ProposalGraphServer } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_GAP } from "../../lib/icon-scale";
import { toneSurface } from "../../lib/tone";
import { OrgSection } from "../company/org-layout";

/** The marks of the servers on one layer (0 = the base branch); nothing when none sits there. */
export function ServerMarks({
  servers,
  at,
}: {
  servers: readonly ProposalGraphServer[] | undefined;
  at: number;
}) {
  const t = S.company.proposals.graph;
  const here = (servers ?? []).filter((s) => s.at === at);
  return (
    <>
      {here.map((s) => (
        <span
          key={s.name}
          title={t.serverTitle(s.name, s.commit ?? "", s.describe, s.ahead)}
          className={`shrink-0 rounded px-1 font-mono text-[10px] font-medium ${toneSurface.link}`}
        >
          @{s.name}
          {s.relation === "ahead" && s.ahead !== null ? ` +${s.ahead}` : ""}
        </span>
      ))}
    </>
  );
}

/** The servers the graph could not place, under it. */
export function ServersOff({ servers }: { servers: readonly ProposalGraphServer[] | undefined }) {
  const t = S.company.proposals.graph;
  const off = (servers ?? []).filter((s) => s.at === null);
  if (off.length === 0) return null;
  return (
    <OrgSection title={t.serversOff} count={off.length} info={t.serversOffHint}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {off.map((s) => (
          <li key={s.name} className={`flex items-center ${ICON_GAP.row} px-1 py-1.5 text-xs`}>
            <span className="shrink-0 font-mono font-medium">@{s.name}</span>
            <span
              className="shrink-0 font-mono text-gray-500 dark:text-gray-400"
              title={s.commit ?? undefined}
            >
              {s.commit === null ? t.serverUnread : s.commit.slice(0, 9)}
            </span>
            {s.describe !== null && (
              <span className="min-w-0 truncate font-mono text-gray-400 dark:text-gray-500">
                {s.describe}
              </span>
            )}
            <span
              className="ml-auto min-w-0 truncate pl-3 text-gray-400 dark:text-gray-500"
              title={s.error ?? s.url ?? undefined}
            >
              {s.error ?? s.url ?? ""}
            </span>
          </li>
        ))}
      </ul>
    </OrgSection>
  );
}

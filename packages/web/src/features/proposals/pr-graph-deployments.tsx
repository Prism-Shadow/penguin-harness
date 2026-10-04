/**
 * The registered deployments on the PR graph page: a mark on the row of the layer each
 * deployment's commit sits on (company-proposals deployments.ts places them; the page draws
 * what it was given), and the deployments on no layer listed under the graph with their commit
 * or the reason it could not be read.
 */
import type { ProposalGraphDeployment } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_GAP, RuledSection } from "@prismshadow/penguin-ui";
import { toneSurface } from "../../lib/tone";

/** The marks of the deployments on one layer (by node key; `""` = the base branch); nothing when none sits there. */
export function DeploymentMarks({
  deployments,
  at,
}: {
  deployments: readonly ProposalGraphDeployment[] | undefined;
  at: string;
}) {
  const t = S.company.proposals.graph;
  const here = (deployments ?? []).filter((d) => d.at === at);
  return (
    <>
      {here.map((d) => (
        <span
          key={d.id}
          data-tooltip={t.deploymentTitle(d.id, d.commit ?? "", d.describe, d.ahead)}
          className={`shrink-0 rounded px-1 font-mono text-xs font-medium ${toneSurface.link}`}
        >
          @{d.id}
          {d.relation === "ahead" && d.ahead !== null ? ` +${d.ahead}` : ""}
        </span>
      ))}
    </>
  );
}

/** The deployments the graph could not place, under it. */
export function DeploymentsOff({
  deployments,
}: {
  deployments: readonly ProposalGraphDeployment[] | undefined;
}) {
  const t = S.company.proposals.graph;
  const off = (deployments ?? []).filter((d) => d.at === null);
  if (off.length === 0) return null;
  return (
    <RuledSection title={t.deploymentsOff} count={off.length} info={t.deploymentsOffHint}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {off.map((d) => (
          <li key={d.id} className={`flex items-center ${ICON_GAP.row} px-1 py-1.5 text-xs`}>
            <span className="shrink-0 font-mono font-medium">@{d.id}</span>
            <span
              className="shrink-0 font-mono text-gray-500 dark:text-gray-400"
              data-tooltip={d.commit ?? undefined}
            >
              {d.commit === null ? t.deploymentUnread : d.commit.slice(0, 9)}
            </span>
            {d.describe !== null && (
              <span className="min-w-0 truncate font-mono text-gray-400 dark:text-gray-500">
                {d.describe}
              </span>
            )}
            <span
              className="ml-auto min-w-0 truncate pl-3 text-gray-400 dark:text-gray-500"
              data-tooltip={d.error ?? d.url ?? undefined}
            >
              {d.error ?? d.url ?? ""}
            </span>
          </li>
        ))}
      </ul>
    </RuledSection>
  );
}

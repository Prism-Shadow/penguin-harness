import type { ReactNode } from "react";
import type { AgentConfigResponse } from "@prismshadow/penguin-server/api";
import { CopyButton, InfoPopover } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** A label over its value, the overview's read-only shape. */
export function AgentOverviewField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

/** State identity is readable for every Agent. Only writable Agents supply transfer actions. */
export function AgentStateSection({
  data,
  children,
}: {
  data: AgentConfigResponse;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {S.agent.stateTitle}
          {children && <InfoPopover label={S.agent.stateTitle}>{S.agent.transferDesc}</InfoPopover>}
        </p>
        {children}
      </div>
      <AgentOverviewField label={S.agent.stateVersion}>
        <span className="font-mono font-semibold">v{data.config.version}</span>
      </AgentOverviewField>
      <AgentOverviewField label={S.agent.stateDir}>
        <div className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">
            {data.stateDir}
          </span>
          <CopyButton
            text={data.stateDir}
            label={S.agent.copyStateDir}
            size="sm"
            className="shrink-0"
          />
        </div>
      </AgentOverviewField>
    </section>
  );
}

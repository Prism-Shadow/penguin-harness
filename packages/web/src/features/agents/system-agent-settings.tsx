/**
 * The system Agent's settings: the two panels its page has instead of the nine every other
 * Agent's has. The other tabs configure a runtime that never runs, and its identity is the
 * platform's, so the overview only reads — its name and description from the dictionary, never
 * from its file — with no save, picture, export, replace or kernel action. The Plugins tab keeps
 * only its Workbenches sub-page, where the system apps it owns are listed, read-only.
 */
import type { ReactNode } from "react";
import type { AgentConfigResponse } from "@prismshadow/penguin-server/api";
import { CopyButton, HelpFold, SettingsList } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** A label over its value, the overview's read-only shape. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

/** The overview: who the system Agent is, and where its State lives. */
export function SystemAgentOverview({ data }: { data: AgentConfigResponse }) {
  return (
    <div className="space-y-4">
      <Field label={S.common.name}>{S.agent.systemName}</Field>
      <Field label={S.agent.description}>{S.agent.systemDescription}</Field>
      <section className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
        <p className="text-sm font-medium">{S.agent.stateTitle}</p>
        <Field label={S.agent.stateVersion}>
          <span className="font-mono font-semibold">v{data.config.version}</span>
        </Field>
        <Field label={S.agent.stateDir}>
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
        </Field>
      </section>
    </div>
  );
}

/**
 * The Plugins tab: only its Workbenches sub-page, so no sub-page switch (it takes two or more),
 * with the system apps as read-only rows.
 */
export function SystemAgentApps() {
  return (
    <div className="space-y-4">
      <HelpFold label={S.agentPlugins.subPages.workbenches}>{S.agent.systemAppsDesc}</HelpFold>
      <SettingsList label={S.agentPlugins.subPages.workbenches} empty={S.agent.systemAppsEmpty}>
        {[]}
      </SettingsList>
    </div>
  );
}

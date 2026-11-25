import { AgentOverviewField, AgentStateSection } from "./agent-overview-fields";
import { useNavigate } from "react-router";
import type { AgentConfigResponse } from "@prismshadow/penguin-server/api";
import { Button, GlyphAppIcon, ListRow, Pill, SettingsList } from "@prismshadow/penguin-ui";
import { glyphOf } from "@prismshadow/penguin-web/internal";
import { localizedText } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { useRestoreApp } from "@prismshadow/penguin-web/internal";
import { systemAppKey, useSystemApps } from "@prismshadow/penguin-web/internal";
import { useLocale } from "@prismshadow/penguin-web/internal";

/** Edge of a row's mark, in px: the tile every settings row leads with. */
const MARK_PX = 36;

/** The overview: who the system Agent is, and where its State lives. */
export function SystemAgentOverview({ data }: { data: AgentConfigResponse }) {
  return (
    <div className="space-y-4">
      <AgentOverviewField label={S.common.name}>{S.agent.systemName}</AgentOverviewField>
      <AgentOverviewField label={S.agent.description}>
        {S.agent.systemDescription}
      </AgentOverviewField>
      <AgentStateSection data={data} />
    </div>
  );
}

/** Platform apps use the same running window as their App Center shortcut. */
export function SystemAgentApps() {
  const apps = useSystemApps();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const restore = useRestoreApp();
  return (
    <div className="space-y-4">
      <SettingsList label={S.agentPlugins.subPages.workbenches} empty={S.agent.systemAppsEmpty}>
        {apps.map((app) => {
          const title = localizedText(locale, app.title, app.titleZh);
          return (
            <ListRow
              key={app.key}
              as="li"
              leading={<GlyphAppIcon appKey={app.key} d={glyphOf(app.icon)} size={MARK_PX} />}
              title={title}
              titleTrail={<Pill>{S.agent.systemAppTag}</Pill>}
              trailing={
                <Button
                  size="sm"
                  aria-label={`${S.appCenter.menu.open} ${title}`}
                  onClick={() => {
                    if (app.frame) restore(systemAppKey(app.key));
                    else void navigate(app.path);
                  }}
                >
                  {S.workbenches.openAction}
                </Button>
              }
            />
          );
        })}
      </SettingsList>
    </div>
  );
}

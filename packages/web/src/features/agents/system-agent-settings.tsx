import { AgentOverviewField, AgentStateSection } from "./agent-overview-fields";
import { useNavigate } from "react-router";
import type { AgentConfigResponse } from "@prismshadow/penguin-server/api";
import { Button, GlyphAppIcon, ListRow, Pill, SettingsList } from "@prismshadow/penguin-ui";
import { glyphOf } from "../../lib/nav-icons";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { useSystemApps } from "../../lib/system-apps";
import { useLocale } from "../../state/locale";

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

/**
 * The Plugins tab: only its Workbenches sub-page, so no sub-page switch (it takes two or more),
 * with the system apps as read-only rows.
 */
export function SystemAgentApps() {
  const apps = useSystemApps();
  const { locale } = useLocale();
  const navigate = useNavigate();
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
                  onClick={() => void navigate(app.path)}
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

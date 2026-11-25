/**
 * A plugin's detail on the Agent settings Plugins sub-page: the Plugins page's product page
 * (`PluginDetailModal`) with this Agent's status on its facts line, the market's cover and
 * screenshots for the plugin's package (this server's curation, as the market reads it), the
 * README and the files read from the server the Agent lives on, no "used by" count, and one
 * section of its own after the About — **On this agent**, what of the plugin the Agent carries:
 *
 * - one group per kind it has a part (or a missing part) of — Skills, the hook package, MCP
 *   servers, workbenches — each headed by its kind and, at the head's end, the way to where that
 *   kind is managed (its sub-page; the Tools tab for MCP servers), which closes the dialog;
 * - one line per part: its name and the version installed (a hook package's hook points, an MCP
 *   server's target and what it waits for, with the owner's Set up while it misses vault keys);
 * - a part the library ships and the Agent lacks, muted, marked "Missing";
 * - for a plugin that also ships server modules, one line for the module: how it stands on the
 *   Agent's server — running, off, awaiting the administrator, stopped, failed, waiting for a
 *   restart — and the row's action for it (Enable server module, or Ask the administrator).
 *
 * Its footer holds the row's actions, each with its word. A plugin gone from the library has no
 * README or files to show: its detail is its status, what the Agent carries of it, and the owner's
 * Uninstall.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  FactList,
  FactRow,
  ICONS,
  Modal,
  Pill,
  RuledSection,
} from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import { useRead } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { BOOK_ICON, localizedText } from "@prismshadow/penguin-web/internal";
import { workbenchTabsOf } from "@prismshadow/penguin-web/internal";
import {
  MARKET_KEY,
  McpServerMarks,
  McpSetUpModal,
  ModuleStatusMark,
  PluginDetailModal,
  artOf,
  hasParts,
  isSelected,
  pluginMarket,
  type AgentPluginGroup,
  type AgentTarget,
  type PluginRow,
} from "@prismshadow/penguin-web/internal";
import type { AgentPluginActions } from "./agent-plugin-actions";
import {
  AgentStatusMark,
  ModuleActionButton,
  agentPluginActions,
  type AgentModule,
} from "./agent-plugin-row";
import type { PluginsSubPage } from "./plugins-subpages";

/** Where each kind of part is managed. */
const MANAGED_ON = {
  skills: "skills",
  hooks: "hooks",
  mcpServers: "tools",
  workbenches: "workbenches",
} as const satisfies Record<string, PluginsSubPage | "tools">;

/** The row that names a part the library ships and the Agent lacks. */
function MissingRow({ glyph, name }: { glyph: string; name: string }) {
  return (
    <FactRow
      glyph={glyph}
      name={name}
      mono
      muted
      trailing={
        <Pill tone="attention" tooltip={S.agentPlugins.missingPartHint}>
          {S.agentPlugins.missingPart}
        </Pill>
      }
    />
  );
}

/** One kind's group: its head with the way to where it is managed, then its rows. */
function PartGroup({
  kind,
  onManage,
  children,
}: {
  kind: keyof typeof MANAGED_ON;
  onManage: ((to: PluginsSubPage | "tools") => void) | undefined;
  children: ReactNode;
}) {
  const label = S.agentPlugins.partKinds[kind];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-fg-muted">{label}</h4>
        {onManage && (
          <Button size="sm" variant="ghost" onClick={() => onManage(MANAGED_ON[kind])}>
            {S.agentPlugins.managePart[kind]}
          </Button>
        )}
      </div>
      <FactList label={label}>{children}</FactList>
    </div>
  );
}

/** "On this agent": what of the plugin the Agent carries, and lacks, by kind. */
export function AgentPartsSection({
  entry,
  title,
  target,
  agentName,
  isOwner,
  locale,
  module,
  actions,
  onManage,
  onReload,
}: {
  entry: AgentPluginGroup;
  title: string;
  target: AgentTarget;
  agentName: string;
  isOwner: boolean;
  locale: "zh" | "en";
  /** The plugin's server module on the Agent's server, when it ships one. */
  module: AgentModule | undefined;
  actions: AgentPluginActions | undefined;
  onManage: ((to: PluginsSubPage | "tools") => void) | undefined;
  /** Reads the lists again: a server's vault keys were set. */
  onReload: () => void;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const { skills, hooks, mcpServers, workbenches } = entry.parts;
  const { missing, plugin } = entry;
  const keysMissing = mcpServers.some((server) => server.missingKeys.length > 0);
  return (
    <RuledSection title={S.agentPlugins.onAgentTitle} level={3} className="mt-5">
      <div className="space-y-4">
        {(skills.length > 0 || missing.skills.length > 0) && (
          <PartGroup kind="skills" onManage={onManage}>
            {skills.map((skill) => (
              <FactRow key={skill.name} glyph={BOOK_ICON} name={skill.name} mono>
                {skill.version && <span className="font-mono">{skill.version}</span>}
              </FactRow>
            ))}
            {missing.skills.map((name) => (
              <MissingRow key={name} glyph={BOOK_ICON} name={name} />
            ))}
          </PartGroup>
        )}
        {(hooks.length > 0 || missing.hooks) && (
          <PartGroup kind="hooks" onManage={onManage}>
            {hooks.map((hook) => (
              <FactRow key={hook.name} glyph={ICONS.fishHook} name={hook.name} mono>
                {hook.events.map((event) => (
                  <Badge key={event}>{event}</Badge>
                ))}
                {hook.version && <span className="font-mono">{hook.version}</span>}
              </FactRow>
            ))}
            {missing.hooks && <MissingRow glyph={ICONS.fishHook} name={entry.name} />}
          </PartGroup>
        )}
        {(mcpServers.length > 0 || missing.mcpServers.length > 0) && (
          <PartGroup kind="mcpServers" onManage={onManage}>
            {mcpServers.map((server) => (
              <FactRow
                key={server.name}
                glyph={ICONS.plug}
                name={server.name}
                mono
                trailing={
                  <>
                    <McpServerMarks
                      keys={server.missingKeys}
                      where={isOwner ? S.plugins.mcpSetUpWhere : S.plugins.mcpSetUpByOwner}
                      signIn={server.signIn}
                    />
                    {isOwner && server.missingKeys.length > 0 && plugin !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${S.plugins.setUp} ${server.name}`}
                        onClick={() => setSettingUp(true)}
                      >
                        {S.plugins.setUp}
                      </Button>
                    )}
                  </>
                }
              >
                <span className="font-mono">{server.target}</span>
              </FactRow>
            ))}
            {missing.mcpServers.map((name) => (
              <MissingRow key={name} glyph={ICONS.plug} name={name} />
            ))}
          </PartGroup>
        )}
        {(workbenches.length > 0 || missing.workbenches.length > 0) && (
          <PartGroup kind="workbenches" onManage={onManage}>
            {workbenches.map((workbench) => {
              const first = workbenchTabsOf([workbench])[0];
              return (
                <FactRow
                  key={workbench.id}
                  glyph={ICONS.anvil}
                  name={first ? localizedText(locale, first.title, first.titleZh) : workbench.name}
                >
                  {workbench.version && <span className="font-mono">v{workbench.version}</span>}
                </FactRow>
              );
            })}
            {missing.workbenches.map((name) => (
              <MissingRow key={name} glyph={ICONS.anvil} name={name} />
            ))}
          </PartGroup>
        )}
        {module !== undefined && (
          <FactList label={S.agentPlugins.module.title}>
            <FactRow
              glyph={ICONS.server}
              name={S.agentPlugins.module.title}
              trailing={
                actions && (
                  <ModuleActionButton
                    entry={entry}
                    title={title}
                    module={module}
                    actions={actions}
                    variant="ghost"
                  />
                )
              }
            >
              <ModuleStatusMark mark={module.mark} onMachine={module.onMachine} words="fact" />
            </FactRow>
          </FactList>
        )}
      </div>
      {settingUp && keysMissing && plugin !== null && (
        <McpSetUpModal
          projectId={target.projectId}
          agentId={target.agentId}
          machineId={target.machineId}
          agentName={agentName}
          title={title}
          plugin={plugin}
          onClose={() => setSettingUp(false)}
          onSaved={onReload}
        />
      )}
    </RuledSection>
  );
}

export function AgentPluginDetail({
  entry,
  row,
  title,
  categoryTitle,
  target,
  agentName,
  isOwner,
  locale,
  actions,
  module,
  onClose,
  onManage,
  onReload,
}: {
  entry: AgentPluginGroup;
  /** The library's row of the plugin; undefined once it left the library. */
  row: PluginRow | undefined;
  title: string;
  categoryTitle: string;
  target: AgentTarget;
  agentName: string;
  isOwner: boolean;
  locale: "zh" | "en";
  actions: AgentPluginActions | undefined;
  /** The plugin's server module on the Agent's server, for a plugin the Agent carries that ships one. */
  module?: AgentModule | undefined;
  onClose: () => void;
  onManage: ((to: PluginsSubPage | "tools") => void) | undefined;
  onReload: () => void;
}) {
  const footer = actions ? agentPluginActions(entry, title, isOwner, actions) : [];
  // The market's curation, as the Plugins page last read it: the same cover here as there. A
  // server without one (404) leaves the generated cover.
  const market = useRead(pluginMarket, MARKET_KEY, () => api.getPluginMarket()).value;
  const { missing } = entry;
  const carried =
    hasParts(entry.parts) ||
    missing.hooks ||
    missing.skills.length + missing.mcpServers.length + missing.workbenches.length > 0;
  const parts = carried ? (
    <AgentPartsSection
      entry={entry}
      title={title}
      target={target}
      agentName={agentName}
      isOwner={isOwner}
      locale={locale}
      module={module}
      actions={actions}
      onManage={onManage}
      onReload={onReload}
    />
  ) : undefined;
  if (row === undefined) {
    return (
      <Modal
        open
        title={title}
        onClose={onClose}
        widthClass="sm:max-w-2xl"
        {...(footer.length > 0 ? { footer: <>{footer}</> } : {})}
      >
        <div className="space-y-1.5 text-sm">
          <AgentStatusMark status={entry.status} />
          <p className="text-fg-muted">{S.agentPlugins.statusHint[entry.status]}</p>
        </div>
        {parts}
      </Modal>
    );
  }
  return (
    <PluginDetailModal
      row={row}
      machineId={target.machineId}
      head={{ status: <AgentStatusMark status={entry.status} />, categoryTitle, usedBy: null }}
      art={artOf(market, row)}
      selected={isSelected(market, row)}
      afterAbout={parts}
      footer={footer.length > 0 ? <>{footer}</> : null}
      onClose={onClose}
    />
  );
}

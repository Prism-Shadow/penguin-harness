/**
 * A plugin's detail on the Agent settings Plugins sub-page: the Plugins page's detail dialog
 * (`PluginDetailModal`) with this Agent's status in its header, the README and the files read
 * from the server the Agent lives on, no "used by" count, and one section of its own after the
 * About — **On this agent**, what of the plugin the Agent carries:
 *
 * - one group per kind it has a part (or a missing part) of — Skills, the hook package, MCP
 *   servers, workbenches — each headed by its kind and, at the head's end, the way to where that
 *   kind is managed (its sub-page; the Tools tab for MCP servers), which closes the dialog;
 * - one line per part: its name and the version installed (a hook package's hook points, an MCP
 *   server's target and what it waits for, with the owner's Set up while it misses vault keys);
 * - a part the library ships and the Agent lacks, muted, marked "Missing".
 *
 * Its footer holds the card's actions. A plugin gone from the library has no README or files to
 * show: its detail is its status, what the Agent carries of it, and the owner's Uninstall.
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
import { S } from "../../lib/strings";
import { BOOK_ICON, localizedText } from "../../lib/skill-use";
import { workbenchTabsOf } from "../../lib/workbench-tabs";
import {
  McpServerMarks,
  McpSetUpModal,
  PluginDetailModal,
  hasParts,
  type AgentPluginGroup,
  type AgentTarget,
  type PluginRow,
} from "../plugins";
import type { AgentPluginActions } from "./agent-plugin-actions";
import { AgentStatusMark, agentPluginActions } from "./agent-plugin-card";
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
  onManage: (to: PluginsSubPage | "tools") => void;
  children: ReactNode;
}) {
  const label = S.agentPlugins.partKinds[kind];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-fg-muted">{label}</h4>
        <Button size="sm" variant="ghost" onClick={() => onManage(MANAGED_ON[kind])}>
          {S.agentPlugins.managePart[kind]}
        </Button>
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
  onManage,
  onReload,
}: {
  entry: AgentPluginGroup;
  title: string;
  target: AgentTarget;
  agentName: string;
  isOwner: boolean;
  locale: "zh" | "en";
  onManage: (to: PluginsSubPage | "tools") => void;
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
  actions: AgentPluginActions;
  onClose: () => void;
  onManage: (to: PluginsSubPage | "tools") => void;
  onReload: () => void;
}) {
  const footer = agentPluginActions(entry, title, isOwner, actions, "footer");
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
      afterAbout={parts}
      footer={footer.length > 0 ? <>{footer}</> : null}
      onClose={onClose}
    />
  );
}

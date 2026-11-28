/**
 * The Agent settings Plugins tab's Plugins sub-page: the Agent's plugins as one column of compact
 * rows, the shape of the Hooks sub-page's list (agent-plugin-row.tsx), with the Plugins page's
 * detail dialog (agent-plugin-detail.tsx), status marks, tags (the category named as that page
 * names it, `pluginCategories`), one-line descriptions and search (`rowMatches`).
 *
 * Two sections, the Plugins page's group heads (a name and a count, folding, both open; both open
 * while the search box holds anything):
 *
 * - **Installed**: every plugin the Agent carries a part of — whole, behind the library,
 *   missing a part, or gone from the library (library/plugin/src/web/agent-plugin-groups.ts).
 * - **Available**: the library's plugins the Agent carries nothing of and could take — those that
 *   ship a Skill, a hook package, an MCP server or a workbench; a package of server modules alone
 *   is the Plugins page's.
 *
 * A plugin the Agent carries that also ships server modules reads how its module stands on the
 * Agent's server, from the same answer as the Agent's lists (`modules`), with what the viewer can
 * do about it (library/plugin/src/web/plugin-status.ts `agentModuleMark`): on its row while the module
 * does not run there, and always on its detail's line. An available plugin says nothing of it:
 * its install is what brings the module along.
 *
 * Inside a section the rows are in name order, one per plugin. A section the search leaves empty is
 * not drawn; nothing installed says so above Available, and a library with nothing for an Agent
 * beside nothing installed is one sentence. While the first read is out, placeholder rows stand
 * where the rows will be. The Agent's own parts are not listed here: they are rows on the kind
 * sub-pages.
 *
 * A row's name, or a click anywhere else on the row that is not one of its controls, opens its
 * detail, and the address names it (`&plugin=<name>`), so a detail can be linked to; closing it,
 * or switching sub-page, drops the name. A part's puzzle on another sub-page opens this one with
 * the plugin's row `marked`: the page mounts afresh on every switch, so both sections are open
 * and the row is there to bring into view.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { AgentPluginsInstallResponse, PluginGroupItem } from "@prismshadow/penguin-server/api";
import { CollapsibleSection, SettingsEmpty, Waiting } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  agentModuleMark,
  installsOf,
  pluginCategories,
  pluginRows,
  rowMatches,
  type AgentPluginGroup,
  type AgentPluginGroups,
  type AgentTarget,
  type PluginRow,
  packageUpdate,
  useLocalPluginIndex,
} from "@prismshadow/penguin-library-plugin/web";
import { agentPluginTitle, useAgentPluginActions } from "./agent-plugin-actions";
import { AgentPluginRow, type AgentModule } from "./agent-plugin-row";
import { AgentPluginDetail } from "./agent-plugin-detail";
import type { PluginsSubPage } from "./plugins-subpages";

/** The two sections a row can be in. */
type Section = "installed" | "available";

export function AgentPluginsPage({
  readOnly = false,
  target,
  agentName,
  machineLabel,
  isOwner,
  isAdmin,
  locale,
  library,
  installed,
  catalog,
  query,
  openName,
  marked,
  onOpen,
  onClose,
  onManage,
  onChanged,
  onReload,
}: {
  readOnly?: boolean;
  target: AgentTarget;
  agentName: string;
  /** The ssh alias of the machine the Agent lives on; undefined on this server. */
  machineLabel: string | undefined;
  isOwner: boolean;
  /** The viewer is the server's administrator. */
  isAdmin: boolean;
  locale: "zh" | "en";
  /** The library of the server the Agent lives on, by category; null until the first read. */
  library: readonly PluginGroupItem[] | null;
  /** The Agent's plugin lists; null until the first read. */
  installed: AgentPluginsInstallResponse | null;
  /** The Agent's plugins, sorted (agent-plugin-groups.ts); null until the first read. */
  catalog: AgentPluginGroups | null;
  /** The search box's text. */
  query: string;
  /** The plugin whose detail the address names; null when none is open. */
  openName: string | null;
  /** The plugin a part's puzzle just pointed at, whose row is marked; null otherwise. */
  marked: string | null;
  onOpen: (plugin: string) => void;
  onClose: () => void;
  /** Goes where a kind of part is managed, which closes the detail. */
  onManage: (to: PluginsSubPage | "tools") => void;
  /** Reads the lists again after a write, and the Agent list whose marks moved. */
  onChanged: () => Promise<void>;
  /** Reads the lists again. */
  onReload: () => void;
}) {
  const [folded, setFolded] = useState<ReadonlySet<Section>>(new Set());
  const installs = installed === null ? undefined : installsOf(installed);
  const registry = useLocalPluginIndex(isAdmin && target.machineId === null);
  const releaseFor = (entry: AgentPluginGroup) =>
    entry.plugin && entry.status !== "available" && isAdmin && target.machineId === null
      ? packageUpdate(registry.value?.plugins.find((item) => item.name === entry.plugin!.package))
      : null;
  const actions = useAgentPluginActions({
    releaseFor,
    target,
    agentName,
    machineLabel,
    installs,
    locale,
    onChanged,
  });

  if (library === null || catalog === null) {
    // The rows' placeholders, as the kind sub-pages' lists show them.
    return <Waiting rows={4} />;
  }

  const rows = new Map<string, PluginRow>(pluginRows(library, []).map((row) => [row.name, row]));
  const categories = new Map(pluginCategories(library, locale).map((c) => [c.id, c.title]));
  const categoryOf = (entry: AgentPluginGroup) =>
    entry.category === null ? undefined : categories.get(entry.category);
  const searching = query.trim() !== "";
  /** A library plugin matches as the Plugins page's search does; one gone from it by its name. */
  const matches = (entry: AgentPluginGroup) => {
    const row = rows.get(entry.name);
    return row === undefined || entry.plugin === null
      ? entry.name.toLowerCase().includes(query.trim().toLowerCase())
      : rowMatches(row, query);
  };
  const sections: Array<{ id: Section; title: string; entries: AgentPluginGroup[] }> = [
    {
      id: "installed",
      title: S.agentPlugins.installedSection,
      entries: catalog.groups.filter(matches),
    },
    {
      id: "available",
      title: S.agentPlugins.availableSection,
      entries: readOnly ? [] : catalog.available.filter(matches),
    },
  ];
  const shown = sections.filter((section) => section.entries.length > 0);

  /** The server module of a plugin the Agent carries, when the plugin ships one and the server says. */
  const moduleOf = (entry: AgentPluginGroup): AgentModule | undefined => {
    if (readOnly || entry.plugin?.modules !== true || entry.status === "available")
      return undefined;
    const status = installed?.modules?.find((m) => m.plugin === entry.name);
    if (status === undefined) return undefined;
    const onMachine = target.machineId !== null;
    return { status, mark: agentModuleMark(status, { isAdmin, onMachine }), onMachine };
  };

  const rowOf = (entry: AgentPluginGroup) => (
    <AgentPluginRow
      key={entry.name}
      entry={entry}
      row={entry.plugin === null ? undefined : rows.get(entry.name)}
      title={agentPluginTitle(entry, locale)}
      categoryTitle={categoryOf(entry)}
      locale={locale}
      installs={installs}
      isOwner={isOwner}
      actions={readOnly ? undefined : actions}
      module={moduleOf(entry)}
      marked={entry.name === marked}
      onOpen={() => onOpen(entry.name)}
    />
  );

  /** The open detail: the plugin the address names, when the page lists it. */
  const open =
    openName === null
      ? undefined
      : (readOnly ? catalog.groups : [...catalog.groups, ...catalog.available]).find(
          (entry) => entry.name === openName,
        );

  let body: ReactNode;
  if (readOnly && catalog.groups.length === 0) {
    body = <SettingsEmpty>{S.agentPlugins.installedEmpty}</SettingsEmpty>;
  } else if (catalog.groups.length === 0 && catalog.available.length === 0) {
    body = <SettingsEmpty>{S.agentPlugins.libraryEmpty}</SettingsEmpty>;
  } else if (shown.length === 0) {
    body = <p className="px-1 text-sm text-fg-subtle">{S.plugins.noMatch}</p>;
  } else {
    body = (
      <div className="space-y-3">
        {!searching && catalog.groups.length === 0 && (
          <SettingsEmpty>{S.agentPlugins.installedEmpty}</SettingsEmpty>
        )}
        {shown.map((section) => (
          <CollapsibleSection
            key={section.id}
            title={section.title}
            meta={S.plugins.pluginCount(section.entries.length)}
            open={searching || !folded.has(section.id)}
            onOpenChange={() =>
              setFolded((prev) => {
                const next = new Set(prev);
                if (next.has(section.id)) next.delete(section.id);
                else next.add(section.id);
                return next;
              })
            }
          >
            <ul aria-label={section.title}>{section.entries.map(rowOf)}</ul>
          </CollapsibleSection>
        ))}
      </div>
    );
  }

  return (
    <>
      {body}
      {open !== undefined && (
        <AgentPluginDetail
          entry={open}
          row={open.plugin === null ? undefined : rows.get(open.name)}
          title={agentPluginTitle(open, locale)}
          categoryTitle={categoryOf(open) ?? ""}
          target={target}
          agentName={agentName}
          isOwner={isOwner}
          locale={locale}
          actions={readOnly ? undefined : actions}
          module={moduleOf(open)}
          onClose={onClose}
          onManage={readOnly ? undefined : onManage}
          onReload={onReload}
        />
      )}
      {actions.modals}
    </>
  );
}

/**
 * The Agent settings Plugins tab's Plugins sub-page: the Agent's plugins, read like the Plugins
 * page because it is built from the same pieces — its cards (`EntityCard`, agent-plugin-card.tsx),
 * its detail dialog (agent-plugin-detail.tsx) and its search (`rowMatches`).
 *
 * Two sections, the Plugins page's group heads (a name and a count, folding, both open; both open
 * while the search box holds anything):
 *
 * - **Installed**: every plugin the Agent carries a part of — whole, behind the library,
 *   missing a part, or gone from the library (features/plugins/agent-plugin-groups.ts).
 * - **Available**: the library's plugins the Agent carries nothing of and could take — those that
 *   ship a Skill, a hook package, an MCP server or a workbench; a package of server modules alone
 *   is the Plugins page's.
 *
 * Inside a section the cards are in name order, two to a row where there is room. A section the
 * search leaves empty is not drawn; nothing installed says so above Available, and a library with
 * nothing for an Agent beside nothing installed is one sentence. While the first read is out,
 * placeholder cards stand where the cards will be. The Agent's own parts are no cards: they are
 * rows on the kind sub-pages.
 *
 * A card's body opens its detail, and the address names it (`&plugin=<name>`), so a detail can be
 * linked to; closing it, or switching sub-page, drops the name.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { AgentPluginsInstallResponse, PluginGroupItem } from "@prismshadow/penguin-server/api";
import {
  CollapsibleSection,
  EntityCardGrid,
  SettingsEmpty,
  Skeleton,
  SkeletonCard,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  installsOf,
  pluginCategories,
  pluginRows,
  rowMatches,
  type AgentPluginGroup,
  type AgentPluginGroups,
  type AgentTarget,
  type PluginRow,
} from "../plugins";
import { agentPluginTitle, useAgentPluginActions } from "./agent-plugin-actions";
import { AgentPluginCard } from "./agent-plugin-card";
import { AgentPluginDetail } from "./agent-plugin-detail";
import type { PluginsSubPage } from "./plugins-subpages";

/** The two sections a card can be in. */
type Section = "installed" | "available";

export function AgentPluginsPage({
  target,
  agentName,
  machineLabel,
  isOwner,
  locale,
  library,
  installed,
  catalog,
  query,
  openName,
  onOpen,
  onClose,
  onManage,
  onChanged,
  onReload,
}: {
  target: AgentTarget;
  agentName: string;
  /** The ssh alias of the machine the Agent lives on; undefined on this server. */
  machineLabel: string | undefined;
  isOwner: boolean;
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
  const actions = useAgentPluginActions({
    target,
    agentName,
    machineLabel,
    installs,
    locale,
    onChanged,
  });

  if (library === null || catalog === null) {
    // The Plugins page's placeholder cards.
    return (
      <EntityCardGrid>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} className="p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-3 h-6 w-36" />
          </SkeletonCard>
        ))}
      </EntityCardGrid>
    );
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
      entries: catalog.available.filter(matches),
    },
  ];
  const shown = sections.filter((section) => section.entries.length > 0);

  const card = (entry: AgentPluginGroup) => (
    <AgentPluginCard
      key={entry.name}
      entry={entry}
      row={entry.plugin === null ? undefined : rows.get(entry.name)}
      title={agentPluginTitle(entry, locale)}
      locale={locale}
      categoryTitle={categoryOf(entry)}
      installs={installs}
      isOwner={isOwner}
      actions={actions}
      onOpen={() => onOpen(entry.name)}
    />
  );

  /** The open detail: the plugin the address names, when the page lists it. */
  const open =
    openName === null
      ? undefined
      : [...catalog.groups, ...catalog.available].find((entry) => entry.name === openName);

  let body: ReactNode;
  if (catalog.groups.length === 0 && catalog.available.length === 0) {
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
            <EntityCardGrid>{section.entries.map(card)}</EntityCardGrid>
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
          actions={actions}
          onClose={onClose}
          onManage={onManage}
          onReload={onReload}
        />
      )}
      {actions.modals}
    </>
  );
}

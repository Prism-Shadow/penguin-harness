/**
 * Pages & sections: how a page is put together, after the app's own pages.
 *
 * - Settings: the Plugins page — the title and its "?", then the list column (a full-width
 *   search, the installed list under its bar, the available list folded) beside the filter column.
 *   Its scene builds the page section by section, the rows landing one after another;
 * - Entity: a model's page — the entity header (logo, name, id, badges, a link) above ruled
 *   sections of facts and of the agents that use it;
 * - Empty: the Agents page of a Project with no Agent of its own — the title row with its search
 *   and create pair, the built-in Agent's card, and the list's empty line under it.
 *
 * Static stand-ins for W4's `PageFrame`, `PageHeader`, `RuledSection`, `CollapsibleSection`,
 * `EntityHeader`, `CreateButtons` and W1's `EmptyState`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, PluginFixture } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import type { SceneSpec } from "../module";
import { reached, useScene } from "../scene";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import {
  AgentCard,
  AgentsHeader,
  Badge,
  Button,
  Checkbox,
  CreateButtons,
  EmptyState,
  GlyphIcon,
  IconButton,
  KeyValue,
  Link,
  PageHeader,
  RuledSection,
  SearchInput,
  arriving,
  useArrivals,
} from "./parts";

const BUILD: SceneSpec = {
  frames: [
    { key: "header", title: "Header", hold: 900 },
    { key: "installed", title: "Installed", hold: 1600 },
    { key: "marketplaces", title: "Available", hold: 1200 },
  ],
};

/** The page's scroll container and width cap, with the app's page padding. */
function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-5xl gap-6 p-6">{children}</div>;
}

/** A list's header bar: its title with the count inside it, and the fold chevron on the right. */
function CollapsibleSection({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children?: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-base font-(--ui-weight-strong) text-fg">
          {title}
        </span>
        <GlyphIcon
          name={open ? "chevronDown" : "chevronRight"}
          size={14}
          className="text-fg-subtle"
        />
      </div>
      {open && children}
    </section>
  );
}

/**
 * A plugin's row: its tile, its name and one line of description, the meta line (version and
 * state), its tags, and the action on the right.
 */
function PluginRow({ f, plugin }: { f: Fixtures; plugin: PluginFixture }) {
  const p = f.copy.plugins;
  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted">
          <GlyphIcon name={plugin.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-(--ui-weight-strong) text-fg">
            {plugin.name}
          </p>
          <p className="truncate text-sm text-fg-muted">{plugin.description}</p>
          <p className="mt-1 text-xs text-fg-subtle">
            v{plugin.version} · {plugin.enabled ? p.running : p.notInstalled}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge variant="soft">{plugin.category}</Badge>
            <Badge variant="soft">{p.kinds[plugin.kind]}</Badge>
          </div>
        </div>
      </div>
      <IconButton label={p.uninstall} icon="trash" size="md" />
    </div>
  );
}

/** The filter column: one group of checkbox rows per facet, each row with its count. */
function PluginFilters({ f }: { f: Fixtures }) {
  const p = f.copy.plugins;
  const lib = f.pluginLibrary;
  const groups: readonly {
    title: string;
    rows: readonly { label: string; count: number }[];
  }[] = [
    { title: p.filters.categories, rows: lib.categories },
    {
      title: p.filters.kind,
      rows: (["skills", "hooks", "modules"] as const).map((key) => ({
        label: p.kinds[key],
        count: lib.kinds[key],
      })),
    },
    {
      title: p.filters.state,
      rows: [
        { label: p.states.installed, count: lib.installed },
        { label: p.states.available, count: lib.available },
      ],
    },
  ];
  return (
    <aside className="grid content-start gap-6 pt-10">
      {groups.map((group) => (
        <div key={group.title} className="grid gap-2">
          <p className="text-xs font-(--ui-weight-strong) text-fg-subtle">{group.title}</p>
          {group.rows.map((row) => (
            <span key={row.label} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <Checkbox checked={false} label={row.label} />
              </span>
              <span className="text-xs tabular-nums text-fg-subtle">{row.count}</span>
            </span>
          ))}
        </div>
      ))}
    </aside>
  );
}

/**
 * The Plugins page, and the scene that builds it: the title with its "?"; the installed list, its
 * rows landing one after another; then the available list, folded — the page this variant shows
 * when nothing is playing.
 */
function Settings({ f }: { f: Fixtures }) {
  const clock = useScene();
  const p = f.copy.plugins;
  const landed = useArrivals(f.plugins.length, "installed");
  return (
    <PageFrame>
      <PageHeader title={p.title} info={p.info} />
      <div className="grid grid-cols-[minmax(0,1fr)_13rem] gap-6">
        <div className="grid content-start gap-3">
          <SearchInput placeholder={p.search} />
          {reached(clock, "installed") && (
            <CollapsibleSection title={p.installedSection(f.pluginLibrary.installed)} open>
              {f.plugins.slice(0, landed).map((plugin) => (
                <div key={plugin.name} data-reveal={arriving(clock, "installed")}>
                  <PluginRow f={f} plugin={plugin} />
                </div>
              ))}
            </CollapsibleSection>
          )}
          {reached(clock, "marketplaces") && (
            <div data-reveal={arriving(clock, "marketplaces")}>
              <CollapsibleSection
                title={p.availableSection(f.pluginLibrary.available)}
                open={false}
              />
            </div>
          )}
        </div>
        <PluginFilters f={f} />
      </div>
    </PageFrame>
  );
}

/** A model or plugin's identity: its logo, name, id, at most two badges and an outside link. */
function EntityHeader({ f }: { f: Fixtures }) {
  const m = f.copy.models;
  const model = f.models[0]!;
  return (
    <header className="flex items-start gap-4">
      <AgentTile id={model.provider} name={model.providerLabel} size={48} />
      <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-(family-name:--ui-h2-font) text-(length:--ui-h2-size) leading-(--ui-h2-lh) font-(--ui-h2-weight) tracking-(--ui-h2-tracking) text-fg">
            {model.displayName}
          </span>
          {model.isDefault && <Badge tone="success">{m.default}</Badge>}
          {!model.supportsVision && <Badge variant="outline">{m.textOnly}</Badge>}
        </div>
        <p className="font-mono text-xs text-fg-muted">
          {model.provider}/{model.modelId}
        </p>
        <p className="text-sm">
          <Link external>{m.providerDocs}</Link>
        </p>
      </div>
      <Button variant="secondary" leading={<GlyphIcon name="pencil" size={13} />}>
        {f.copy.common.edit}
      </Button>
    </header>
  );
}

function Entity({ f }: { f: Fixtures }) {
  const m = f.copy.models;
  const model = f.models[0]!;
  // An agent's Sessions this week: its rows in the sidebar.
  const sessions = (agentId: string) =>
    f.sessionGroups.flatMap((group) => group.items).filter((item) => item.agentId === agentId)
      .length;
  return (
    <PageFrame>
      <EntityHeader f={f} />
      <RuledSection title={m.pricing}>
        <KeyValue
          items={[
            { label: m.cacheRead, value: usd(model.pricing.cacheRead), mono: true },
            { label: m.cacheWrite, value: usd(model.pricing.cacheWrite), mono: true },
            { label: m.output, value: usd(model.pricing.output), mono: true },
            { label: m.contextWindow, value: tokens(model.contextWindow), mono: true },
          ]}
        />
      </RuledSection>
      <RuledSection title={m.usedBy} count={f.agents.length}>
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {f.agents.map((agent) => (
            <li
              key={agent.id}
              className="flex items-center gap-3 border-t border-line-muted py-2.5 first:border-t-0"
            >
              <AgentTile id={agent.id} name={agent.name} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{agent.name}</span>
                <span className="block truncate text-xs text-fg-muted">{agent.description}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                {m.sessionsThisWeek(sessions(agent.id))}
              </span>
            </li>
          ))}
        </ul>
      </RuledSection>
    </PageFrame>
  );
}

/**
 * The Agents page before the Project has an Agent of its own: the title row, the built-in Agent's
 * card, and the list's empty line with the create pair under it.
 */
function Empty({ f }: { f: Fixtures }) {
  const a = f.copy.agents;
  const builtin = f.agents.filter((agent) => agent.builtin);
  return (
    <PageFrame>
      <AgentsHeader f={f} />
      <div className="grid gap-3">
        {builtin.map((agent) => (
          <AgentCard key={agent.id} f={f} agent={agent} />
        ))}
        <EmptyState
          variant="list"
          title={a.empty.title}
          description={a.empty.body}
          action={<CreateButtons f={f} />}
        />
      </div>
    </PageFrame>
  );
}

const VARIANTS = { settings: Settings, entity: Entity, empty: Empty } as const;

export const module = defineModule({
  id: "pages",
  title: "Pages & sections",
  description:
    "The Plugins page: its header, the list column with search and folding list bars beside the filter column; an entity page; the Agents page with only the built-in Agent.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "settings", title: "Settings", scene: BUILD },
    { key: "entity", title: "Entity" },
    { key: "empty", title: "Empty" },
  ],
  parts: [
    "layout-card",
    "layout-page-frame",
    "layout-ruled-section",
    "layout-collapsible-section",
    "layout-entity-header",
    "feedback-empty-state",
    "actions-create-buttons",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Settings;
    return <View f={fixturesFor(lang)} />;
  },
});

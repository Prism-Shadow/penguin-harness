/**
 * Pages & sections: how a page is put together, after the app's own pages.
 *
 * - Settings: the Plugins page — the title and its "?", then the list column (a full-width
 *   search, the installed list under its bar, the available list folded) beside the filter column.
 *   The reader works it: the bars fold and open their lists, the search and the filter column
 *   narrow the rows, and a row's remove moves it to the available list, whose install moves it
 *   back;
 * - Entity: a model's page — the entity header (logo, name, id, badges, a link) above ruled
 *   sections of facts and of the agents that use it;
 * - Empty: the Agents page of a Project with no Agent of its own — the title row with its search
 *   and create pair, the built-in Agent's card, and the list's empty line under it.
 *
 * Static stand-ins for W4's `PageFrame`, `PageHeader`, `RuledSection`, `CollapsibleSection`,
 * `EntityHeader`, `CreateButtons` and W1's `EmptyState`.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, PluginFixture } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import { AgentTile, DisclosureBody } from "../screens/parts";
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
} from "./parts";
import { filterPlugins, toggled } from "./interaction";

/** The page's scroll container and width cap, with the app's page padding. */
function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-5xl gap-6 p-6">{children}</div>;
}

/**
 * A list's header bar: its title with the count inside it, and the fold chevron on the right.
 * Given `onToggle` the bar is the button that folds it, and the list opens and folds by height
 * through a disclosure body; without, the list is simply there or not.
 */
function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const bar = "flex w-full items-center gap-2 rounded-md bg-surface-muted px-3 py-2.5 text-left";
  const head = (
    <>
      <span className="min-w-0 flex-1 truncate text-base font-(--ui-weight-strong) text-fg">
        {title}
      </span>
      <GlyphIcon
        name={open ? "chevronDown" : "chevronRight"}
        size={14}
        className="text-fg-subtle"
      />
    </>
  );
  if (onToggle === undefined) {
    return (
      <section>
        <div className={bar}>{head}</div>
        {open && children}
      </section>
    );
  }
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={onToggle} className={bar}>
        {head}
      </button>
      <DisclosureBody open={open}>{children}</DisclosureBody>
    </section>
  );
}

/**
 * A plugin's row: its tile, its name and one line of description, the meta line (version and
 * state), its tags, and the action on the right.
 */
function PluginRow({
  f,
  plugin,
  installed = true,
  onAction,
}: {
  f: Fixtures;
  plugin: PluginFixture;
  /** An installed row offers remove; an available one, install. */
  installed?: boolean;
  /** Makes the row's action a real button. */
  onAction?: () => void;
}) {
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
      {installed ? (
        <IconButton label={p.uninstall} icon="trash" size="md" onClick={onAction} />
      ) : (
        <Button variant="secondary" onClick={onAction}>
          {p.install}
        </Button>
      )}
    </div>
  );
}

/**
 * The filter column: one group of checkbox rows per facet, each row with its count. `checked`
 * and `onToggle` make the rows live, keyed by facet and row label.
 */
function PluginFilters({
  f,
  checked,
  onToggle,
}: {
  f: Fixtures;
  checked?: (facet: string, label: string) => boolean;
  onToggle?: (facet: string, label: string) => void;
}) {
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
                <Checkbox
                  checked={checked?.(group.title, row.label) ?? false}
                  label={row.label}
                  onChange={onToggle && (() => onToggle(group.title, row.label))}
                />
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
 * The Plugins page as the reader works it. It opens as the still does — the installed list open,
 * the available list folded, no filter ticked — and from there each bar folds or opens its list,
 * the search and the ticked categories and kinds narrow both lists, the status boxes pick which
 * lists show, and a row's remove moves it to the available list, whose install moves it back —
 * the two bars' counts following.
 */
function Settings({ f }: { f: Fixtures }) {
  const p = f.copy.plugins;
  const lib = f.pluginLibrary;
  const [query, setQuery] = useState("");
  const [installedOpen, setInstalledOpen] = useState(true);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  // The ticked rows of the filter column, by facet title.
  const [ticks, setTicks] = useState<Readonly<Record<string, ReadonlySet<string>>>>({});
  const ticked = (facet: string): ReadonlySet<string> => ticks[facet] ?? new Set();
  const categories = ticked(p.filters.categories);
  const kinds = new Set(
    (["skills", "hooks", "modules"] as const).filter((kind) =>
      ticked(p.filters.kind).has(p.kinds[kind]),
    ),
  );
  const states = ticked(p.filters.state);
  const showInstalled = states.size === 0 || states.has(p.states.installed);
  const showAvailable = states.size === 0 || states.has(p.states.available);
  const shown = filterPlugins(f.plugins, query, categories, kinds);
  const installed = shown.filter((plugin) => !removed.has(plugin.name));
  const available = shown.filter((plugin) => removed.has(plugin.name));
  const move = (name: string) => setRemoved((now) => toggled(now, name));
  return (
    <PageFrame>
      <PageHeader title={p.title} info={p.info} />
      <div className="grid grid-cols-[minmax(0,1fr)_13rem] gap-6">
        <div className="grid content-start gap-3">
          <SearchInput
            value={query}
            placeholder={p.search}
            clearLabel={f.copy.common.remove}
            onValueChange={setQuery}
          />
          {showInstalled && (
            <CollapsibleSection
              title={p.installedSection(lib.installed - removed.size)}
              open={installedOpen}
              onToggle={() => setInstalledOpen(!installedOpen)}
            >
              {installed.map((plugin) => (
                <PluginRow
                  key={plugin.name}
                  f={f}
                  plugin={plugin}
                  onAction={() => move(plugin.name)}
                />
              ))}
            </CollapsibleSection>
          )}
          {showAvailable && (
            <CollapsibleSection
              title={p.availableSection(lib.available + removed.size)}
              open={availableOpen}
              onToggle={() => setAvailableOpen(!availableOpen)}
            >
              {available.map((plugin) => (
                <PluginRow
                  key={plugin.name}
                  f={f}
                  plugin={plugin}
                  installed={false}
                  onAction={() => move(plugin.name)}
                />
              ))}
            </CollapsibleSection>
          )}
        </div>
        <PluginFilters
          f={f}
          checked={(facet, label) => ticked(facet).has(label)}
          onToggle={(facet, label) =>
            setTicks((now) => ({ ...now, [facet]: toggled(now[facet] ?? new Set(), label) }))
          }
        />
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
    { key: "settings", title: "Settings", kind: "interactive" },
    { key: "entity", title: "Entity", kind: "static" },
    { key: "empty", title: "Empty", kind: "static" },
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

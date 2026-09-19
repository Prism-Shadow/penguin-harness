/**
 * Pages & sections: how a page is put together.
 *
 * - Settings: the Plugin library page — page frame, page header with its "?" and toolbar, a ruled
 *   section holding one level of cards, and a collapsed section below;
 * - Entity: a model's page — the entity header (logo, name, id, badges, a link) above ruled
 *   sections of facts and of the agents that use it;
 * - Empty: the Agents page before any exists — the page's empty state, and a section's empty slot.
 *
 * Static stand-ins for W4's `PageFrame`, `PageHeader`, `RuledSection`, `Card`, `CollapsibleSection`,
 * `EntityHeader` and W1's `EmptyState`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures } from "../fixtures";
import { defineModule } from "../module";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GlyphIcon,
  KeyValue,
  Link,
  PageHeader,
  RuledSection,
  SearchInput,
  Switch,
} from "./parts";

/** The page's scroll container and width cap. */
function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-3xl gap-10 py-2">{children}</div>;
}

/** A section behind a header bar that folds it away (shown folded). */
function CollapsibleSection({ title, count }: { title: string; count: number }) {
  return (
    <section className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
      <GlyphIcon name="chevronRight" size={14} className="text-fg-subtle" />
      <span className="font-(--ui-weight-medium) text-fg">{title}</span>
      <span className="text-xs tabular-nums text-fg-muted">{count}</span>
    </section>
  );
}

function Settings({ f }: { f: Fixtures }) {
  const p = f.copy.plugins;
  return (
    <PageFrame>
      <PageHeader
        title={f.copy.nav.plugins}
        info={p.info}
        actions={
          <>
            <span className="w-56">
              <SearchInput placeholder={p.search} />
            </span>
            <Button variant="primary" leading={<GlyphIcon name="plus" size={13} />}>
              {p.install}
            </Button>
          </>
        }
      />
      <RuledSection title={p.installed} description={p.installedHint} count={f.plugins.length}>
        <div className="grid grid-cols-2 gap-3">
          {f.plugins.map((row) => (
            <Card key={row.name} className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg">
                  <GlyphIcon name={row.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-(--ui-weight-medium) text-fg">
                    {row.name}
                  </span>
                  <span className="block font-mono text-xs text-fg-subtle">{row.version}</span>
                </span>
                <Switch on={row.enabled} />
              </div>
              <p className="text-sm text-fg-muted">{row.description}</p>
            </Card>
          ))}
        </div>
      </RuledSection>
      <CollapsibleSection title={p.marketplaces} count={f.pluginLibrary.marketplaces} />
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

function Empty({ f }: { f: Fixtures }) {
  const a = f.copy.agents;
  return (
    <PageFrame>
      <PageHeader title={f.copy.nav.agents} info={a.info} />
      <EmptyState
        title={a.empty.title}
        description={a.empty.body}
        action={
          <span className="flex items-center gap-2">
            <Button variant="secondary" leading={<GlyphIcon name="sparkle" size={13} />}>
              {a.createWithAi}
            </Button>
            <Button variant="primary" leading={<GlyphIcon name="plus" size={13} />}>
              {a.newAgent}
            </Button>
          </span>
        }
      />
      <RuledSection title={a.schedules}>
        <EmptyState
          variant="slot"
          title={a.schedulesEmpty.title}
          description={a.schedulesEmpty.body}
          action={<Button variant="secondary">{a.schedulesEmpty.action}</Button>}
        />
      </RuledSection>
    </PageFrame>
  );
}

const VARIANTS = { settings: Settings, entity: Entity, empty: Empty } as const;

export const module = defineModule({
  id: "pages",
  title: "Pages & sections",
  description:
    "A settings-style page: the page header, ruled sections, a card grid and a collapsible section; an entity page; an empty page.",
  width: "wide",
  variants: [
    { key: "settings", title: "Settings" },
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

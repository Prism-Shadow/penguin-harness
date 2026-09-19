/**
 * Tables & lists: the models table with a band header, a sorted column and hover actions; the vault
 * table under a plain header; a dense view of key-value facts and installed plugins as list rows
 * with a group header and a pager; and the models table with a row expanded to its details.
 * Static stand-ins for W4's `Table`, `KeyValue`, `ListRow`, `GroupHeader` and `Pager`.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, ModelFixture } from "../fixtures";
import { defineModule } from "../module";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import { Badge, Button, GlyphIcon, GroupHeader, IconButton, KeyValue, Switch } from "./parts";

/** A table's header row: `band` is a filled row, `plain` a rule under the labels. */
function TableHead({ band, children }: { band: boolean; children: ReactNode }) {
  return (
    <thead>
      <tr
        className={`text-left text-xs text-fg-muted ${band ? "bg-surface-muted" : "border-b border-line"}`}
      >
        {children}
      </tr>
    </thead>
  );
}

function Th({
  children,
  align = "left",
  sorted,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  sorted?: boolean;
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 font-(--ui-weight-medium) ${align === "right" ? "text-right" : "text-left"} ${sorted ? "text-fg" : ""}`}
    >
      <span
        className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {children}
        {sorted && <GlyphIcon name="arrowDown" size={12} />}
      </span>
    </th>
  );
}

function ModelCell({ model, badge }: { model: ModelFixture; badge?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AgentTile id={model.provider} name={model.providerLabel} size={20} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-fg">{model.displayName}</span>
          {badge && <Badge tone="success">{badge}</Badge>}
        </span>
        <span className="block truncate font-mono text-xs text-fg-subtle">{model.modelId}</span>
      </span>
    </span>
  );
}

function Table({
  f,
  expanded,
}: {
  f: Fixtures;
  /** A model id whose row is opened on its details. */
  expanded?: string;
}) {
  const m = f.copy.models;
  const models = f.models.slice(0, 6);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full border-collapse">
        <TableHead band>
          {expanded !== undefined && <th className="w-8" />}
          <Th>{m.model}</Th>
          <Th align="right">{m.context}</Th>
          <Th align="right">{m.cacheRead}</Th>
          <Th align="right" sorted>
            {m.output}
          </Th>
          <Th align="right">{m.images}</Th>
          <th className="w-20" />
        </TableHead>
        <tbody>
          {models.map((model, i) => {
            const open = model.modelId === expanded;
            const hovered = expanded === undefined && i === 2;
            return (
              <ModelRows
                key={model.modelId}
                f={f}
                model={model}
                open={open}
                hovered={hovered}
                expandable={expanded !== undefined}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ModelRows({
  f,
  model,
  open,
  hovered,
  expandable,
}: {
  f: Fixtures;
  model: ModelFixture;
  open: boolean;
  hovered: boolean;
  expandable: boolean;
}) {
  const m = f.copy.models;
  const cell = "border-t border-line px-3 py-2 text-right font-mono text-xs tabular-nums text-fg";
  return (
    <>
      <tr className={hovered || open ? "bg-surface-muted" : ""}>
        {expandable && (
          <td className="border-t border-line pl-3 text-fg-subtle">
            <GlyphIcon name={open ? "chevronDown" : "chevronRight"} size={14} />
          </td>
        )}
        <td className="border-t border-line px-3 py-2">
          <ModelCell model={model} badge={model.isDefault ? m.default : undefined} />
        </td>
        <td className={cell}>{tokens(model.contextWindow)}</td>
        <td className={cell}>{usd(model.pricing.cacheRead)}</td>
        <td className={cell}>{usd(model.pricing.output)}</td>
        <td className="border-t border-line px-3 py-2 text-right text-fg-muted">
          {model.supportsVision ? (
            <GlyphIcon name="check" size={14} className="ml-auto" />
          ) : (
            <GlyphIcon name="minus" size={14} className="ml-auto text-fg-subtle" />
          )}
        </td>
        <td className="border-t border-line px-2 py-2">
          <span className={`flex justify-end ${hovered ? "" : "invisible"}`}>
            <IconButton label={f.copy.common.edit} icon="pencil" size="sm" />
            <IconButton label={f.copy.common.more} icon="more" size="sm" />
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="border-t border-line-muted bg-surface-muted px-10 pb-4 pt-3">
            <div className="grid grid-cols-2 gap-6">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <p className="text-xs text-fg-muted">{m.pricing}</p>
                <KeyValue
                  columns={3}
                  items={[
                    { label: m.cacheRead, value: usd(model.pricing.cacheRead), mono: true },
                    { label: m.cacheWrite, value: usd(model.pricing.cacheWrite), mono: true },
                    { label: m.output, value: usd(model.pricing.output), mono: true },
                  ]}
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2">
                <p className="text-xs text-fg-muted">{m.capabilities}</p>
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={model.supportsVision ? "success" : "neutral"} variant="outline">
                    {model.supportsVision ? m.images : m.textOnly}
                  </Badge>
                  <Badge tone="success" variant="outline">
                    {f.copy.traces.toolCalls}
                  </Badge>
                </p>
                <p className="pt-1">
                  <Button variant="secondary" size="xs">
                    {m.setDefault}
                  </Button>
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Band({ f }: { f: Fixtures }) {
  return <Table f={f} />;
}

function Plain({ f }: { f: Fixtures }) {
  const v = f.copy.vault;
  const cell = "border-b border-line-muted px-3 py-2.5";
  return (
    <table className="w-full border-collapse">
      <TableHead band={false}>
        <Th>{v.columns.name}</Th>
        <Th>{v.columns.kind}</Th>
        <Th>{v.columns.usedBy}</Th>
        <Th align="right">{v.columns.updated}</Th>
      </TableHead>
      <tbody>
        {f.vault.map((row) => (
          <tr key={row.name}>
            <td className={cell}>
              <span className="flex items-center gap-2">
                <GlyphIcon name="key" size={14} className="text-fg-subtle" />
                <span className="font-mono text-xs text-fg">{row.name}</span>
              </span>
            </td>
            <td className={`${cell} text-sm text-fg-muted`}>{row.kind}</td>
            <td className={cell}>
              <span className="flex items-center gap-1">
                {row.agents.length === 0 ? (
                  <span className="text-sm text-fg-subtle">—</span>
                ) : (
                  row.agents.map((id) => (
                    <AgentTile
                      key={id}
                      id={id}
                      name={f.agents.find((a) => a.id === id)?.name ?? id}
                      size={18}
                    />
                  ))
                )}
              </span>
            </td>
            <td className={`${cell} text-right text-xs tabular-nums text-fg-muted`}>
              {row.updated}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ListRow({
  lead,
  title,
  meta,
  trailing,
}: {
  lead: ReactNode;
  title: ReactNode;
  meta: string;
  trailing: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-line-muted px-2 py-2.5">
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">{title}</span>
        <span className="block truncate text-xs text-fg-muted">{meta}</span>
      </span>
      {trailing}
    </li>
  );
}

function Dense({ f }: { f: Fixtures }) {
  const c = f.copy.common;
  const facts = f.copy.plugins.facts;
  const library = f.pluginLibrary;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <KeyValue
        items={[
          { label: facts.installed, value: String(library.installed) },
          { label: facts.enabled, value: String(library.enabled) },
          { label: facts.skills, value: String(library.skills) },
          { label: facts.mcpServers, value: String(library.mcpServers) },
          { label: facts.updates, value: String(library.updates) },
          { label: facts.lastSync, value: library.lastSync, mono: true },
        ]}
      />
      <div>
        <GroupHeader label={f.copy.plugins.installed} count={library.installed} />
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {f.plugins.map((row) => (
            <ListRow
              key={row.name}
              lead={
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg">
                  <GlyphIcon name={row.icon} size={16} />
                </span>
              }
              title={
                <>
                  {row.name} <span className="font-mono text-xs text-fg-subtle">{row.version}</span>
                </>
              }
              meta={row.description}
              trailing={<Switch on={row.enabled} />}
            />
          ))}
        </ul>
        <div className="flex items-center justify-end gap-2 border-t border-line-muted pt-2 text-xs text-fg-muted">
          <span className="tabular-nums">{c.range(1, f.plugins.length, library.installed)}</span>
          <IconButton label={c.previousPage} icon="chevronLeft" size="sm" />
          <IconButton label={c.nextPage} icon="chevronRight" size="sm" hovered />
        </div>
      </div>
    </div>
  );
}

function Expandable({ f }: { f: Fixtures }) {
  return <Table f={f} expanded={f.models[2]!.modelId} />;
}

const VARIANTS = { band: Band, plain: Plain, dense: Dense, expandable: Expandable } as const;

export const module = defineModule({
  id: "tables",
  title: "Tables & lists",
  description:
    "The models table with a band header, sortable columns and an expandable row; a plain vault table; key-value facts and installed plugins as list rows with a pager.",
  width: "wide",
  variants: [
    { key: "band", title: "Band" },
    { key: "plain", title: "Plain" },
    { key: "dense", title: "Dense" },
    { key: "expandable", title: "Expandable" },
  ],
  parts: [
    "data-table",
    "data-key-value",
    "layout-list-row",
    "navigation-group-header",
    "icons-logos",
    "feedback-badge",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Band;
    return <View f={fixturesFor(lang)} />;
  },
});

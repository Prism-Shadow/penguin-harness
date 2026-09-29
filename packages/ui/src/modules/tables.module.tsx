/**
 * Tables & lists: the models table with a band header, sortable columns, a filter, hover actions
 * and rows that open to their details — the reader's to sort, narrow and open; the vault table
 * under a plain header; a dense view of key-value facts and installed plugins as list rows with a
 * group header and a pager; and the models table with a row expanded to its details.
 * Static stand-ins for W4's `Table`, `KeyValue`, `ListRow`, `GroupHeader` and `Pager`.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures, ModelFixture } from "../fixtures";
import { defineModule } from "../module";
import { AgentTile } from "../screens/parts";
import { tokens, usd } from "../screens/format";
import {
  Badge,
  Button,
  EmptyState,
  GlyphIcon,
  GroupHeader,
  IconButton,
  KeyValue,
  SearchInput,
  Switch,
} from "./parts";
import { filterModels, nextModelSort, sortModels } from "./interaction";
import type { ModelSort, ModelSortKey } from "./interaction";

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

/**
 * A column head. `sorted` draws the direction the column is sorted in; `onSort` makes the head a
 * button that sorts by it, which is how a reader finds out the others sort too.
 */
function Th({
  children,
  align = "left",
  sorted,
  onSort,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  sorted?: "asc" | "desc";
  onSort?: () => void;
}) {
  const inner = `inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`;
  const label = (
    <>
      {children}
      {sorted && <GlyphIcon name={sorted === "asc" ? "arrowUp" : "arrowDown"} size={12} />}
    </>
  );
  return (
    <th
      aria-sort={sorted === undefined ? undefined : sorted === "asc" ? "ascending" : "descending"}
      className={`whitespace-nowrap px-3 py-2 font-(--ui-weight-medium) ${align === "right" ? "text-right" : "text-left"} ${sorted ? "text-fg" : ""}`}
    >
      {onSort === undefined ? (
        <span className={inner}>{label}</span>
      ) : (
        <button
          type="button"
          onClick={onSort}
          className={`${inner} rounded-xs transition-colors duration-150 hover:text-fg`}
        >
          {label}
        </button>
      )}
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

/**
 * The models table. As a still it lists the first six models, the output column sorted, with one
 * row opened (`expanded`) or one row under the pointer; `live` hands it the reader's rows, sort,
 * pointer and opened rows instead, and makes the heads and rows answer.
 */
function Table({
  f,
  models = f.models.slice(0, 6),
  expanded,
  hovered,
  live,
}: {
  f: Fixtures;
  models?: readonly ModelFixture[];
  /** A model id whose row is opened on its details; any value draws the chevron column. */
  expanded?: string;
  /** A model id whose row is under the pointer, its actions showing. */
  hovered?: string;
  live?: {
    sort: ModelSort;
    onSort: (key: ModelSortKey) => void;
    open: ReadonlySet<string>;
    onToggle: (modelId: string) => void;
    onHover: (modelId: string | undefined) => void;
    /** What to show when the filter left no row. */
    empty: ReactNode;
  };
}) {
  const m = f.copy.models;
  const expandable = live !== undefined || expanded !== undefined;
  // A still sorts the output column, largest first.
  const sortOf = (key: ModelSortKey): ModelSort["dir"] | undefined =>
    live
      ? live.sort.key === key
        ? live.sort.dir
        : undefined
      : key === "output"
        ? "desc"
        : undefined;
  const onSort = (key: ModelSortKey) => live && (() => live.onSort(key));
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full border-collapse">
        <TableHead band>
          {expandable && <th className="w-8" />}
          <Th sorted={sortOf("model")} onSort={onSort("model")}>
            {m.model}
          </Th>
          <Th align="right" sorted={sortOf("context")} onSort={onSort("context")}>
            {m.context}
          </Th>
          <Th align="right" sorted={sortOf("cacheRead")} onSort={onSort("cacheRead")}>
            {m.cacheRead}
          </Th>
          <Th align="right" sorted={sortOf("output")} onSort={onSort("output")}>
            {m.output}
          </Th>
          <Th align="right">{m.images}</Th>
          <th className="w-20" />
        </TableHead>
        <tbody>
          {models.map((model) => (
            <ModelRows
              key={model.modelId}
              f={f}
              model={model}
              open={live ? live.open.has(model.modelId) : model.modelId === expanded}
              hovered={model.modelId === hovered}
              expandable={expandable}
              onToggle={live && (() => live.onToggle(model.modelId))}
              onHover={live && ((inside) => live.onHover(inside ? model.modelId : undefined))}
            />
          ))}
          {live && models.length === 0 && (
            <tr>
              <td colSpan={7} className="border-t border-line">
                {live.empty}
              </td>
            </tr>
          )}
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
  onToggle,
  onHover,
}: {
  f: Fixtures;
  model: ModelFixture;
  open: boolean;
  hovered: boolean;
  expandable: boolean;
  /** Makes the row open and fold on a click, its chevron the keyboard's way in. */
  onToggle?: () => void;
  /** The pointer came onto the row (true) or left it (false). */
  onHover?: (inside: boolean) => void;
}) {
  const m = f.copy.models;
  const cell = "border-t border-line px-3 py-2 text-right font-mono text-xs tabular-nums text-fg";
  return (
    <>
      <tr
        onClick={onToggle}
        onPointerEnter={onHover && (() => onHover(true))}
        onPointerLeave={onHover && (() => onHover(false))}
        className={`${hovered || open ? "bg-surface-muted" : ""} ${onToggle ? "cursor-pointer" : ""}`}
      >
        {expandable && (
          <td className="border-t border-line pl-3 text-fg-subtle">
            {onToggle === undefined ? (
              <GlyphIcon name={open ? "chevronDown" : "chevronRight"} size={14} />
            ) : (
              <button
                type="button"
                aria-expanded={open}
                aria-label={model.displayName}
                onClick={(event) => {
                  // The row answers the click too; the button is only the keyboard's way in.
                  event.stopPropagation();
                  onToggle();
                }}
                className="flex rounded-xs"
              >
                <GlyphIcon name={open ? "chevronDown" : "chevronRight"} size={14} />
              </button>
            )}
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

/**
 * The band table as the reader uses it. It opens on the still — the first six models under the
 * output column sorted largest first, the third row under the pointer — and from there a column
 * head sorts by it (again to flip it), the search narrows the rows by name, id or provider, a row
 * under the pointer shows its actions, and a click opens the row on its prices and capabilities.
 */
function Band({ f }: { f: Fixtures }) {
  const all = f.models.slice(0, 6);
  const [sort, setSort] = useState<ModelSort>({ key: "output", dir: "desc" });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState(() => sortModels(all, sort)[2]?.modelId);
  const rows = sortModels(filterModels(all, query), sort);
  const n = f.emptyStates.noResults;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="w-72">
        <SearchInput
          value={query}
          placeholder={f.copy.models.search}
          clearLabel={n.clear}
          onValueChange={setQuery}
        />
      </div>
      <Table
        f={f}
        models={rows}
        hovered={hovered}
        live={{
          sort,
          onSort: (key) => setSort((now) => nextModelSort(now, key)),
          open,
          onToggle: (id) =>
            setOpen((now) => {
              const next = new Set(now);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            }),
          onHover: setHovered,
          empty: (
            <EmptyState
              variant="list"
              title={n.title}
              description={n.body}
              action={
                <Button
                  variant="secondary"
                  leading={<GlyphIcon name="cross" size={13} />}
                  onClick={() => setQuery("")}
                >
                  {n.clear}
                </Button>
              }
            />
          ),
        }}
      />
    </div>
  );
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
    { key: "band", title: "Band", kind: "interactive" },
    { key: "plain", title: "Plain", kind: "static" },
    { key: "dense", title: "Dense", kind: "static" },
    { key: "expandable", title: "Expandable", kind: "static" },
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

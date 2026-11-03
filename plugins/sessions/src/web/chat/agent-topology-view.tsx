/**
 * Call-graph rendering for the subagents panel: hand-rolled SVG for the edges plus absolutely
 * positioned real <button> nodes on top (real buttons keep keyboard focus, aria naming, and CSS
 * text truncation for free — an all-SVG node would have to reinvent each). Geometry comes from
 * the pure layoutTopology (agent-topology.ts), whose numbers are CSS pixels at the default 16px
 * root; the canvas sets them in rem, so a node box grows with the user's text size together with
 * the two lines it holds, and the wrapper scrolls horizontally when the tree is deeper than the
 * panel is wide.
 * Each child node shows its wall-clock elapsed time (ticking while it runs, frozen at its last
 * activity when done — never a sum of its items); the root carries no stamps and shows none.
 */
import { AgentAvatar, DurationSlot, StatusIcon } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { layoutTopology, NODE_H, NODE_W, type TopologyNode } from "./agent-topology";

/** A layout length (CSS pixels at the default 16px root) as the rem the canvas renders it in. */
const rem = (px: number): string => `${px / 16}rem`;

export function AgentTopologyView({
  nodes,
  selectedId,
  labelFor,
  onSelect,
}: {
  nodes: TopologyNode[];
  /** Session id of the highlighted node (null — e.g. a focused child from an older Task — highlights nothing). */
  selectedId: string | null;
  /** Resolved display label for a node (the view owns name resolution; the graph only renders it). */
  labelFor: (node: TopologyNode) => string;
  onSelect: (node: TopologyNode) => void;
}) {
  const layout = layoutTopology(nodes);
  return (
    <div role="group" aria-label={S.subagentPanel.topologyLabel} className="overflow-x-auto">
      <div className="relative" style={{ width: rem(layout.width), height: rem(layout.height) }}>
        {/* Edges only — nodes are HTML buttons layered above. The paths stay in layout units and
            the viewBox scales them with the canvas; the stroke keeps its width at every size. */}
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 h-full w-full text-gray-300 dark:text-gray-700"
          aria-hidden
        >
          {layout.edges.map((edge) => (
            <path
              key={`${edge.fromId}>${edge.toId}`}
              d={edge.path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {layout.nodes.map(({ node, x, y }) => {
          const label = labelFor(node);
          const selected = node.sessionId === selectedId;
          const stateLabel = node.running ? S.subagentPanel.nodeRunning : S.subagentPanel.nodeDone;
          // The node renders the description truncated on its second line; the tooltip carries
          // the full sentence, which is the only place it appears untruncated.
          const tooltip =
            node.description !== null
              ? `${label} · ${stateLabel}\n${node.description}`
              : `${label} · ${stateLabel}`;
          return (
            <button
              key={node.sessionId}
              type="button"
              aria-label={`${label} · ${stateLabel}`}
              aria-pressed={selected}
              data-tooltip={tooltip}
              onClick={() => onSelect(node)}
              style={{ left: rem(x), top: rem(y), width: rem(NODE_W), height: rem(NODE_H) }}
              className={`absolute flex flex-col justify-center gap-px rounded-md border bg-white px-2 text-left transition-colors duration-150 dark:bg-gray-900 ${
                selected
                  ? "border-brand-500 ring-1 ring-brand-500"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/60"
              }`}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                <AgentAvatar id={node.agentId ?? node.sessionId} name={label} size={18} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                  {label}
                </span>
                {/* Elapsed: ticking from first appearance while running, frozen at the settled
                    span when done; omitted when the stamps are unknown (always for the root).
                    Decorative next to the label — the aria-label pins the accessible name. */}
                {(node.running ? node.startedMs !== undefined : node.elapsedMs !== undefined) && (
                  <DurationSlot
                    running={node.running}
                    sinceMs={node.startedMs}
                    durationMs={node.elapsedMs}
                  />
                )}
                {/* Status is already part of the button's accessible name: keep the glyph decorative. */}
                <StatusIcon state={node.running ? "running" : "done"} size="xs" />
              </span>
              {/* Second line: what this child was spawned to do. It sits a rung below the
                  name (small under body), so the node reads as who first and what second — CJK
                  text on the name's own rung looks larger than a Latin name above it. Indented to
                  the label's own left edge (avatar width + gap) and truncated to one line — the
                  model writes a free-form sentence into a fixed-size box, and the full text is in
                  the tooltip. Nodes without one (the root, a standalone child, an omitted
                  description) drop the line and the single row centers itself in the box instead. */}
              {node.description !== null && (
                <span className="w-full truncate pl-[24px] text-xs leading-tight text-fg-subtle">
                  {node.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Call-graph rendering for the subagents panel: hand-rolled SVG for the edges plus absolutely
 * positioned real <button> nodes on top (real buttons keep keyboard focus, aria naming, and CSS
 * text truncation for free — an all-SVG node would have to reinvent each). Geometry comes from
 * the pure layoutTopology (agent-topology.ts); the canvas renders at its natural pixel size and
 * the wrapper scrolls horizontally when the tree is deeper than the panel is wide.
 * Each child node shows its wall-clock elapsed time (ticking while it runs, frozen at its last
 * activity when done — never a sum of its items); the root carries no stamps and shows none.
 */
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { StatusIcon } from "../../components/ui/status-icon";
import { LiveDuration } from "./live-duration";
import { layoutTopology, NODE_H, NODE_W } from "./agent-topology";
import type { TopologyNode } from "./agent-topology";

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
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        {/* Edges only — nodes are HTML buttons layered above. */}
        <svg
          width={layout.width}
          height={layout.height}
          className="absolute inset-0 text-gray-300 dark:text-gray-700"
          aria-hidden
        >
          {layout.edges.map((edge) => (
            <path
              key={`${edge.fromId}>${edge.toId}`}
              d={edge.path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
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
              title={tooltip}
              onClick={() => onSelect(node)}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              className={`absolute flex flex-col justify-center gap-0.5 rounded-md border bg-white px-2 text-left transition-colors duration-150 dark:bg-gray-900 ${
                selected
                  ? "border-brand-500 ring-1 ring-brand-500"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/60"
              }`}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                <AgentAvatar id={node.agentId ?? node.sessionId} name={label} size={18} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                  {label}
                </span>
                {/* Elapsed: ticking from first appearance while running, frozen at the settled
                    span when done; omitted when the stamps are unknown (always for the root).
                    Decorative next to the label — the aria-label pins the accessible name. */}
                {node.running
                  ? node.startedMs !== undefined && (
                      <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
                        <LiveDuration sinceMs={node.startedMs} />
                      </span>
                    )
                  : node.elapsedMs !== undefined && (
                      <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
                        {humanizeDuration(node.elapsedMs)}
                      </span>
                    )}
                {/* Status is already part of the button's accessible name: keep the glyph decorative. */}
                <StatusIcon state={node.running ? "running" : "done"} size={10} />
              </span>
              {/* Second line: what this child was spawned to do. Indented to the label's own
                  left edge (avatar width + gap) and truncated to one line — the model writes a
                  free-form sentence into a fixed-size box, and the full text is in the tooltip.
                  Nodes without one (the root, a standalone child, an omitted description) drop
                  the line and the single row centers itself in the box instead. */}
              {node.description !== null && (
                <span className="w-full truncate pl-[24px] text-[10px] leading-tight text-gray-400 dark:text-gray-500">
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

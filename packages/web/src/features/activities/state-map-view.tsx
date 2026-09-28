/**
 * The behavior map beside or under the player, so what the module does can be read with it: the
 * scene's phases top to bottom, forward transitions as solid curves, returns dashed, and
 * the phase the activity reports itself in highlighted as it plays.
 *
 * The machine is read from the module's own configuration through the sandbox payload,
 * never from the playing page, so the map shows what the module declares rather than what
 * a page chose to say.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  machineOf,
  machineScenes,
  phaseDetails,
  sceneMap,
  stepZoom,
  type MapNode,
  type MapTrigger,
  type StateMachine,
} from "./state-map";
import { liveTargets } from "./map-split";
import type { PlayerInteractable } from "./player-bridge";

/** A trigger in the author's words; an event keeps the name the module gave it. */
function triggerText(trigger: MapTrigger): string {
  const words = S.activities.studioPlayer.map.trigger;
  if (trigger.kind === "event") return trigger.name;
  if (trigger.kind === "after") return words.after(trigger.ms);
  return words[trigger.kind];
}

const WIDTH = 360;
const ROW = 64;
const NODE_HEIGHT = 28;
const PAD = 18;

function centre(node: MapNode) {
  return {
    x: PAD + ((WIDTH - PAD * 2) * (node.column + 0.5)) / node.columns,
    y: PAD + NODE_HEIGHT / 2 + node.depth * ROW,
  };
}
const nodeWidth = (node: MapNode) => Math.min(132, (WIDTH - PAD * 2) / node.columns - 14);

/**
 * The current state's tap targets under the drawing: the first few, each outlining its
 * element in the player while pointed at or focused, and pinning the outline when pressed.
 */
function LiveTargets({
  phase,
  interactables,
  outlined,
  onOutline,
  onPin,
}: {
  phase: string;
  interactables: readonly PlayerInteractable[];
  outlined: string | null;
  onOutline: (id: string | null) => void;
  onPin: (id: string) => void;
}) {
  const words = S.activities.studioPlayer.map;
  const { shown, more } = liveTargets(interactables);
  return (
    <div
      role="group"
      aria-label={words.liveTargets(phase)}
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      <span className="text-gray-500">{words.liveCount(interactables.length)}</span>
      {shown.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={outlined === entry.id}
          title={words.targetTitle(entry.id, words.inputTypes[entry.inputType])}
          onMouseEnter={() => onOutline(entry.id)}
          onMouseLeave={() => onOutline(null)}
          onFocus={() => onOutline(entry.id)}
          onBlur={() => onOutline(null)}
          onClick={() => onPin(entry.id)}
          className={`max-w-full truncate rounded-md border px-2 py-0.5 ${
            outlined === entry.id
              ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
              : "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          }`}
        >
          {entry.description ?? entry.id}
        </button>
      ))}
      {more > 0 && <span className="text-gray-500">{words.more(more)}</span>}
    </div>
  );
}

/** One labelled list of the inspector; says "Nothing" rather than vanish. */
function Facts({ label, items }: { label: string; items: ReactNode[] }) {
  return (
    <div>
      <dt className="font-medium text-gray-600 dark:text-gray-400">{label}</dt>
      <dd>
        {items.length ? (
          <ul className="space-y-0.5">
            {items.map((item, index) => (
              <li key={index} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-gray-500">{S.activities.studioPlayer.map.inspect.nothing}</span>
        )}
      </dd>
    </div>
  );
}

function PhaseInspector({
  machine,
  sceneId,
  phaseId,
  onChoose,
  onClose,
}: {
  machine: StateMachine;
  sceneId: string;
  phaseId: string;
  onChoose: (phase: string) => void;
  onClose: () => void;
}) {
  const words = S.activities.studioPlayer.map.inspect;
  const details = phaseDetails(machine, sceneId, phaseId);
  if (!details) return null;
  const link = (phase: string) => (
    <button
      type="button"
      className="text-brand-600 hover:text-brand-700 dark:text-brand-300"
      onClick={() => onChoose(phase)}
    >
      {phase}
    </button>
  );
  return (
    <section
      aria-label={words.title(details.id)}
      className="space-y-2 rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-800"
    >
      <div className="flex items-center gap-2">
        <h5 className="min-w-0 flex-1 break-all font-semibold">{words.title(details.id)}</h5>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {words.close}
        </Button>
      </div>
      {(details.initial || details.final) && (
        <p className="text-gray-500">
          {[details.initial && words.initial, details.final && words.final]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <dl className="grid gap-2 sm:grid-cols-2">
        <Facts label={words.entry} items={details.entry} />
        <Facts label={words.exit} items={details.exit} />
        <Facts label={words.invokes} items={details.invokes} />
        <Facts
          label={words.incoming}
          items={details.incoming.map((edge) => (
            <>
              {link(edge.from)}, {words.via(triggerText(edge.trigger))}
            </>
          ))}
        />
        <Facts
          label={words.outgoing}
          items={details.outgoing.map((edge) =>
            edge.leaves ? (
              words.leaves(triggerText(edge.trigger), edge.to)
            ) : (
              <>
                {words.via(triggerText(edge.trigger))}, {words.to} {link(edge.to)}
              </>
            ),
          )}
        />
      </dl>
    </section>
  );
}

function SceneGraph({
  machine,
  sceneId,
  livePhase,
  zoom,
  onZoom,
  interactables,
  outlined,
  onOutline,
  onPin,
}: {
  machine: StateMachine;
  sceneId: string;
  livePhase: string | null;
  /** What can be tapped in the live phase, as the player reports it. */
  interactables: readonly PlayerInteractable[];
  outlined: string | null;
  onOutline: (id: string | null) => void;
  onPin: (id: string) => void;
  /** The drawing's width as a multiple of the panel's; 1 fits it. */
  zoom: number;
  onZoom: (direction: 1 | -1) => void;
}) {
  const words = S.activities.studioPlayer.map;
  const [inspected, setInspected] = useState<string | null>(null);
  useEffect(() => setInspected(null), [sceneId]);
  const marker = `arrow-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const map = useMemo(() => sceneMap(machine, sceneId), [machine, sceneId]);
  if (!map) return null;
  // The player reports only the state it is in, so only that node has tap targets.
  const liveHere = !!livePhase && map.nodes.some((node) => node.id === livePhase);
  const targets = liveHere ? interactables : [];
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const height = PAD * 2 + NODE_HEIGHT + Math.max(0, ...map.nodes.map((n) => n.depth)) * ROW;
  // Two transitions between the same phases are one line with both names.
  const lines = new Map<string, { from: MapNode; to: MapNode; labels: string[]; back: boolean }>();
  for (const edge of map.edges) {
    const key = `${edge.from}->${edge.to}`;
    const entry = lines.get(key);
    if (entry) entry.labels.push(triggerText(edge.trigger));
    else
      lines.set(key, {
        from: byId.get(edge.from)!,
        to: byId.get(edge.to)!,
        labels: [triggerText(edge.trigger)],
        back: edge.back,
      });
  }
  return (
    <div className="space-y-2">
      <div
        className="max-h-[32rem] overflow-auto"
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          onZoom(event.deltaY < 0 ? 1 : -1);
        }}
      >
        <svg
          role="group"
          aria-label={words.graph(sceneId)}
          viewBox={`0 0 ${WIDTH} ${height}`}
          style={{ width: `${zoom * 100}%` }}
          className="max-w-none"
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0L8 4L0 8z" className="fill-gray-400 dark:fill-gray-500" />
            </marker>
          </defs>
          {[...lines.values()].map(({ from, to, labels, back }) => {
            const a = centre(from);
            const b = centre(to);
            const label = labels.join(", ");
            let d: string;
            let lx: number;
            let ly: number;
            if (from === to) {
              const x = a.x + nodeWidth(from) / 2;
              d = `M${x} ${a.y - 6} C${x + 28} ${a.y - 20} ${x + 28} ${a.y + 20} ${x} ${a.y + 6}`;
              lx = x + 26;
              ly = a.y + 3;
            } else if (!back) {
              const y1 = a.y + NODE_HEIGHT / 2;
              const y2 = b.y - NODE_HEIGHT / 2;
              d = `M${a.x} ${y1} C${a.x} ${y1 + 22} ${b.x} ${y2 - 22} ${b.x} ${y2}`;
              lx = (a.x + b.x) / 2 + 6;
              ly = (y1 + y2) / 2 + 3;
            } else {
              // A return swings out past the side it is nearer, clear of the forward path.
              const left = a.x <= WIDTH / 2;
              const x1 = a.x + ((left ? -1 : 1) * nodeWidth(from)) / 2;
              const x2 = b.x + ((left ? -1 : 1) * nodeWidth(to)) / 2;
              const swing = left ? Math.min(x1, x2) - 34 : Math.max(x1, x2) + 34;
              d = `M${x1} ${a.y} C${swing} ${a.y} ${swing} ${b.y} ${x2} ${b.y}`;
              lx = swing + (left ? -2 : 2);
              ly = (a.y + b.y) / 2 + 3;
            }
            return (
              <g key={`${from.id}->${to.id}`}>
                <path
                  d={d}
                  fill="none"
                  strokeWidth="1.5"
                  strokeDasharray={back ? "4 3" : undefined}
                  markerEnd={`url(#${marker})`}
                  className="stroke-gray-300 dark:stroke-gray-600"
                />
                <text
                  x={lx}
                  y={ly}
                  fontSize="10"
                  textAnchor={back && lx < WIDTH / 2 ? "end" : "start"}
                  className="fill-gray-500"
                >
                  {label}
                </text>
              </g>
            );
          })}
          {map.nodes.map((node) => {
            const { x, y } = centre(node);
            const width = nodeWidth(node);
            const live = node.id === livePhase;
            const chosen = node.id === inspected;
            const choose = () => setInspected(chosen ? null : node.id);
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={chosen}
                aria-label={live ? words.live(node.id) : node.id}
                aria-current={live ? "step" : undefined}
                className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-brand-500"
                onClick={choose}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  choose();
                }}
              >
                <title>{live ? words.live(node.id) : node.id}</title>
                <rect
                  x={x - width / 2}
                  y={y - NODE_HEIGHT / 2}
                  width={width}
                  height={NODE_HEIGHT}
                  rx={node.final ? NODE_HEIGHT / 2 : 6}
                  strokeWidth={chosen ? "2.5" : live ? "1.5" : "1"}
                  className={`${
                    live ? "fill-brand-50 dark:fill-brand-950" : "fill-white dark:fill-gray-900"
                  } ${
                    live || chosen
                      ? "stroke-brand-600 dark:stroke-brand-300"
                      : "stroke-gray-300 dark:stroke-gray-700"
                  }`}
                />
                <text
                  x={x}
                  y={y + 4}
                  fontSize="11"
                  textAnchor="middle"
                  className={
                    live
                      ? "fill-brand-700 font-semibold dark:fill-brand-200"
                      : "fill-gray-700 dark:fill-gray-300"
                  }
                >
                  {node.id.length > 18 ? `${node.id.slice(0, 17)}…` : node.id}
                </text>
                {live && targets.length > 0 && (
                  <text
                    x={x + width / 2 - 2}
                    y={y - NODE_HEIGHT / 2 - 3}
                    fontSize="9"
                    textAnchor="end"
                    className="fill-brand-700 dark:fill-brand-200"
                  >
                    {words.liveCount(targets.length)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {livePhase && targets.length > 0 && (
        <LiveTargets
          phase={livePhase}
          interactables={targets}
          outlined={outlined}
          onOutline={onOutline}
          onPin={onPin}
        />
      )}
      {inspected ? (
        <PhaseInspector
          machine={machine}
          sceneId={sceneId}
          phaseId={inspected}
          onChoose={setInspected}
          onClose={() => setInspected(null)}
        />
      ) : (
        <p className="text-xs text-gray-500">{words.inspect.hint}</p>
      )}
      {map.exits.length > 0 && (
        <div className="space-y-0.5 text-xs text-gray-500">
          <p className="font-medium">{words.leaves}</p>
          <ul>
            {map.exits.map((exit) => (
              <li key={`${exit.from}:${triggerText(exit.trigger)}:${exit.to}`} className="truncate">
                {words.exit(exit.from, triggerText(exit.trigger), exit.to.replace(/^#/, ""))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StateMapView({
  base,
  language,
  reportedScene,
  reportedPhase,
  startScene,
  open,
  onToggle,
  interactables,
  outlined,
  onOutline,
  onPin,
}: {
  /** Whether the map is shown; the header stays either way, so it can be shown again. */
  open: boolean;
  onToggle: () => void;
  /** The activity's sandbox API path. */
  base: string;
  language: string;
  reportedScene: string | null;
  reportedPhase: string | null;
  startScene: string;
  /** The tap targets the player reports for the state it is in. */
  interactables: readonly PlayerInteractable[];
  /** The tap target pinned as outlined in the player, if any. */
  outlined: string | null;
  /** Outline a tap target while it is pointed at, or go back to the pinned one with null. */
  onOutline: (id: string | null) => void;
  /** Pin or unpin a tap target's outline, as its chip under the player does. */
  onPin: (id: string) => void;
}) {
  const words = S.activities.studioPlayer.map;
  const [read, setRead] = useState<
    | { state: "loading" }
    | { state: "none" }
    | { state: "error"; message: string }
    | { state: "ready"; machine: StateMachine }
  >({ state: "loading" });
  const [choice, setChoice] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRead({ state: "loading" });
    const query = language ? `?${new URLSearchParams({ language })}` : "";
    apiFetch<{ configuration: unknown }>(`${base}/payload${query}`)
      .then((payload) => {
        if (cancelled) return;
        const machine = machineOf(payload.configuration);
        setRead(machine ? { state: "ready", machine } : { state: "none" });
      })
      .catch((cause) => {
        if (!cancelled) setRead({ state: "error", message: apiErrorText(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [base, language, open]);
  // A scene change in the player takes the map with it; a scene the author picked holds
  // until then.
  useEffect(() => setChoice(null), [reportedScene]);

  const machine = open && read.state === "ready" ? read.machine : null;
  const scenes = machine ? machineScenes(machine) : [];
  const shown =
    choice ??
    (reportedScene && scenes.includes(reportedScene)
      ? reportedScene
      : scenes.includes(startScene)
        ? startScene
        : machine && scenes.includes(machine.initial)
          ? machine.initial
          : (scenes[0] ?? ""));
  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center gap-2">
        <button
          type="button"
          aria-pressed={open}
          onClick={onToggle}
          className="min-w-0 flex-1 text-left text-xs text-brand-700 hover:underline dark:text-brand-300"
        >
          {words.toggle}
        </button>
        {machine && scenes.length > 0 && (
          <div role="group" aria-label={words.zoom} className="flex items-center">
            <Button
              size="sm"
              variant="ghost"
              aria-label={words.zoomOut}
              disabled={stepZoom(zoom, -1) === zoom}
              onClick={() => setZoom(stepZoom(zoom, -1))}
            >
              −
            </Button>
            <span
              aria-live="polite"
              className="w-10 text-center text-xs tabular-nums text-gray-500"
            >
              {words.zoomLevel(Math.round(zoom * 100))}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={words.zoomIn}
              disabled={stepZoom(zoom, 1) === zoom}
              onClick={() => setZoom(stepZoom(zoom, 1))}
            >
              +
            </Button>
            <Button size="sm" variant="ghost" disabled={zoom === 1} onClick={() => setZoom(1)}>
              {words.zoomFit}
            </Button>
          </div>
        )}
        {scenes.length > 1 && (
          <div className="w-40">
            <Select
              size="sm"
              aria-label={words.scene}
              value={shown}
              onChange={(event) => setChoice(event.target.value)}
            >
              {scenes.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {!open ? null : read.state === "loading" ? (
        <p className="text-xs text-gray-500">{words.loading}</p>
      ) : read.state === "error" ? (
        <p className={`text-xs ${toneInk.attention}`}>{words.unreadable(read.message)}</p>
      ) : !machine || !scenes.length ? (
        <p className="text-xs text-gray-500">{words.none}</p>
      ) : (
        <SceneGraph
          machine={machine}
          sceneId={shown}
          livePhase={shown === reportedScene ? reportedPhase : null}
          zoom={zoom}
          onZoom={(direction) => setZoom((current) => stepZoom(current, direction))}
          interactables={interactables}
          outlined={outlined}
          onOutline={onOutline}
          onPin={onPin}
        />
      )}
    </div>
  );
}

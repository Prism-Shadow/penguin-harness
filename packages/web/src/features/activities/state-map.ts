/**
 * The behavior map drawn under the player: one scene of the module's state machine, as
 * phases and the transitions between them, laid out top to bottom from the scene's first
 * phase.
 *
 * The machine is the module's own, read from its configuration (`stateMachine`, or
 * `activityMachine` in older modules), in the shape Loom's `waf-state-machine` defines:
 * one compound state per scene whose child states are the scene's phases, so a running
 * activity reports itself as `<scene>.<phase>`. A module without one has no map, and the
 * panel says so rather than drawing a guess.
 *
 * Everything here reads untrusted JSON, so it takes only strings it can check and never
 * assumes a shape.
 */

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

export interface StateMachine {
  initial: string;
  states: Json;
}

/** The module's machine, or null when its configuration carries none worth drawing. */
export function machineOf(configuration: unknown): StateMachine | null {
  const config = object(configuration);
  const machine = object(config?.stateMachine) ?? object(config?.activityMachine);
  const states = object(machine?.states);
  if (!machine || !states || typeof machine.initial !== "string") return null;
  return { initial: machine.initial, states };
}

/** The scenes the machine has, in its own order; `activity` is its frame, not a scene. */
export function machineScenes(machine: StateMachine): string[] {
  return Object.keys(machine.states).filter(
    (id) => id !== "activity" && object(object(machine.states[id])?.states) !== null,
  );
}

export interface MapNode {
  id: string;
  /** Rows from the scene's first phase; unreachable phases sit on a row after the rest. */
  depth: number;
  /** Position within its row, and how many share the row. */
  column: number;
  columns: number;
  initial: boolean;
  final: boolean;
}

/** What fires a transition; the view words it. */
export type MapTrigger =
  | { kind: "event"; name: string }
  | { kind: "after"; ms: string }
  | { kind: "done" }
  | { kind: "error" };

export interface MapEdge {
  from: string;
  to: string;
  trigger: MapTrigger;
  /** Goes back up the map or stays on its row: drawn dashed, the way a retry reads. */
  back: boolean;
}

/** A transition that leaves the scene, for the list under the drawing. */
export interface MapExit {
  from: string;
  to: string;
  trigger: MapTrigger;
}

export interface SceneMap {
  nodes: MapNode[];
  edges: MapEdge[];
  exits: MapExit[];
}

function targets(transition: unknown): string[] {
  const list = Array.isArray(transition) ? transition : [transition];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const target = object(entry)?.target;
    return typeof target === "string" ? [target] : [];
  });
}

/** Every transition a phase declares, with what fires it. */
function transitionsOf(phase: Json): { trigger: MapTrigger; target: string }[] {
  const found: { trigger: MapTrigger; target: string }[] = [];
  for (const [name, transition] of Object.entries(object(phase.on) ?? {}))
    for (const target of targets(transition))
      found.push({ trigger: { kind: "event", name }, target });
  for (const [ms, transition] of Object.entries(object(phase.after) ?? {}))
    for (const target of targets(transition))
      found.push({ trigger: { kind: "after", ms }, target });
  const invoke = object(phase.invoke);
  if (invoke) {
    for (const target of targets(invoke.onDone)) found.push({ trigger: { kind: "done" }, target });
    for (const target of targets(invoke.onError))
      found.push({ trigger: { kind: "error" }, target });
  }
  return found;
}

/**
 * A target as a phase of this scene, or null when it leaves the scene. XState writes a
 * sibling by name, a state anywhere by `#id`, and a nested one with dots.
 */
function localPhase(target: string, sceneId: string, phases: ReadonlySet<string>): string | null {
  const bare = target.startsWith("#") ? target.slice(1) : target;
  if (phases.has(bare)) return bare;
  const parts = bare.split(".");
  const last = parts[parts.length - 1]!;
  if (parts.length > 1 && parts[parts.length - 2] === sceneId && phases.has(last)) return last;
  return null;
}

export function sceneMap(machine: StateMachine, sceneId: string): SceneMap | null {
  const scene = object(machine.states[sceneId]);
  const children = object(scene?.states);
  if (!scene || !children) return null;
  const ids = Object.keys(children);
  const phases = new Set(ids);
  const initial =
    typeof scene.initial === "string" && phases.has(scene.initial) ? scene.initial : ids[0];

  const edges: MapEdge[] = [];
  const exits: MapExit[] = [];
  for (const id of ids)
    for (const { trigger, target } of transitionsOf(object(children[id]) ?? {})) {
      const to = localPhase(target, sceneId, phases);
      if (to) edges.push({ from: id, to, trigger, back: false });
      else exits.push({ from: id, to: target, trigger });
    }

  // Rows by the shortest path from the first phase, so the map reads in the order a
  // learner meets the phases.
  const depth = new Map<string, number>();
  if (initial) {
    depth.set(initial, 0);
    const queue = [initial];
    while (queue.length) {
      const at = queue.shift()!;
      for (const edge of edges)
        if (edge.from === at && !depth.has(edge.to)) {
          depth.set(edge.to, depth.get(at)! + 1);
          queue.push(edge.to);
        }
    }
  }
  const unreachable = Math.max(-1, ...depth.values()) + 1;
  for (const id of ids) if (!depth.has(id)) depth.set(id, unreachable);
  for (const edge of edges) edge.back = depth.get(edge.to)! <= depth.get(edge.from)!;

  const rows = new Map<number, string[]>();
  for (const id of ids) rows.set(depth.get(id)!, [...(rows.get(depth.get(id)!) ?? []), id]);
  const nodes = ids.map((id) => {
    const row = rows.get(depth.get(id)!)!;
    return {
      id,
      depth: depth.get(id)!,
      column: row.indexOf(id),
      columns: row.length,
      initial: id === initial,
      final: object(children[id])?.type === "final",
    };
  });
  return { nodes, edges, exits };
}

/** What one phase does, for the inspector beside the drawing. */
export interface PhaseDetails {
  id: string;
  initial: boolean;
  final: boolean;
  /** Actions named on entering and leaving the phase, in declared order. */
  entry: string[];
  exit: string[];
  /** Services the phase runs while it is active. */
  invokes: string[];
  /** Transitions out of the phase: to another phase here, or out of the scene. */
  outgoing: { trigger: MapTrigger; to: string; leaves: boolean }[];
  /** Phases of this scene that lead here. */
  incoming: { trigger: MapTrigger; from: string }[];
}

/** Action names from XState's shapes: a name, `{ type }`, or a list of either. */
function actionNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const type = object(entry)?.type;
    return typeof type === "string" ? [type] : [];
  });
}

export function phaseDetails(
  machine: StateMachine,
  sceneId: string,
  phaseId: string,
): PhaseDetails | null {
  const map = sceneMap(machine, sceneId);
  const node = map?.nodes.find((entry) => entry.id === phaseId);
  const phase = object(object(object(machine.states[sceneId])?.states)?.[phaseId]);
  if (!map || !node || !phase) return null;
  const invoke = phase.invoke;
  const invokes = (Array.isArray(invoke) ? invoke : invoke === undefined ? [] : [invoke]).flatMap(
    (entry) => {
      const src = object(entry)?.src ?? entry;
      if (typeof src === "string") return [src];
      const type = object(src)?.type;
      return typeof type === "string" ? [type] : [];
    },
  );
  return {
    id: phaseId,
    initial: node.initial,
    final: node.final,
    entry: actionNames(phase.entry),
    exit: actionNames(phase.exit),
    invokes,
    outgoing: [
      ...map.edges
        .filter((edge) => edge.from === phaseId)
        .map((edge) => ({ trigger: edge.trigger, to: edge.to, leaves: false })),
      ...map.exits
        .filter((exit) => exit.from === phaseId)
        .map((exit) => ({ trigger: exit.trigger, to: exit.to.replace(/^#/, ""), leaves: true })),
    ],
    incoming: map.edges
      .filter((edge) => edge.to === phaseId)
      .map((edge) => ({ trigger: edge.trigger, from: edge.from })),
  };
}

/** Zoom steps for the drawing, as fractions of its natural width. */
export const MAP_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** The next zoom step in a direction, holding at either end. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return MAP_ZOOMS.find((zoom) => zoom > current + 1e-9) ?? current;
  return [...MAP_ZOOMS].reverse().find((zoom) => zoom < current - 1e-9) ?? current;
}

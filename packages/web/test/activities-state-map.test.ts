import { describe, expect, it } from "vitest";
import {
  machineOf,
  machineScenes,
  phaseDetails,
  sceneMap,
  stepZoom,
} from "../src/features/activities/state-map";

const configuration = {
  stateMachine: {
    version: "1.1",
    id: "letters",
    initial: "intro",
    states: {
      activity: { type: "compound" },
      intro: {
        initial: "playing",
        states: { playing: { invoke: { src: "playVideo", onDone: "#rocks" } } },
      },
      rocks: {
        initial: "idle",
        states: {
          idle: { after: { "500": "prompt" } },
          prompt: { invoke: { src: "say", onDone: "waiting", onError: "waiting" } },
          waiting: {
            entry: ["highlight", { type: "listen" }],
            exit: "stopListening",
            on: {
              CORRECT: { target: "correct", actions: "stopHighlight" },
              WRONG: "retry",
              HINT: {},
            },
          },
          retry: { invoke: { src: "say", onDone: "rocks.waiting" } },
          correct: { invoke: { src: "chest", onDone: "#next-round" } },
          orphan: { type: "final" },
        },
      },
    },
  },
};

describe("the behavior map", () => {
  it("reads a module's machine, including the older key, and nothing that is not one", () => {
    expect(machineOf(configuration)?.initial).toBe("intro");
    expect(machineOf({ activityMachine: configuration.stateMachine })?.initial).toBe("intro");
    expect(machineOf({})).toBeNull();
    expect(machineOf({ stateMachine: { states: [] } })).toBeNull();
    expect(machineOf("nope")).toBeNull();
    expect(machineScenes(machineOf(configuration)!)).toEqual(["intro", "rocks"]);
  });

  it("lays a scene out from its first phase and marks the way back as a return", () => {
    const map = sceneMap(machineOf(configuration)!, "rocks")!;
    expect(map.nodes.map((node) => [node.id, node.depth, node.column, node.columns])).toEqual([
      ["idle", 0, 0, 1],
      ["prompt", 1, 0, 1],
      ["waiting", 2, 0, 1],
      ["retry", 3, 0, 2],
      ["correct", 3, 1, 2],
      ["orphan", 4, 0, 1],
    ]);
    expect(map.nodes.find((node) => node.id === "idle")).toMatchObject({ initial: true });
    expect(map.nodes.find((node) => node.id === "orphan")).toMatchObject({ final: true });
    expect(map.edges).toEqual([
      { from: "idle", to: "prompt", trigger: { kind: "after", ms: "500" }, back: false },
      { from: "prompt", to: "waiting", trigger: { kind: "done" }, back: false },
      { from: "prompt", to: "waiting", trigger: { kind: "error" }, back: false },
      { from: "waiting", to: "correct", trigger: { kind: "event", name: "CORRECT" }, back: false },
      { from: "waiting", to: "retry", trigger: { kind: "event", name: "WRONG" }, back: false },
      { from: "retry", to: "waiting", trigger: { kind: "done" }, back: true },
    ]);
    expect(map.exits).toEqual([{ from: "correct", to: "#next-round", trigger: { kind: "done" } }]);
  });

  it("has no map for a scene the machine does not define", () => {
    expect(sceneMap(machineOf(configuration)!, "missing")).toBeNull();
  });
});

describe("inspecting a phase", () => {
  const machine = machineOf(configuration)!;
  it("says what a phase does on entry and exit, and how it is reached and left", () => {
    const details = phaseDetails(machine, "rocks", "waiting")!;
    expect(details.entry).toEqual(["highlight", "listen"]);
    expect(details.exit).toEqual(["stopListening"]);
    expect(details.incoming.map((edge) => edge.from)).toEqual(["prompt", "prompt", "retry"]);
    expect(details.outgoing.map((edge) => edge.to)).toEqual(["correct", "retry"]);
    const correct = phaseDetails(machine, "rocks", "correct")!;
    expect(correct.invokes).toEqual(["chest"]);
    expect(correct.outgoing).toEqual([
      { trigger: { kind: "done" }, to: "next-round", leaves: true },
    ]);
    expect(phaseDetails(machine, "rocks", "orphan")).toMatchObject({ final: true, incoming: [] });
    expect(phaseDetails(machine, "rocks", "missing")).toBeNull();
  });

  it("zooms in steps and holds at either end", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });
});

/**
 * lane-packing.ts unit tests: same-name non-overlapping calls share a lane
 * (including touching endpoints and zero-duration spans), overlapping or
 * nested same-name calls split lanes, names never mix, lane order follows
 * each name's earliest start with same-name lanes adjacent, greedy first-fit
 * reuses the earliest free lane, and unsorted input is handled.
 */
import { describe, expect, it } from "vitest";
import { packToolLanes } from "../src/features/traces/lane-packing";

interface Span {
  name: string;
  startMs: number;
  endMs: number;
  id: string;
}

const span = (name: string, startMs: number, endMs: number, id: string): Span => ({
  name,
  startMs,
  endMs,
  id,
});

const shape = (lanes: ReturnType<typeof packToolLanes<Span>>) =>
  lanes.map((l) => ({ name: l.name, ids: l.spans.map((s) => s.id) }));

describe("packToolLanes", () => {
  it("returns no lanes for no spans", () => {
    expect(packToolLanes([])).toEqual([]);
  });

  it("packs sequential same-name calls into one lane", () => {
    const lanes = packToolLanes([
      span("exec_command", 0, 10, "a"),
      span("exec_command", 20, 30, "b"),
      span("exec_command", 40, 45, "c"),
    ]);
    expect(shape(lanes)).toEqual([{ name: "exec_command", ids: ["a", "b", "c"] }]);
  });

  it("treats touching endpoints as non-overlapping", () => {
    const lanes = packToolLanes([span("read_file", 0, 10, "a"), span("read_file", 10, 20, "b")]);
    expect(shape(lanes)).toEqual([{ name: "read_file", ids: ["a", "b"] }]);
  });

  it("shares a lane with zero-duration spans", () => {
    const lanes = packToolLanes([span("read_file", 5, 5, "a"), span("read_file", 5, 9, "b")]);
    expect(shape(lanes)).toEqual([{ name: "read_file", ids: ["a", "b"] }]);
  });

  it("splits overlapping same-name calls into extra lanes", () => {
    const lanes = packToolLanes([
      span("exec_command", 0, 10, "a"),
      span("exec_command", 5, 15, "b"),
    ]);
    expect(shape(lanes)).toEqual([
      { name: "exec_command", ids: ["a"] },
      { name: "exec_command", ids: ["b"] },
    ]);
  });

  it("splits nested same-name calls into extra lanes", () => {
    const lanes = packToolLanes([
      span("run_subagent", 0, 100, "outer"),
      span("run_subagent", 10, 20, "inner"),
    ]);
    expect(shape(lanes)).toEqual([
      { name: "run_subagent", ids: ["outer"] },
      { name: "run_subagent", ids: ["inner"] },
    ]);
  });

  it("never mixes names in one lane, even when disjoint", () => {
    const lanes = packToolLanes([span("read_file", 0, 10, "a"), span("write_file", 20, 30, "b")]);
    expect(shape(lanes)).toEqual([
      { name: "read_file", ids: ["a"] },
      { name: "write_file", ids: ["b"] },
    ]);
  });

  it("orders lanes by each name's earliest start and keeps same-name lanes adjacent", () => {
    const lanes = packToolLanes([
      span("read_file", 0, 10, "r1"),
      span("write_file", 2, 6, "w1"),
      span("read_file", 4, 12, "r2"),
      span("read_file", 20, 25, "r3"),
      span("write_file", 8, 14, "w2"),
    ]);
    expect(shape(lanes)).toEqual([
      { name: "read_file", ids: ["r1", "r3"] },
      { name: "read_file", ids: ["r2"] },
      { name: "write_file", ids: ["w1", "w2"] },
    ]);
  });

  it("reuses the earliest freed lane (greedy first-fit)", () => {
    const lanes = packToolLanes([
      span("exec_command", 0, 10, "a"),
      span("exec_command", 5, 15, "b"),
      span("exec_command", 20, 30, "c"),
    ]);
    expect(shape(lanes)).toEqual([
      { name: "exec_command", ids: ["a", "c"] },
      { name: "exec_command", ids: ["b"] },
    ]);
  });

  it("sorts unsorted input by start before packing", () => {
    const lanes = packToolLanes([
      span("exec_command", 20, 30, "late"),
      span("exec_command", 0, 10, "early"),
    ]);
    expect(shape(lanes)).toEqual([{ name: "exec_command", ids: ["early", "late"] }]);
  });

  it("keeps a still-open span (endMs at the task end) blocking its lane", () => {
    const taskEnd = 100;
    const lanes = packToolLanes([
      span("exec_command", 0, taskEnd, "open"),
      span("exec_command", 50, 60, "later"),
    ]);
    expect(shape(lanes)).toEqual([
      { name: "exec_command", ids: ["open"] },
      { name: "exec_command", ids: ["later"] },
    ]);
  });
});

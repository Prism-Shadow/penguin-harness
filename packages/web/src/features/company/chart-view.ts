/**
 * The org chart's one shared reading of an employee's live state (pure, unit tested): the
 * tone its dot, its label and its finance row take. The canvas's pan and zoom arithmetic
 * lives in canvas-view.ts, the tree and its geometry in org-chart-tree.ts.
 */
import type { OrgEmployeeState } from "@prismshadow/penguin-server/api";
import type { Tone } from "../../lib/tone";

/** Busy while running, attention when its budget paused it, success on the desk — by meaning, as every status mark. */
export function employeeStateTone(state: OrgEmployeeState): Tone {
  return state === "running" ? "busy" : state === "paused" ? "attention" : "success";
}

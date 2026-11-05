/**
 * chart-view.ts unit tests: the tone an employee's live state takes. The canvas's pan and
 * zoom arithmetic is covered by canvas-view.test.ts.
 */
import { describe, expect, it } from "vitest";
import { employeeStateTone } from "../src/features/company/chart-view";

describe("employeeStateTone", () => {
  it("picks busy for running, attention for a budget pause, success on the desk", () => {
    expect(employeeStateTone("running")).toBe("busy");
    expect(employeeStateTone("paused")).toBe("attention");
    expect(employeeStateTone("idle")).toBe("success");
  });
});

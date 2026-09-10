/**
 * chart-view.ts unit tests: the zoom range and its snapped steps, the fit-to-width zoom a
 * wide chart opens at, and the tone of each employee state.
 */
import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  employeeStateTone,
  fitZoom,
  stepZoom,
} from "../src/features/company/chart-view";

describe("clampZoom and stepZoom", () => {
  it("keeps a zoom inside the range and treats a non-number as 100%", () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(0.85)).toBe(0.85);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("steps by a tenth, snapped so the readout never shows a float artefact, and stops at the ends", () => {
    expect(stepZoom(0.9, 1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.7 + 0.1, 1)).toBe(0.9);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    // A fit zoom between the grid points steps to the next grid point, not by a tenth from itself.
    expect(stepZoom(0.87, 1)).toBe(1);
    expect(stepZoom(0.87, -1)).toBe(0.8);
  });
});

describe("fitZoom", () => {
  it("is 100% while the frame is unmeasured or the drawing already fits", () => {
    expect(fitZoom(0, 1200)).toBe(1);
    expect(fitZoom(1000, 0)).toBe(1);
    expect(fitZoom(1000, 800)).toBe(1);
    expect(fitZoom(1000, 1000)).toBe(1);
  });

  it("shrinks a wide drawing to whole percents and never below the minimum", () => {
    expect(fitZoom(1000, 1104)).toBe(0.9);
    expect(fitZoom(900, 1104)).toBe(0.81);
    expect(fitZoom(300, 3000)).toBe(ZOOM_MIN);
  });
});

describe("employeeStateTone", () => {
  it("picks busy for running, attention for a budget pause, success on the desk", () => {
    expect(employeeStateTone("running")).toBe("busy");
    expect(employeeStateTone("paused")).toBe("attention");
    expect(employeeStateTone("idle")).toBe("success");
  });
});

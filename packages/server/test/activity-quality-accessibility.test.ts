/**
 * Easy for everyone to use: what axe and the keyboard probe saw, as one report. Pure: no
 * browser, only canned results.
 */
import { describe, expect, it } from "vitest";
import {
  PAGE_PROBE,
  accessibilityReport,
  accessibilityStatus,
  applyExceptions,
  axeRunScript,
  captionsAsWarnings,
  dedupe,
  keyboardFindings,
  normalizeViolations,
  readProbe,
  severityOf,
  type ProbedControl,
} from "../src/activities/quality-accessibility.js";

const axe = {
  violations: [
    {
      id: "color-contrast",
      impact: "serious",
      help: "Elements must meet minimum color contrast ratio thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
      nodes: [{ target: ["#choices > button:nth-child(1)"] }, { target: ["#title"] }],
    },
    {
      id: "region",
      impact: "minor",
      help: "All page content should be contained by landmarks",
      helpUrl: "javascript:alert(1)",
      nodes: [{ target: [["iframe", "#inside"]] }],
    },
  ],
};

const control = (overrides: Partial<ProbedControl> = {}): ProbedControl => ({
  id: "repeat",
  tag: "div",
  role: "",
  focusable: true,
  focusVisible: true,
  keyActivable: true,
  ...overrides,
});

describe("accessibility findings", () => {
  it("maps impact to severity", () => {
    expect(severityOf("critical")).toBe("must");
    expect(severityOf("serious")).toBe("must");
    expect(severityOf("moderate")).toBe("should");
    expect(severityOf("minor")).toBe("minor");
    expect(severityOf(undefined)).toBe("minor");
  });

  it("turns one serious and one minor violation into Must fix and Minor, and fails", () => {
    const findings = normalizeViolations(axe, "intro");
    expect(findings).toEqual([
      expect.objectContaining({
        code: "color-contrast",
        severity: "must",
        blocking: true,
        scene: "intro",
        target: "#choices > button:nth-child(1)",
        detail: "Elements must meet minimum color contrast ratio thresholds",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
        count: 2,
      }),
      expect.objectContaining({
        code: "region",
        severity: "minor",
        blocking: false,
        target: "iframe #inside",
        count: 1,
      }),
    ]);
    // Only an https link is kept.
    expect(findings[1]).not.toHaveProperty("helpUrl");
    expect(accessibilityStatus(findings)).toBe("failed");
  });

  it("ignores results that are not axe's", () => {
    expect(normalizeViolations(null, "intro")).toEqual([]);
    expect(normalizeViolations({ violations: [null, { impact: "serious" }] }, "intro")).toEqual([]);
  });

  it("lets a VPAT-listed rule through without blocking", () => {
    const findings = applyExceptions(normalizeViolations(axe, "intro"), [" Color-Contrast "]);
    expect(findings[0]).toMatchObject({ severity: "must", blocking: false, waived: "vpat" });
    expect(accessibilityStatus(findings)).toBe("passed_with_warnings");
  });

  it("reports a captions rule as a warning", () => {
    const findings = captionsAsWarnings(
      normalizeViolations(
        {
          violations: [{ id: "video-caption", impact: "critical", nodes: [{ target: ["video"] }] }],
        },
        "intro",
      ),
    );
    expect(findings).toEqual([
      expect.objectContaining({ severity: "must", blocking: false, waived: "captions" }),
    ]);
    expect(accessibilityStatus(findings)).toBe("passed_with_warnings");
    expect(accessibilityStatus([])).toBe("passed");
  });

  it("judges the keyboard probe by the three rules", () => {
    const findings = keyboardFindings(
      [
        control({ id: "", tag: "div", role: "", focusable: false, keyActivable: false }),
        control({ id: "next", tag: "button", focusVisible: false }),
        control({ id: "", tag: "div", role: "img", keyActivable: false }),
        control({ id: "ok", tag: "button" }),
      ],
      "intro",
    );
    expect(findings.map((finding) => [finding.code, finding.severity, finding.target])).toEqual([
      ["keyboard-focusable", "must", "div"],
      ["keyboard-focus-visible", "should", "#next"],
      ["keyboard-activation", "should", "div[role=img]"],
    ]);
  });

  it("keeps one finding per rule and scene, at its highest severity", () => {
    const merged = dedupe([
      ...normalizeViolations(
        { violations: [{ id: "label", impact: "minor", nodes: [{ target: ["#a"] }] }] },
        "intro",
      ),
      ...normalizeViolations(
        { violations: [{ id: "label", impact: "critical", nodes: [{}, {}] }] },
        "intro",
      ),
      ...normalizeViolations(
        { violations: [{ id: "label", impact: "minor", nodes: [{}] }] },
        "end",
      ),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ scene: "intro", severity: "must", blocking: true, count: 3 });
    expect(merged[0]!.target).toBe("#a");
    expect(merged[1]).toMatchObject({ scene: "end", severity: "minor" });
  });

  it("builds a report with unique ids, blocking findings first", () => {
    const report = accessibilityReport({
      findings: [
        ...normalizeViolations(axe, "intro"),
        ...keyboardFindings([control({ focusable: false })], "end"),
      ],
      scenes: ["intro", "end"],
      exceptions: [],
      checkedAt: "2026-09-25T10:00:00.000Z",
    });
    expect(report.status).toBe("failed");
    expect(report.findings.map((finding) => finding.id)).toEqual([
      "keyboard-focusable@end",
      "color-contrast@intro",
      "region@intro",
    ]);
    expect(report.scenes).toEqual(["intro", "end"]);
  });

  it("reads the probe's answer defensively", () => {
    expect(readProbe(undefined)).toEqual({ controls: [], text: [] });
    expect(
      readProbe({
        controls: [{ id: 3, tag: "button", focusable: true }, null],
        text: [" Hi ", 4, ""],
      }),
    ).toEqual({
      controls: [
        {
          id: "",
          tag: "button",
          role: "",
          focusable: true,
          focusVisible: false,
          keyActivable: false,
        },
      ],
      text: ["Hi"],
    });
  });

  it("ships page scripts that parse", () => {
    expect(() => new Function(`return ${PAGE_PROBE};`)).not.toThrow();
    expect(() => new Function(`return ${axeRunScript(["wcag2a"])};`)).not.toThrow();
    expect(axeRunScript(["wcag2a", "wcag22aa"])).toContain('["wcag2a","wcag22aa"]');
  });
});

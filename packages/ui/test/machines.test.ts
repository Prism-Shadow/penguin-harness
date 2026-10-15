/**
 * The Machines page's shared presentation (src/components/machines/): the status pill, a job's
 * stepper and the list. The card, the toolbar and the add dialog's shell are exercised through
 * the web app's machines suites, which hand them real machine records.
 *
 * - Every state is said in words: the pill shows its word beside a glyph — or a spinner while the
 *   machine is moving — and never stands as a bare coloured dot.
 * - A reason behind the word is the pill's marked hint (it shows over the word) and is read out
 *   with the word; a pill with nothing more to say carries no hint.
 * - A job's stepper draws one segment per step, the one under way as the live signal, and says
 *   what the job is doing in its caption.
 * - While the list loads, placeholders stand in the cards' band and the list says it is busy;
 *   once read, the cards come first and the empty state follows them.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  MACHINE_STATES,
  MachineStatusPill,
} from "../src/components/machines/machine-status/machine-status";
import { MachineStepper } from "../src/components/machines/machine-stepper/machine-stepper";
import { MachineList } from "../src/components/machines/machine-list/machine-list";
import { renderStatic } from "../src/testing";

/** The words a piece of markup shows, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

describe("the machine status pill", () => {
  it.each(MACHINE_STATES)("%s: says its state in a word beside a glyph or a spinner", (state) => {
    const html = renderStatic(createElement(MachineStatusPill, { state, label: "Word" }));
    expect(textOf(html)).toBe("Word");
    expect(html).toMatch(/<svg/);
    expect(html).toContain(`data-machine-state="${state}"`);
    // Moving states spin; the spinner names what runs for assistive technology.
    const spins = html.includes('data-live="spinner"');
    expect(spins).toBe(state === "working" || state === "reconnecting");
  });

  it("carries the reason as a marked hint and reads it out with the word", () => {
    const reason = "ssh: connect to host 10.0.0.12 port 22: Connection timed out";
    const html = renderStatic(
      createElement(MachineStatusPill, { state: "unreachable", label: "Unreachable", reason }),
    );
    expect(html).toContain(`data-tooltip="${reason}"`);
    expect(html).toContain('data-tooltip-extra="true"');
    expect(textOf(html)).toBe(`Unreachable · ${reason}`);

    const plain = renderStatic(
      createElement(MachineStatusPill, { state: "ready", label: "Running", reason: null }),
    );
    expect(plain).not.toContain("data-tooltip");
    expect(textOf(plain)).toBe("Running");
  });
});

describe("a job's stepper", () => {
  it("draws a segment per step, pulses only the one under way, and says what the job is doing", () => {
    const html = renderStatic(
      createElement(MachineStepper, {
        steps: ["done", "done", "current", "pending"],
        caption: "Installing the program",
        running: true,
      }),
    );
    const segments = [...html.matchAll(/data-step-state="(\w+)"/g)].map((m) => m[1]);
    expect(segments).toEqual(["done", "done", "current", "pending"]);
    expect(html.match(/data-live="dot"/g)).toHaveLength(1);
    expect(textOf(html)).toBe("Installing the program");

    const failed = renderStatic(
      createElement(MachineStepper, {
        steps: ["done", "failed", "pending"],
        caption: "Failed at Restart",
        running: false,
      }),
    );
    expect(failed).not.toContain("data-live");
  });
});

describe("the machines list", () => {
  it("stands placeholders in for the cards while it loads, then lists the cards before the empty state", () => {
    const loading = renderStatic(createElement(MachineList, { loading: true }));
    expect(loading).toContain('aria-busy="true"');
    expect(textOf(loading)).toBe("");

    const read = renderStatic(
      createElement(
        MachineList,
        { empty: createElement("p", null, "No machines in use") },
        createElement("article", null, "this server"),
      ),
    );
    expect(read).not.toContain("aria-busy");
    expect(textOf(read).indexOf("this server")).toBeLessThan(
      textOf(read).indexOf("No machines in use"),
    );
  });
});

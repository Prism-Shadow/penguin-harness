// @vitest-environment jsdom
/**
 * The plugin market's notice for sources that answered with nothing
 * (features/plugins/source-failures-notice.tsx).
 *
 * - It says how many sources could not be read; their reasons are folded away behind
 *   [Details], in the DOM but hidden, the press naming the list it opens.
 * - Opened, it lists each source by its address with the server's own reason, and the press
 *   keeps its word.
 * - Each reason offers [Report issue]: the report carries the source and the reason.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { closeReport, reportStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { SourceFailuresNotice } from "../src/features/plugins/source-failures-notice";
import { button, click, mount, unmountAll } from "./helpers/dom";

const SOURCE = "https://index.example/index.json";
const MIRROR = "https://mirror.example/index.json";
const MALFORMED = `plugin index from ${SOURCE} has a malformed entry at index 3 (@example/demo@1.0.0): channels[1] (github) has no url`;
const REFUSED = `plugin index from ${MIRROR} could not be fetched (3 attempts): fetch failed (connect ECONNREFUSED 192.0.2.7:443)`;
const FAILURES = [
  { source: SOURCE, error: MALFORMED },
  { source: MIRROR, error: REFUSED },
];

const list = () => document.querySelector(`[aria-label="${en.pluginRegistry.sourceFailures}"]`)!;

describe("the market's failed-source notice", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    closeReport();
    await unmountAll();
  });

  it("says how many sources could not be read, their reasons folded behind Details", async () => {
    await mount(h(SourceFailuresNotice, { failures: FAILURES }));
    expect(document.body.textContent).toContain(en.pluginRegistry.sourceUnavailable(2));
    const details = button(en.pluginRegistry.sourceDetails);
    expect(details.getAttribute("aria-expanded")).toBe("false");
    expect(details.getAttribute("aria-controls")).toBe(list().id);
    expect((list() as HTMLElement).hidden).toBe(true);
  });

  it("opened, lists each source with the server's own reason, the press keeping its word", async () => {
    await mount(h(SourceFailuresNotice, { failures: FAILURES }));
    await click(button(en.pluginRegistry.sourceDetails));
    expect((list() as HTMLElement).hidden).toBe(false);
    const items = [...list().querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain(SOURCE);
    expect(items[0]).toContain(MALFORMED);
    expect(items[1]).toContain(MIRROR);
    expect(items[1]).toContain(REFUSED);
    expect(button(en.pluginRegistry.sourceDetails).getAttribute("aria-expanded")).toBe("true");
  });

  it("offers a report for each reason, carrying its source and its words", async () => {
    await mount(h(SourceFailuresNotice, { failures: FAILURES }));
    await click(button(en.pluginRegistry.sourceDetails));
    const second = list().querySelectorAll("li")[1]!;
    await click(second.querySelector("[data-report-issue]")!);
    const report = reportStore.getState().open;
    expect(report?.facts).toContainEqual(["Source", MIRROR]);
    expect(report?.output?.text).toBe(REFUSED);
  });
});

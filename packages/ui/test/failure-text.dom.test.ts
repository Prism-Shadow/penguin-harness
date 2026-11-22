// @vitest-environment jsdom
/**
 * FailureText (src/components/report/failure-text.tsx) on a real page (test/helpers/dom.ts): a
 * failure's words as an inline surface says them, inside whatever line already holds the error.
 *
 * - Given a failure, its words come first and 「[报告问题]」 after them; pressing it opens the
 *   failure's report (the one the report host shows).
 * - Given a refusal, its words stand alone: no press at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { FailureText } from "../src/components/report/failure-text";
import { reportFor } from "../src/components/report/failure";
import { closeReport, reportStore } from "../src/components/report/report-store";
import { fire, mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
  closeReport();
});

const answer = (status: number, code: string) =>
  Object.assign(new Error("message"), { name: "ApiError", status, code });

const line = (text: string, error: unknown) =>
  h(
    "p",
    { "data-line": "" },
    h(FailureText, { failure: { text, report: reportFor(error, { what: "an action failed" }) } }),
  );

describe("FailureText", () => {
  it("shows Report after a failure's words, and pressing it opens the failure's report", async () => {
    const { container } = await mount(
      line("The machine did not answer", answer(502, "machine_unanswered")),
    );
    const shown = container.querySelector("[data-line]");
    expect(shown?.textContent?.startsWith("The machine did not answer")).toBe(true);
    const press = shown?.querySelector("[data-report-issue]");
    expect(press).not.toBeNull();
    await fire(press!, new MouseEvent("click", { bubbles: true }));
    const opened = reportStore.getState().open;
    expect(opened?.facts).toContainEqual(["Error code", "machine_unanswered"]);
    expect(opened?.facts).toContainEqual(["What happened", "an action failed"]);
  });

  it("shows a refusal's words alone", async () => {
    const { container } = await mount(
      line("That name is already taken", answer(409, "agent_exists")),
    );
    expect(container.querySelector("[data-line]")?.textContent).toBe("That name is already taken");
    expect(container.querySelector("button")).toBeNull();
  });
});

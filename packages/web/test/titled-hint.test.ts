/**
 * The hint on a company title that its row cuts off (features/company/shared.tsx `titledHint`):
 * the line whole, never the verb of the click.
 *
 * - Given a real title, the hint is the title with the id after it.
 * - Given a stand-in title that is the id itself, the hint is the id alone, not the id twice.
 * - Given a blank or missing title, the hint is the id alone, never a separator with nothing
 *   before it.
 */
import { describe, expect, it } from "vitest";
import { titledHint } from "../src/features/company/shared";

describe("titledHint", () => {
  it("a real title hints the title with the id after it", () => {
    expect(titledHint("Ship the marketplace", "t-7")).toBe("Ship the marketplace · t-7");
  });

  it("a stand-in title that is the id itself hints the id alone, not twice", () => {
    expect(titledHint("t-7", "t-7")).toBe("t-7");
  });

  it("a blank or missing title hints the id alone, never an empty title before it", () => {
    for (const title of ["", "   ", undefined]) {
      expect(titledHint(title, "t-7")).toBe("t-7");
    }
  });
});

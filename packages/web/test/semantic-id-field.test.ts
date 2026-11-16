/**
 * The shared semantic id field (features/semantic-id/semantic-id-field.tsx): the one piece of its
 * logic that is not the notice — what goes in a box that draws part of the id in front of itself.
 *
 * - Given the server's proposal and no drawn prefix, the box holds the proposal whole.
 * - Given a prefix the box draws (a non-admin's Project id), the box holds the rest.
 * - Given a proposal that does not start with that prefix, the box holds it whole, for
 *   validation to name.
 */
import { describe, expect, it } from "vitest";
import { proposalValue } from "../src/features/semantic-id/id-suggest-notice";

describe("proposalValue", () => {
  it("fills the box with the proposal as the server answered it", () => {
    expect(proposalValue("report_writer", undefined)).toBe("report_writer");
  });

  it("leaves out the part a non-admin's Project id box draws in front of itself", () => {
    expect(proposalValue("alice-research_lab", "alice-")).toBe("research_lab");
  });

  it("keeps an id that does not start with that part whole, for validation to name", () => {
    expect(proposalValue("research_lab", "alice-")).toBe("research_lab");
  });
});

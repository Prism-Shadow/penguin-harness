/**
 * The key-authorization dialog reports its own outcome, and never through a toast.
 *
 * The authorization happens in ANOTHER TAB. A toast fired when the poll sees the key is
 * announced to a window nobody is looking at, and it has faded by the time the user switches
 * back — leaving the one step they left the app for as the one step with no visible result.
 * So the dialog stays open, enters its `done` phase, names the provider and the count, and is
 * dismissed deliberately.
 *
 * Checked rather than remembered, because the regression is a one-line `toastSuccess` added
 * back into a success path by someone who never saw the dialog in another tab. This reads the
 * real source rather than rendering: the dialog is module-private, and exporting it purely so a
 * test could mount it would widen the module's surface to check a rule about its own text.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../src/features/models/models-page.tsx", import.meta.url)),
  "utf8",
);

/** The body of `KeyAuthorizeDialog`, from its phase type to the end of the file. */
function dialogSource(): string {
  const start = SOURCE.indexOf("type OAuthPhase");
  expect(start).toBeGreaterThan(0);
  return SOURCE.slice(start);
}

describe("the key-authorization dialog's outcome", () => {
  it("has a done phase, and both success paths settle into it", () => {
    const body = dialogSource();
    expect(body).toContain('| "done"');
    // The redirect path (the poll seeing status "done") and the manual path (a submitted code
    // answering ok) are the only two ways a key lands; both must report, not just the one the
    // author happened to be testing with.
    expect(body.match(/setPhase\("done"\)/g) ?? []).toHaveLength(2);
  });

  it("never toasts the outcome from the dialog or its caller", () => {
    // The caller used to close the dialog and toast. Either half coming back reintroduces the
    // bug: a toast is missed, and closing removes the surface that would have said anything.
    expect(SOURCE).not.toContain("S.models.oauthApplied(");
    expect(dialogSource()).not.toContain("toastSuccess");
  });

  it("names the provider and the count, in both dictionaries", () => {
    // The reader arrives from another tab and may not remember which authorization they just
    // finished, so the count alone is not enough.
    for (const dict of [zh, en]) {
      const body = dict.models.oauthAppliedBody("TokenDance", 7);
      expect(body).toContain("TokenDance");
      expect(body).toContain("7");
    }
  });

  it("offers one dismissal once the key is written, not a cancel beside it", () => {
    // Done is an outcome, not a choice: a "cancel" next to it would offer to undo a key that
    // the server has already stored.
    const body = dialogSource();
    // Exactly the ternary's THEN branch: slicing further would run into the else branch, which
    // is the flow's ordinary footer and legitimately carries the cancel.
    const start = body.indexOf('phase === "done" ? (');
    expect(start).toBeGreaterThan(0);
    const doneBranch = body.slice(start, body.indexOf(") : (", start));
    expect(doneBranch).toContain("S.common.close");
    expect(doneBranch).not.toContain("S.common.cancel");
  });
});

/**
 * The key-authorization dialog falls back to the pasted code instead of stranding the person.
 *
 * Two ways a redirect cannot finish: the server says up front that it cannot name a callback
 * the browser reaches (a machine behind an older hub), and opens the flow in manual mode; or
 * the person comes back from the provider's page and nothing has arrived. The first switches
 * the dialog to the code field with a sentence saying why; the second offers the switch.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OAUTH_STALL_MS,
  fellBackToManual,
  shownMode,
  stalledAfterReturn,
} from "../src/features/models/model-oauth-mode";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const flow = { flowId: "f1", authorizeUrl: "https://auth.example.test/authorize" };

describe("the mode the dialog shows", () => {
  it("follows the server's word on the flow it opened", () => {
    expect(shownMode("callback", { ...flow, mode: "manual" })).toBe("manual");
    expect(shownMode("manual", { ...flow, mode: "manual" })).toBe("manual");
    expect(shownMode("callback", { ...flow, mode: "callback" })).toBe("callback");
  });

  it("is what was asked for before a flow is open, and with a server that does not say", () => {
    expect(shownMode("callback", null)).toBe("callback");
    expect(shownMode("manual", null)).toBe("manual");
    expect(shownMode("callback", flow)).toBe("callback");
  });

  it("counts as a fallback only when the redirect was asked for and refused", () => {
    expect(fellBackToManual("callback", { ...flow, mode: "manual" })).toBe(true);
    // The person chose the code route: nothing fell back.
    expect(fellBackToManual("manual", { ...flow, mode: "manual" })).toBe(false);
    expect(fellBackToManual("callback", { ...flow, mode: "callback" })).toBe(false);
    expect(fellBackToManual("callback", flow)).toBe(false);
    expect(fellBackToManual("callback", null)).toBe(false);
  });
});

describe("a redirect that never arrives", () => {
  const at = 1_000_000;

  it("is offered the code once the person has been back for the grace period", () => {
    const base = { waiting: true, mode: "callback" as const, returnedAt: at };
    expect(stalledAfterReturn({ ...base, now: at + OAUTH_STALL_MS - 1 })).toBe(false);
    expect(stalledAfterReturn({ ...base, now: at + OAUTH_STALL_MS })).toBe(true);
  });

  it("is not stalled before the person came back, after the flow settled, or in manual mode", () => {
    const now = at + OAUTH_STALL_MS * 2;
    expect(stalledAfterReturn({ waiting: true, mode: "callback", returnedAt: null, now })).toBe(
      false,
    );
    expect(stalledAfterReturn({ waiting: false, mode: "callback", returnedAt: at, now })).toBe(
      false,
    );
    expect(stalledAfterReturn({ waiting: true, mode: "manual", returnedAt: at, now })).toBe(false);
  });
});

describe("the dialog's wiring", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/features/models/model-oauth-dialog.tsx", import.meta.url)),
    "utf8",
  );

  it("shows the code field by the opened flow's mode, not by the request alone", () => {
    expect(source).toContain("const mode = shownMode(asked, flow);");
    expect(source).toContain('const manual = mode === "manual";');
  });

  it("says why when it fell back, and offers no way back to a redirect that cannot arrive", () => {
    expect(source).toContain("S.models.oauthCallbackUnreachable");
    expect(source).toContain('phase !== "done" && !fellBack');
  });

  it("offers the code route when the person returns and nothing arrived", () => {
    expect(source).toContain('window.addEventListener("focus"');
    expect(source).toContain('setAsked("manual")');
    expect(source).toContain("S.models.oauthStalledAction");
  });

  it("has the new sentences in both dictionaries", () => {
    for (const dict of [zh, en]) {
      expect(dict.models.oauthCallbackUnreachable.length).toBeGreaterThan(0);
      expect(dict.models.oauthStalled.length).toBeGreaterThan(0);
      expect(dict.models.oauthStalledAction.length).toBeGreaterThan(0);
    }
  });
});

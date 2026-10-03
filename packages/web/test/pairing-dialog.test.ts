/**
 * Connecting the user's Chrome (features/builtin-browser/pairing-dialog.tsx and
 * pairing-code.ts): the steps rendered to static markup (node env, no DOM), the window's one
 * pairing code against the fetch fake, and when the dialog counts the Chrome as connected.
 *
 * - The steps give the release zip to install, this page's own address and the code, each with
 *   Copy, and the code's expiry as a local time with New code beside it.
 * - A code that has lapsed is not shown; New code is offered instead. A code the server refused
 *   to make says why.
 * - The window asks the server for one code: a second surface showing it asks for none while the
 *   code is fresh; New code replaces it; a code about to lapse is replaced when shown again.
 * - The dialog waits for the next Chrome to connect after it opened: a connection it opened after,
 *   or a later disconnection, is not one. Its foot says it is waiting, then that it connected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXTENSION_DOWNLOAD_URL,
  PairingStatus,
  PairingSteps,
  connectedSince,
} from "../src/features/builtin-browser/pairing-dialog";
import {
  ensurePairingCode,
  forgetPairingCode,
  pairingCode,
} from "../src/features/builtin-browser/pairing-code";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const ORIGIN = "https://ph.example.com";
const CODE = "Ab3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1eF3hJ5kL7nP9r";

/** The text of the element carrying `testId` in rendered markup, or null without one. */
const textOf = (html: string, testId: string): string | null =>
  new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? null;

const steps = () => renderToStaticMarkup(createElement(PairingSteps, { origin: ORIGIN }));

/** A server that mints `CODE`, expiring `inMs` from now. */
function minting(inMs = 10 * 60_000) {
  return stubFetch(() =>
    json({ code: CODE, expiresAt: new Date(Date.now() + inMs).toISOString(), origin: ORIGIN }),
  );
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: ORIGIN } });
  forgetPairingCode();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the pairing steps", () => {
  it("give the zip to install, this page's address and the code, each to copy, and when it expires", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 3, 14, 0) });
    minting();
    await ensurePairingCode();
    const html = steps();
    expect(html).toContain(`href="${EXTENSION_DOWNLOAD_URL}"`);
    expect(textOf(html, "browser-pairing-server")).toBe(ORIGIN);
    expect(textOf(html, "browser-pairing-code")).toBe(CODE);
    expect(html).toContain(`aria-label="${S.common.copy}: ${S.builtinBrowser.pairServer}"`);
    expect(html).toContain(`aria-label="${S.common.copy}: ${S.builtinBrowser.pairCode}"`);
    expect(html).toContain(S.builtinBrowser.pairCodeExpiry("14:10"));
    expect(html).toContain(`>${S.builtinBrowser.pairNewCode}<`);
  });

  it("hide a code that has lapsed and offer a new one", async () => {
    minting(-1);
    await ensurePairingCode(true);
    const html = steps();
    expect(html).not.toContain(CODE);
    expect(html).toContain(S.builtinBrowser.pairCodeExpired);
    expect(html).toContain(`>${S.builtinBrowser.pairNewCode}<`);
  });

  it("say why there is no code when the server refused to make one", async () => {
    stubFetch(() => apiError(503, "browser_unavailable"));
    await ensurePairingCode();
    expect(pairingCode().status).toBe("failed");
    expect(steps()).toContain(S.builtinBrowser.pairCodeFailed(S.errors.byCode.browser_unavailable));
  });
});

describe("the window's one pairing code", () => {
  it("is asked for once while it is fresh, and replaced on request", async () => {
    const fetch = minting();
    await ensurePairingCode();
    await ensurePairingCode();
    expect(fetch.requests).toHaveLength(1);
    expect(fetch.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/builtin-browser/extension/pairings",
    });
    await ensurePairingCode(true);
    expect(fetch.requests).toHaveLength(2);
  });

  it("is replaced when it is shown again with under a minute left", async () => {
    const fetch = minting(30_000);
    await ensurePairingCode();
    await ensurePairingCode();
    expect(fetch.requests).toHaveLength(2);
  });
});

describe("waiting for the Chrome", () => {
  it("counts only a connection heard after the dialog opened, and only while it is the latest word", () => {
    expect(connectedSince(2, { seq: 3, last: "connected" })).toBe(true);
    expect(connectedSince(3, { seq: 3, last: "connected" })).toBe(false);
    expect(connectedSince(2, { seq: 4, last: "disconnected" })).toBe(false);
  });

  it("says it is waiting, then that the Chrome connected", () => {
    expect(renderToStaticMarkup(createElement(PairingStatus, { connected: false }))).toContain(
      S.builtinBrowser.pairWaiting,
    );
    const done = renderToStaticMarkup(createElement(PairingStatus, { connected: true }));
    expect(done).toContain(S.builtinBrowser.pairConnected);
    expect(done).not.toContain(S.builtinBrowser.pairWaiting);
  });
});

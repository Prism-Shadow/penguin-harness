// @vitest-environment jsdom
/**
 * The key-authorization dialog falls back to the pasted code instead of stranding the person.
 *
 * Two ways a redirect cannot finish: the server says up front that it cannot name a callback
 * the browser reaches (a machine behind an older hub), and opens the flow in manual mode; or
 * the person comes back from the provider's page and nothing has arrived. The first switches
 * the dialog to the code field with a sentence saying why; the second offers the switch.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type {
  ModelInfo,
  ModelOAuthStartRequest,
  ModelOAuthStartResponse,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OAUTH_STALL_MS,
  fellBackToManual,
  shownMode,
  stalledAfterReturn,
} from "../src/features/models/model-oauth-mode";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ModelsPage } from "../src/features/models/models-page";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ProjectProvider } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import { ADMIN_ME } from "./helpers/admin-settings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, field, hasButton, mount, unmountAll, waitFor } from "./helpers/dom";
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

/**
 * The key-authorization dialog follows the mode of the flow the server opened, on the real
 * models page against a fake of its API.
 *
 * - Given the server answers a redirect request with a manual flow (the provider does not
 *   redirect to the address the page is served from), when the dialog opens, then it shows the
 *   code step at once, having opened one flow, and offers no switch back to the redirect.
 * - Given the server honours the redirect, when the dialog opens, then it offers the switch to
 *   the code, and taking it opens a manual flow with the switch back still offered.
 */

const PROJECT: ProjectSummary = {
  projectId: "p1",
  name: "P1",
  role: "owner",
  ownerUserId: "admin",
  createdAt: "2026-01-01T00:00:00Z",
};

/** A TokenDance model and no group key: the page offers to connect the group. */
const TOKENDANCE_ROW: ModelInfo = {
  provider: "tokendance",
  modelId: "td-model",
  displayName: "TD Model",
  contextWindow: 128000,
  isDefault: false,
  effective: { baseUrlSource: "provider", clientTypeSource: "provider", apiKeySource: "none" },
};

/** The models API plus the start route, which answers with the mode `opened` picks. */
function modelsServer(opened: (asked: ModelOAuthStartRequest["mode"]) => "callback" | "manual") {
  const starts: ModelOAuthStartRequest[] = [];
  stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/model-totals") return json({ totals: [] });
    if (req.path === "/api/projects/p1/models" && req.method === "GET") {
      return json({ providers: {}, models: [TOKENDANCE_ROW] });
    }
    if (req.path === "/api/projects/p1/model-oauth/start") {
      const body = req.body as ModelOAuthStartRequest;
      starts.push(body);
      return json({
        flowId: `flow-${starts.length}`,
        authorizeUrl: "https://provider.example/auth",
        mode: opened(body.mode),
      } satisfies ModelOAuthStartResponse);
    }
    return apiError(404, "not_found");
  });
  return { starts };
}

async function openConnectDialog(opened: Parameters<typeof modelsServer>[0]) {
  const server = modelsServer(opened);
  await mount(
    h(
      MemoryRouter,
      null,
      h(
        LocaleProvider,
        null,
        h(ThemeProvider, null, h(AuthProvider, null, h(ProjectProvider, null, h(ModelsPage)))),
      ),
    ),
  );
  await waitFor(() => hasButton(en.models.oauthKey));
  await click(button(en.models.oauthKey));
  await waitFor(() => server.starts.length > 0);
  return server;
}

describe("the key-authorization dialog's route back", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    localStorage.setItem("penguin.lang", "en");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("opens on the code step when the server could not offer the redirect, with no switch back", async () => {
    const server = await openConnectDialog(() => "manual");
    await waitFor(() => hasButton(en.models.oauthSubmitCode));

    expect(server.starts).toEqual([{ provider: "tokendance", mode: "callback" }]);
    expect(field(en.models.oauthCodeLabel)).toBeDefined();
    expect(hasButton(en.models.oauthCallbackSwitch)).toBe(false);
    expect(hasButton(en.models.oauthManualSwitch)).toBe(false);
  });

  it("keeps the switch to the code when the redirect is honoured, and the switch back after it", async () => {
    const server = await openConnectDialog((asked) => asked ?? "callback");
    await waitFor(() => !button(en.models.oauthAuthorize).disabled);
    expect(() => field(en.models.oauthCodeLabel)).toThrow();

    await click(button(en.models.oauthManualSwitch));
    await waitFor(() => server.starts.length === 2);
    expect(server.starts[1]).toEqual({ provider: "tokendance", mode: "manual" });
    expect(field(en.models.oauthCodeLabel)).toBeDefined();
    expect(hasButton(en.models.oauthCallbackSwitch)).toBe(true);
  });
});

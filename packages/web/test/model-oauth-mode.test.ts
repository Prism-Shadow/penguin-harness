// @vitest-environment jsdom
/**
 * The key-authorization dialog, on the real models page against a fake of its API: it follows
 * the mode of the flow the server opened, and reports its own outcome.
 *
 * - Given the server answers a redirect request with a manual flow (the provider does not
 *   redirect to the address the page is served from), when the dialog opens, then it shows the
 *   code step at once, having opened one flow, and offers no switch back to the redirect.
 * - Given the server honours the redirect, when the dialog opens, then it offers the switch to
 *   the code, and taking it opens a manual flow with the switch back still offered.
 * - Given a code the server redeems, or a redirect the poll sees done, the dialog stays open on
 *   its own report naming the provider and the server's count, with one Close and no Cancel,
 *   and no toast: the authorization ran in another tab, where a toast would go unseen.
 * - Given the report on screen, the model table is not read again until Close, which reads it
 *   once and opens no second authorization.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type {
  ModelInfo,
  ModelOAuthCodeResponse,
  ModelOAuthStartRequest,
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import { providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ModelsPage } from "../src/features/models/models-page";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ProjectProvider } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import { ADMIN_ME } from "./helpers/admin-settings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  settle,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

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

/** Models the server writes the minted key to: a count of its own, not the table's. */
const APPLIED = 3;

/**
 * The models API plus the flow's routes: the start answers with the mode `opened` picks, a
 * submitted code is redeemed, and the status reads done once `redirected` is set.
 */
function modelsServer(opened: (asked: ModelOAuthStartRequest["mode"]) => "callback" | "manual") {
  const starts: ModelOAuthStartRequest[] = [];
  const state = { tableReads: 0, redirected: false };
  stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/model-totals") return json({ totals: [] });
    if (req.path === "/api/projects/p1/models" && req.method === "GET") {
      state.tableReads += 1;
      return json({ providers: {}, models: [TOKENDANCE_ROW] });
    }
    if (req.path.endsWith("/code") && req.method === "POST") {
      return json({ ok: true, applied: APPLIED } satisfies ModelOAuthCodeResponse);
    }
    if (req.path.startsWith("/api/projects/p1/model-oauth/flow-") && req.method === "GET") {
      return json({
        status: state.redirected ? "done" : "pending",
        provider: "tokendance",
        ...(state.redirected ? { applied: APPLIED } : {}),
      } satisfies ModelOAuthStatusResponse);
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
  return { starts, state };
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

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
beforeEach(() => {
  localStorage.setItem("penguin.lang", "en");
  toastStore.setState({ items: [] });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
  localStorage.clear();
});

describe("the key-authorization dialog's route back", () => {
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

describe("the key-authorization dialog's outcome", () => {
  /** The words of the buttons in the dialog on top. */
  const dialogButtons = () =>
    [...dialogs().at(-1)!.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
  const report = () => en.models.oauthAppliedBody(providerInfo("tokendance")!.label, APPLIED);

  /** The report stays up on its own: one Close, no Cancel, and nothing toasted. */
  const expectReport = () => {
    expect(document.body.textContent).toContain(report());
    expect(dialogButtons()).toContain(en.common.close);
    expect(dialogButtons()).not.toContain(en.common.cancel);
    expect(toastStore.getState().items).toEqual([]);
  };

  it("reports a redeemed code in the dialog, naming the provider and the server's count", async () => {
    await openConnectDialog(() => "manual");
    await waitFor(() => hasButton(en.models.oauthSubmitCode));
    await type(field(en.models.oauthCodeLabel), "one-time-code");
    await click(button(en.models.oauthSubmitCode));
    await waitFor(() => document.body.textContent?.includes(report()) === true);
    expectReport();
  });

  it("reports a redirect the poll sees done the same way", async () => {
    const server = await openConnectDialog((asked) => asked ?? "callback");
    await waitFor(() => !button(en.models.oauthAuthorize).disabled);
    // The provider's page opens in another tab; the poll is the clock's to advance.
    const openTab = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await click(button(en.models.oauthAuthorize));
    server.state.redirected = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    vi.useRealTimers();
    await waitFor(() => document.body.textContent?.includes(report()) === true);
    expect(openTab).toHaveBeenCalledTimes(1);
    openTab.mockRestore();
    expectReport();
  });

  it("reads the table again only on Close, once, and opens no second authorization", async () => {
    const server = await openConnectDialog(() => "manual");
    await waitFor(() => hasButton(en.models.oauthSubmitCode));
    const reads = server.state.tableReads;
    await type(field(en.models.oauthCodeLabel), "one-time-code");
    await click(button(en.models.oauthSubmitCode));
    await waitFor(() => document.body.textContent?.includes(report()) === true);
    await settle();
    expect(server.state.tableReads).toBe(reads);

    const close = [...dialogs().at(-1)!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === en.common.close,
    )!;
    await click(close);
    await waitFor(() => server.state.tableReads === reads + 1);
    expect(document.body.textContent).not.toContain(report());
    expect(server.starts).toHaveLength(1);
  });
});

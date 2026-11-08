// @vitest-environment jsdom
/**
 * The notice after connecting TokenDance or Penguin Go moved the Project's default model, on the
 * real models page against a fake of its API. The server decides whether a connect moves the
 * default (server test connect-default-model.test.ts); the page says what it was told.
 *
 * - Given TokenDance is not connected, when the owner saves its key in the group settings and the
 *   server reports the default moved, then a notice names TokenDance's DeepSeek V4.1 Flash with
 *   Undo, and the list marks that model as the default.
 * - When the owner presses Undo, the previous default is written back, the list marks it again,
 *   and a notice says so.
 * - Given the Project had no default, the notice offers no Undo.
 * - Given the server reports no switch (the group was connected already, another group, the row
 *   is gone), no notice appears.
 * - Given TokenDance's connect flow writes the key and moves the default, the notice waits until
 *   the dialog's outcome is dismissed, and then offers Undo; Penguin Go's flow does the same.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type {
  DefaultModelSwitch,
  ModelInfo,
  ModelRefDto,
  ModelsResponse,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import { Toaster, toastStore } from "@prismshadow/penguin-ui";
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

const row = (provider: string, modelId: string, displayName: string): ModelInfo => ({
  provider,
  modelId,
  displayName,
  contextWindow: 1000000,
  isDefault: false,
  effective: { baseUrlSource: "provider", clientTypeSource: "provider", apiKeySource: "none" },
});

const DEEPSEEK: ModelRefDto = { provider: "deepseek", modelId: "deepseek-flash" };
const TOKENDANCE: ModelRefDto = { provider: "tokendance", modelId: "deepseek-v4.1-flash" };
const PENGUIN_GO: ModelRefDto = { provider: "penguin-go", modelId: "deepseek-flash" };
const ROWS = [
  row("deepseek", "deepseek-flash", "DeepSeek Flash"),
  row("tokendance", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
  row("penguin-go", "deepseek-flash", "Go Flash"),
];

const switched = (name: string) => en.models.connectDefaultSwitched(name);

/**
 * The models API with a group key write that moves the default as the server would, when told
 * to: `moves` answers whether it does for a group, and the switch names the default it replaced.
 */
function modelsServer(start: ModelRefDto | undefined, moves: (provider: string) => boolean) {
  let table: ModelsResponse = {
    providers: {},
    models: ROWS,
    ...(start !== undefined ? { defaultModel: start } : {}),
  };
  /** The group's key lands; the default moves where `moves` says, and the switch is answered. */
  const connect = (provider: string, target: ModelRefDto): DefaultModelSwitch | undefined => {
    const previous = table.defaultModel;
    table = {
      ...table,
      providers: { ...table.providers, [provider]: { apiKeyMasked: "sk-…0001" } },
    };
    if (!moves(provider)) return undefined;
    table = { ...table, defaultModel: target };
    return {
      defaultModel: target,
      ...(previous !== undefined ? { previousDefault: previous } : {}),
    };
  };
  const fake = stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/model-totals") return json({ totals: [] });
    if (req.path === "/api/projects/p1/models" && req.method === "GET") return json(table);
    if (req.path === "/api/projects/p1/models/providers/tokendance" && req.method === "PUT") {
      const defaultSwitch = connect("tokendance", TOKENDANCE);
      return json({ ...table, ...(defaultSwitch !== undefined ? { defaultSwitch } : {}) });
    }
    if (req.path === "/api/projects/p1/models/default" && req.method === "PUT") {
      table = { ...table, defaultModel: req.body as ModelRefDto };
      return json({ defaultModel: table.defaultModel });
    }
    if (req.path === "/api/projects/p1/model-oauth/start") {
      return json({ flowId: "td-flow", authorizeUrl: "https://td.example/auth", mode: "manual" });
    }
    if (req.path === "/api/projects/p1/model-oauth/td-flow/code") {
      const defaultSwitch = connect("tokendance", TOKENDANCE);
      return json({ ok: true, applied: 1, ...(defaultSwitch ? { defaultSwitch } : {}) });
    }
    if (req.path === "/api/projects/p1/platform-auth/start") {
      return json(
        { flowId: "go-flow", authorizeUrl: "https://go.example/auth", expiresAt: "2099-01-01" },
        201,
      );
    }
    if (req.path === "/api/projects/p1/platform-auth/go-flow/status") {
      const defaultSwitch = connect("penguin-go", PENGUIN_GO);
      return json({ status: "completed", applied: 1, ...(defaultSwitch ? { defaultSwitch } : {}) });
    }
    return apiError(404, "not_found");
  });
  /** The defaults the page wrote back through the narrow default route (Undo). */
  const restores = () =>
    fake.requests
      .filter((r) => r.path === "/api/projects/p1/models/default" && r.method === "PUT")
      .map((r) => r.body);
  return { restores };
}

async function openModelsPage(start: ModelRefDto | undefined, moves = (_p: string) => true) {
  const server = modelsServer(start, moves);
  await mount(
    h(
      MemoryRouter,
      null,
      h(
        LocaleProvider,
        null,
        h(
          ThemeProvider,
          null,
          h(AuthProvider, null, h(ProjectProvider, null, h(ModelsPage), h(Toaster))),
        ),
      ),
    ),
  );
  // Searching force-opens every matching group, so the cards are on screen.
  const search = `input[placeholder="${en.models.searchPlaceholder}"]`;
  await waitFor(() => document.querySelector(search) !== null);
  await type(document.querySelector(search)!, "flash");
  await waitFor(() => card("DeepSeek Flash") !== undefined);
  return server;
}

/** The card whose name reads `name`, or undefined when the list shows none. */
const card = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button span.font-medium")]
    .find((s) => s.textContent === name)
    ?.closest("button") ?? undefined;
/** The names of the cards marked as the default. */
const defaults = () =>
  ["DeepSeek Flash", "DeepSeek V4.1 Flash", "Go Flash"].filter((name) =>
    card(name)?.textContent?.includes(en.models.default),
  );
/** The texts of the toasts on screen. */
const notices = () => toastStore.getState().items.map((t) => t.text);
/** Whether the page says `text` anywhere, a dialog's body included. */
const shows = (text: string) => document.body.textContent?.includes(text) ?? false;
/** The words on the topmost dialog's buttons. */
const dialogButtons = () =>
  [...(dialogs().at(-1)?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.trim());
/** The connect dialog's own Close, in its footer: the banner's × above the groups shares the name. */
const closeDialog = () =>
  click(
    [...dialogs().at(-1)!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === en.common.close,
    )!,
  );

async function saveTokenDanceKey() {
  await click(button(`${en.models.groupSettings} TokenDance`));
  const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
    el.textContent?.includes(en.models.groupSettingsEntry),
  );
  await click(entry!);
  await type(field(en.models.apiKey), "sk-td-0001");
  await click(button(en.common.save));
}

describe("the notice after a connect moved the default model", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    toastStore.setState({ items: [] });
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
    vi.restoreAllMocks();
    toastStore.setState({ items: [] });
    localStorage.clear();
  });

  it("names the new default with Undo once a TokenDance key is saved, and the list marks it", async () => {
    await openModelsPage(DEEPSEEK);
    expect(defaults()).toEqual(["DeepSeek Flash"]);

    await saveTokenDanceKey();
    await waitFor(() => notices().length > 1);

    expect(notices()).toContain(switched("DeepSeek V4.1 Flash (TokenDance)"));
    expect(hasButton(en.common.undo)).toBe(true);
    expect(defaults()).toEqual(["DeepSeek V4.1 Flash"]);
  });

  it("Undo writes the previous default back, the list marks it again, and a notice says so", async () => {
    const server = await openModelsPage(DEEPSEEK);
    await saveTokenDanceKey();
    await waitFor(() => hasButton(en.common.undo));

    await click(button(en.common.undo));
    await waitFor(() => server.restores().length === 1);
    await waitFor(() => defaults()[0] === "DeepSeek Flash");

    expect(server.restores()).toEqual([DEEPSEEK]);
    expect(defaults()).toEqual(["DeepSeek Flash"]);
    expect(notices()).toContain(en.models.connectDefaultRestored("DeepSeek Flash (DeepSeek)"));
  });

  it("offers no Undo when the Project had no default", async () => {
    await openModelsPage(undefined);

    await saveTokenDanceKey();
    await waitFor(() => notices().length > 1);

    expect(notices()).toContain(switched("DeepSeek V4.1 Flash (TokenDance)"));
    expect(hasButton(en.common.undo)).toBe(false);
  });

  it("says nothing when the server reports no switch", async () => {
    await openModelsPage(DEEPSEEK, () => false);

    await saveTokenDanceKey();
    await waitFor(() => notices().length > 0);

    expect(notices()).toEqual([en.common.saved]);
    expect(defaults()).toEqual(["DeepSeek Flash"]);
  });

  it("waits for TokenDance's connect flow to be dismissed, then offers Undo", async () => {
    await openModelsPage(DEEPSEEK);
    await click(button(en.models.oauthKey));
    await waitFor(() => hasButton(en.models.oauthSubmitCode));
    await type(field(en.models.oauthCodeLabel), "pasted-code");
    await click(button(en.models.oauthSubmitCode));
    await waitFor(() => shows(en.models.oauthAppliedBody("TokenDance", 1)));

    expect(notices()).toEqual([]);

    await closeDialog();
    await waitFor(() => notices().length > 0);

    expect(notices()).toEqual([switched("DeepSeek V4.1 Flash (TokenDance)")]);
    expect(hasButton(en.common.undo)).toBe(true);
  });

  it("waits for Penguin Go's connect flow to be dismissed, then offers Undo", async () => {
    // The flow opens its tab from the click, before the server has the address.
    const tab = { opener: null, location: { replace: () => {} }, close: () => {} };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await openModelsPage(DEEPSEEK);
    await click(button(`${en.models.notConnectedStatus} · ${en.models.oauthKey} Penguin Go`));
    await click(button(en.models.oauthAuthorize));
    // Done is the one phase whose footer says Close rather than Cancel. (The dialog's sentences
    // are read once, when the page module loads, so they are not in the language set here.)
    await waitFor(() => dialogButtons().includes(en.common.close));

    expect(notices()).toEqual([]);

    await closeDialog();
    await waitFor(() => notices().length > 0);

    expect(notices()).toEqual([switched("Go Flash (Penguin Go)")]);
    expect(hasButton(en.common.undo)).toBe(true);
  });
});

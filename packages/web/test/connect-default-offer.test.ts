// @vitest-environment jsdom
/**
 * The question after connecting TokenDance or Penguin Go offered that group's DeepSeek V4.1 Flash
 * as the Project's default model, on the real models page against a fake of its API. The server
 * decides whether a connect offers it and never moves the default itself (server test
 * connect-default-offer.test.ts); the page asks what it was told.
 *
 * - Given the default is DeepSeek's, when the owner saves a TokenDance key in the group settings
 *   and the server offers TokenDance's DeepSeek V4.1 Flash, then a question names the current
 *   default and the offered model, and nothing is written yet: the list still marks DeepSeek's.
 * - When the owner switches, the offered model is written through the default route, the list
 *   marks it, and a notice says it saved.
 * - When the owner keeps the current default, nothing is written and the list is unchanged.
 * - Given the Project had no default, the question asks whether to set one, and setting it
 *   writes the offered model.
 * - Given the server offers nothing, no question appears.
 * - Given TokenDance's connect flow writes the key with an offer, the question waits until the
 *   dialog's outcome is dismissed; Penguin Go's flow does the same.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type {
  DefaultModelOffer,
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

/**
 * The models API, whose group key writes report an offer where `offers` says so, as the server
 * would: the offered model and the current default, which the write leaves where it is.
 */
function modelsServer(start: ModelRefDto | undefined, offers: (provider: string) => boolean) {
  let table: ModelsResponse = {
    providers: {},
    models: ROWS,
    ...(start !== undefined ? { defaultModel: start } : {}),
  };
  /** The group's key lands; the default stays, and the offer is answered where `offers` says. */
  const connect = (provider: string, model: ModelRefDto): DefaultModelOffer | undefined => {
    table = {
      ...table,
      providers: { ...table.providers, [provider]: { apiKeyMasked: "sk-…0001" } },
    };
    if (!offers(provider)) return undefined;
    const current = table.defaultModel;
    return { model, ...(current !== undefined ? { current } : {}) };
  };
  const fake = stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/model-totals") return json({ totals: [] });
    if (req.path === "/api/projects/p1/models" && req.method === "GET") return json(table);
    if (req.path === "/api/projects/p1/models/providers/tokendance" && req.method === "PUT") {
      const defaultOffer = connect("tokendance", TOKENDANCE);
      return json({ ...table, ...(defaultOffer !== undefined ? { defaultOffer } : {}) });
    }
    if (req.path === "/api/projects/p1/models/default" && req.method === "PUT") {
      table = { ...table, defaultModel: req.body as ModelRefDto };
      return json({ defaultModel: table.defaultModel });
    }
    if (req.path === "/api/projects/p1/model-oauth/start") {
      return json({ flowId: "td-flow", authorizeUrl: "https://td.example/auth", mode: "manual" });
    }
    if (req.path === "/api/projects/p1/model-oauth/td-flow/code") {
      const defaultOffer = connect("tokendance", TOKENDANCE);
      return json({ ok: true, applied: 1, ...(defaultOffer ? { defaultOffer } : {}) });
    }
    if (req.path === "/api/projects/p1/platform-auth/start") {
      return json(
        { flowId: "go-flow", authorizeUrl: "https://go.example/auth", expiresAt: "2099-01-01" },
        201,
      );
    }
    if (req.path === "/api/projects/p1/platform-auth/go-flow/status") {
      const defaultOffer = connect("penguin-go", PENGUIN_GO);
      return json({ status: "completed", applied: 1, ...(defaultOffer ? { defaultOffer } : {}) });
    }
    return apiError(404, "not_found");
  });
  /** The defaults the page wrote through the narrow default route. */
  const writes = () =>
    fake.requests
      .filter((r) => r.path === "/api/projects/p1/models/default" && r.method === "PUT")
      .map((r) => r.body);
  return { writes };
}

async function openModelsPage(start: ModelRefDto | undefined, offers = (_p: string) => true) {
  const server = modelsServer(start, offers);
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
/** The question asked when DeepSeek's default meets TokenDance's offer. */
const SWITCH_QUESTION = () =>
  en.models.connectDefaultOffer("TokenDance", "DeepSeek Flash (DeepSeek)", "DeepSeek V4.1 Flash");
/** Presses the topmost dialog's button that reads `text`. */
const pressInDialog = (text: string) =>
  click(
    [...dialogs().at(-1)!.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!,
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

describe("the question after a connect offered a default model", () => {
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

  it("asks once a TokenDance key is saved, naming both models, and writes nothing yet", async () => {
    const server = await openModelsPage(DEEPSEEK);

    await saveTokenDanceKey();
    await waitFor(() => shows(SWITCH_QUESTION()));

    expect(dialogButtons()).toEqual([en.models.connectDefaultKeep, en.models.connectDefaultSwitch]);
    expect(server.writes()).toEqual([]);
    expect(defaults()).toEqual(["DeepSeek Flash"]);
  });

  it("Switch writes the offered model as the default, the list marks it, and a notice says it saved", async () => {
    const server = await openModelsPage(DEEPSEEK);
    await saveTokenDanceKey();
    await waitFor(() => shows(SWITCH_QUESTION()));

    await pressInDialog(en.models.connectDefaultSwitch);
    await waitFor(() => defaults()[0] === "DeepSeek V4.1 Flash");

    expect(server.writes()).toEqual([TOKENDANCE]);
    expect(defaults()).toEqual(["DeepSeek V4.1 Flash"]);
    expect(notices()).toEqual([en.common.saved, en.common.saved]);
    expect(shows(SWITCH_QUESTION())).toBe(false);
  });

  it("Keep current writes nothing and leaves the default as it was", async () => {
    const server = await openModelsPage(DEEPSEEK);
    await saveTokenDanceKey();
    await waitFor(() => shows(SWITCH_QUESTION()));

    await pressInDialog(en.models.connectDefaultKeep);
    await waitFor(() => !shows(SWITCH_QUESTION()));

    expect(server.writes()).toEqual([]);
    expect(defaults()).toEqual(["DeepSeek Flash"]);
  });

  it("asks to set a default when the Project had none, and setting it writes the offered model", async () => {
    const server = await openModelsPage(undefined);
    await saveTokenDanceKey();
    const question = en.models.connectDefaultOfferUnset("TokenDance", "DeepSeek V4.1 Flash");
    await waitFor(() => shows(question));

    expect(dialogButtons()).toEqual([en.models.connectDefaultNotNow, en.models.connectDefaultSet]);

    await pressInDialog(en.models.connectDefaultSet);
    await waitFor(() => server.writes().length === 1);

    expect(server.writes()).toEqual([TOKENDANCE]);
  });

  it("asks nothing when the server offers nothing", async () => {
    await openModelsPage(DEEPSEEK, () => false);

    await saveTokenDanceKey();
    await waitFor(() => notices().length > 0);

    expect(notices()).toEqual([en.common.saved]);
    expect(hasButton(en.models.connectDefaultKeep)).toBe(false);
    expect(hasButton(en.models.connectDefaultNotNow)).toBe(false);
  });

  it("waits for TokenDance's connect flow to be dismissed, then asks", async () => {
    await openModelsPage(DEEPSEEK);
    await click(button(en.models.oauthKey));
    await waitFor(() => hasButton(en.models.oauthSubmitCode));
    await type(field(en.models.oauthCodeLabel), "pasted-code");
    await click(button(en.models.oauthSubmitCode));
    await waitFor(() => shows(en.models.oauthAppliedBody("TokenDance", 1)));

    expect(shows(SWITCH_QUESTION())).toBe(false);

    await closeDialog();
    await waitFor(() => shows(SWITCH_QUESTION()));
  });

  it("waits for Penguin Go's connect flow to be dismissed, then asks", async () => {
    // The flow opens its tab from the click, before the server has the address.
    const tab = { opener: null, location: { replace: () => {} }, close: () => {} };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await openModelsPage(DEEPSEEK);
    await click(button(`${en.models.notConnectedStatus} · ${en.models.oauthKey} Penguin Go`));
    await click(button(en.models.oauthAuthorize));
    // Done is the one phase whose footer says Close rather than Cancel. (The dialog's sentences
    // are read once, when the page module loads, so they are not in the language set here.)
    await waitFor(() => dialogButtons().includes(en.common.close));
    const question = en.models.connectDefaultOffer(
      "Penguin Go",
      "DeepSeek Flash (DeepSeek)",
      "Go Flash",
    );

    expect(shows(question)).toBe(false);

    await closeDialog();
    await waitFor(() => shows(question));
  });
});

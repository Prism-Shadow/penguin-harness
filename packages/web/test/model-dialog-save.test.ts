// @vitest-environment jsdom
/**
 * The models page's config dialog (features/models/models-page.tsx) under the settings commit
 * model, on the real page against a fake of the models API.
 *
 * - A save the server refuses leaves the dialog open with the draft, and the list as it was:
 *   no row shows a change that was never written. A save that lands closes the dialog and the
 *   list shows the change.
 * - The footer's verb is Save on a saved model and Add on a new one; it waits until something
 *   changed and nothing is wrong.
 * - A wrong field inside the folded Details opens the fold, so Save is never held by an error
 *   out of view.
 * - Closing with edits asks first: "keep editing" keeps the dialog and the draft, "discard"
 *   closes it; an untouched dialog closes at once.
 * - A save that would cancel the row's running promotion asks first; an edit that leaves the
 *   price alone saves at once.
 * - The add-group dialog says a taken group name as it is typed, holds Confirm while it is
 *   taken, and asks before Esc drops a typed name.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type {
  ModelInfo,
  ModelsResponse,
  ModelsUpdateRequest,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
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
  pressEscape,
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

const model = (m: Partial<ModelInfo> & Pick<ModelInfo, "provider" | "modelId">): ModelInfo => ({
  effective: { baseUrlSource: "model", clientTypeSource: "model", apiKeySource: "none" },
  isDefault: false,
  ...m,
});

/** A custom model with its own endpoint, a list price and a running half-price promotion. */
const ATLAS = model({
  provider: "custom",
  modelId: "atlas-1",
  displayName: "Atlas",
  contextWindow: 128000,
  clientType: "openai-chat",
  pricing: { cacheRead: 0.1, cacheWrite: 0.2, output: 1 },
  discount: 0.5,
  credential: { baseUrl: "https://atlas.example/v1" },
});

/**
 * The models API: GET answers the table, PUT stores what it is sent (the way the server reads
 * a full-table replace) unless told to refuse the next one.
 */
function modelsServer() {
  let table: ModelsResponse = { providers: {}, models: [ATLAS] };
  let refuse = false;
  const puts: ModelsUpdateRequest[] = [];
  stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/usage/model-totals") return json({ totals: [] });
    if (req.path === "/api/projects/p1/models" && req.method === "GET") return json(table);
    if (req.path === "/api/projects/p1/models" && req.method === "PUT") {
      const body = req.body as ModelsUpdateRequest;
      puts.push(body);
      if (refuse) {
        refuse = false;
        return apiError(400, "invalid_models", "refused by the test");
      }
      table = {
        providers: table.providers,
        models: body.models.map((entry) => {
          const before = table.models.find(
            (m) => m.provider === entry.provider && m.modelId === entry.modelId,
          );
          const keepsPromotion =
            before?.discount !== undefined &&
            entry.renamedFrom === undefined &&
            JSON.stringify(entry.pricing) === JSON.stringify(before.pricing);
          return model({
            provider: entry.provider,
            modelId: entry.modelId,
            ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
            ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
            ...(entry.clientType !== undefined ? { clientType: entry.clientType } : {}),
            ...(entry.pricing !== undefined ? { pricing: entry.pricing } : {}),
            ...(keepsPromotion ? { discount: before.discount } : {}),
            ...(typeof entry.baseUrl === "string"
              ? { credential: { baseUrl: entry.baseUrl } }
              : before?.credential !== undefined
                ? { credential: before.credential }
                : {}),
          });
        }),
      };
      return json(table);
    }
    return apiError(404, "not_found");
  });
  return {
    puts,
    refuseNext: () => {
      refuse = true;
    },
  };
}

/** The card whose name reads `name`, or undefined when the list shows none. */
const card = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button span.font-medium")]
    .find((s) => s.textContent === name)
    ?.closest("button") ?? undefined;

async function openModelsPage() {
  const server = modelsServer();
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
          h(AuthProvider, null, h(ProjectProvider, null, h(ModelsPage), h(UnsavedPrompt))),
        ),
      ),
    ),
  );
  // Searching force-opens every matching group, so the cards are on screen.
  await waitFor(
    () => document.querySelector(`input[placeholder="${en.models.searchPlaceholder}"]`) !== null,
  );
  await type(document.querySelector(`input[placeholder="${en.models.searchPlaceholder}"]`)!, "a");
  await waitFor(() => card("Atlas") !== undefined);
  return server;
}

async function editAtlas() {
  await click(card("Atlas")!);
  await waitFor(() => dialogs().length === 1);
}

const promptOpen = () => hasButton(en.common.discard);

describe("the model config dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    localStorage.setItem("penguin.lang", "en");
    // What jsdom does not implement and the page reads: the pointer query, and the observer
    // an input with a unit inside it sizes its padding by.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("keeps the dialog open with the draft when the save is refused, and the list as it was", async () => {
    const server = await openModelsPage();
    await editAtlas();
    await type(field(en.models.displayName), "Atlas Prime");
    server.refuseNext();
    await click(button(en.common.save));
    await waitFor(() => server.puts.length === 1);

    expect(dialogs()).toHaveLength(1);
    expect(field(en.models.displayName).value).toBe("Atlas Prime");
    expect(card("Atlas Prime")).toBeUndefined();
    expect(card("Atlas")).toBeDefined();

    await click(button(en.common.save));
    await waitFor(() => dialogs().length === 0);
    expect(card("Atlas Prime")).toBeDefined();
  });

  it("adds nothing to the list when adding a model is refused, and says Add", async () => {
    const server = await openModelsPage();
    await click(button(`${en.models.addToGroup} ${providerInfo("custom")!.label}`));
    expect(button(en.models.addAction).disabled).toBe(true);
    await type(field(en.models.modelId), "nova-2");
    await type(field(en.models.baseUrl), "https://nova.example/v1");
    expect(button(en.models.addAction).disabled).toBe(false);

    server.refuseNext();
    await click(button(en.models.addAction));
    await waitFor(() => server.puts.length === 1);
    expect(dialogs()).toHaveLength(1);
    expect(field(en.models.modelId).value).toBe("nova-2");
    expect(card("nova-2")).toBeUndefined();
  });

  it("opens the folded Details when a field inside it is what holds Add", async () => {
    await openModelsPage();
    await click(button(`${en.models.addToGroup} ${providerInfo("custom")!.label}`));
    const fold = button(en.models.details);
    expect(fold.getAttribute("aria-expanded")).toBe("false");

    // Custom holds no base URL for its models, so a new one needs its own: the field is folded.
    await type(field(en.models.modelId), "nova-2");
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain(en.models.baseUrlRequired);
    expect(button(en.models.addAction).disabled).toBe(true);
  });

  it("asks before Esc or Cancel drop an edit, and closes an untouched dialog at once", async () => {
    await openModelsPage();
    await editAtlas();
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);

    await editAtlas();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.models.displayName), "Atlas Prime");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(en.models.displayName).value).toBe("Atlas Prime");

    await click(button(en.common.cancel));
    await click(button(en.common.discard));
    expect(dialogs()).toEqual([]);
    expect(card("Atlas")).toBeDefined();
  });

  it("asks before a save that cancels the running promotion, and saves a name at once", async () => {
    const server = await openModelsPage();
    await editAtlas();
    await click(button(en.models.details));
    await type(field(en.models.priceOutput), "2");
    await click(button(en.common.save));
    expect(dialogs()).toHaveLength(2);
    expect(server.puts).toHaveLength(0);
    // Keep the promotion: the price goes back, and a name alone writes without a question.
    await pressEscape();
    await type(field(en.models.priceOutput), "1");
    await type(field(en.models.displayName), "Atlas Prime");
    await click(button(en.common.save));
    await waitFor(() => server.puts.length === 1);
    expect(server.puts[0]!.models[0]!.pricing).toEqual({
      cacheRead: 0.1,
      cacheWrite: 0.2,
      output: 1,
    });
  });
  it("says a taken group name as it is typed, and asks before Esc drops a typed one", async () => {
    await openModelsPage();
    // The entry is hidden while searching: the list it would extend is being filtered.
    await type(document.querySelector(`input[placeholder="${en.models.searchPlaceholder}"]`)!, "");
    await click(button(`＋ ${en.models.addGroup}`));
    expect(button(en.common.confirm).disabled).toBe(true);
    await type(field(en.models.groupNameLabel), "custom");
    expect(document.body.textContent).toContain(en.models.groupNameExists);
    expect(button(en.common.confirm).disabled).toBe(true);
    await type(field(en.models.groupNameLabel), "acme");
    expect(button(en.common.confirm).disabled).toBe(false);

    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(en.models.groupNameLabel).value).toBe("acme");
  });
});

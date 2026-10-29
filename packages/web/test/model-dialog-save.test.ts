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
 * - Its import holds Detect and Fetch while the base URL is blank and says the URL is required
 *   under the field, whose placeholder asks for one, like every required base URL.
 * - Its import fetches the endpoint's list first, each model once and every one ticked; only the
 *   models left ticked are written, under the new group, beside the rows already there, with
 *   the group's connection written once; the result counts the repeats it left out as skipped,
 *   and not the models left unticked.
 * - The second click of a double-click on Fetch lands on Import and imports nothing; a single
 *   click then imports.
 * - Import is held while nothing is ticked.
 * - A filter hides rows without changing their ticks, and Select none clears only the rows the
 *   filter shows.
 * - The key, the base URL and the protocol are locked while the list is being fetched.
 * - An API key, base URL or protocol that differs from the fetch's hides the list and writes
 *   nothing; put back, the list returns with its ticks and nothing is fetched; a fetch with the
 *   new value sends it.
 * - An endpoint that cannot list models, a listing that fails (with a reason or without), and a
 *   listing with nothing usable each say so in the dialog, show no list and write nothing.
 * - A model with no key anywhere names the variable its client reads when the server reports it
 *   set, and otherwise asks for a key; the key field is never left without a placeholder.
 * - The price fields say a model left without prices is not costed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type {
  EndpointModelListRequest,
  EndpointModelListResponse,
  ModelInfo,
  ModelsResponse,
  ModelsUpdateRequest,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import { providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { toastStore } from "@prismshadow/penguin-ui";
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
  run,
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
/** A DeepSeek preset with no key in the file: its client reads DEEPSEEK_API_KEY. */
const deepseek = (envKeyMasked?: string) =>
  model({
    provider: "deepseek",
    modelId: "deepseek-flash",
    displayName: "DeepSeek Flash",
    contextWindow: 1000000,
    envKey: "DEEPSEEK_API_KEY",
    ...(envKeyMasked !== undefined ? { envKeyMasked } : {}),
  });

/**
 * What POST models/list answers: the ids of a listing that succeeds, or the whole outcome as
 * the server reports it.
 */
type Listing = string[] | EndpointModelListResponse;

function modelsServer(models: ModelInfo[] = [ATLAS], listing: Listing = []) {
  let table: ModelsResponse = { providers: {}, models };
  let refuse = false;
  const puts: ModelsUpdateRequest[] = [];
  /** Every endpoint listing asked for (POST models/list), as sent. */
  const lists: EndpointModelListRequest[] = [];
  /** While set, a listing's answer waits for it. */
  let listGate: Promise<void> | null = null;
  stubFetch((req) => {
    if (req.path === "/api/projects/p1/models/list" && req.method === "POST") {
      lists.push(req.body as EndpointModelListRequest);
      const answer = json(Array.isArray(listing) ? { ok: true, models: listing } : listing);
      return listGate === null ? answer : listGate.then(() => answer);
    }
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
    lists,
    refuseNext: () => {
      refuse = true;
    },
    /** Holds every listing's answer until the returned release is called. */
    holdListing: () => {
      let release!: () => void;
      listGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        listGate = null;
        release();
      };
    },
  };
}

/** The card whose name reads `name`, or undefined when the list shows none. */
const card = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button span.font-medium")]
    .find((s) => s.textContent === name)
    ?.closest("button") ?? undefined;

async function openModelsPage(models?: ModelInfo[], listing?: Listing) {
  const server = modelsServer(models, listing);
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

const searchBox = () =>
  document.querySelector<HTMLInputElement>(`input[placeholder="${en.models.searchPlaceholder}"]`)!;

/** The base URL field's protocol menu trigger, whatever it currently names. */
const protocolMenu = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.getAttribute("aria-label")?.startsWith(`${en.models.protocol}: `),
  )!;

/** Picks `protocol` from the base URL field's protocol menu. */
async function pickProtocol(protocol: string) {
  await click(protocolMenu());
  const row = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((r) =>
    r.textContent?.startsWith(en.models.protocolNames[protocol]!),
  );
  await click(row!);
}

/** The add-group dialog in import mode for group `acme`, its endpoint filled in, the protocol picked. */
async function openImport(listing: Listing) {
  const server = await openModelsPage(undefined, listing);
  // The entry is hidden while searching: the list it would extend is being filtered.
  await type(searchBox(), "");
  await click(button(`＋ ${en.models.addGroup}`));
  await type(field(en.models.groupNameLabel), "acme");
  await click(button(en.models.groupModeImport));
  await type(field(en.models.apiKey), "sk-acme");
  await type(field(en.models.baseUrl), "https://acme.example/v1");
  await pickProtocol("openai-chat");
  return server;
}

/** The pick list's boxes on screen, each with the model id its row names. */
const pickRows = () =>
  [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')].map(
    (box) => ({ box, id: box.closest("label")?.textContent ?? "" }),
  );
const pickBox = (id: string) => pickRows().find((row) => row.id === id)?.box;
const tickedIds = () =>
  pickRows()
    .filter((row) => row.box.checked)
    .map((row) => row.id);

async function fetchList(firstId: string) {
  await click(button(en.models.groupImportFetch));
  await waitFor(() => pickBox(firstId) !== undefined);
}

/** The model ids a PUT wrote under `group`, in the order sent. */
const idsIn = (put: ModelsUpdateRequest, group: string) =>
  put.models.filter((m) => m.provider === group).map((m) => m.modelId);

const promptOpen = () => hasButton(en.common.discard);

describe("the model config dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    toastStore.setState({ items: [] });
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

  it("says on each price field that a model without prices is not costed", async () => {
    await openModelsPage();
    await click(button(`${en.models.addToGroup} ${providerInfo("custom")!.label}`));
    await click(button(en.models.details));
    for (const label of [
      en.models.priceCacheRead,
      en.models.priceCacheWrite,
      en.models.priceOutput,
    ]) {
      expect(field(label).getAttribute("placeholder")).toBe(en.models.priceBlankHint);
    }
  });

  it("asks for a key where the variable the model's client reads is not set", async () => {
    await openModelsPage([ATLAS, deepseek()]);
    await click(card("DeepSeek Flash")!);
    await waitFor(() => dialogs().length === 1);
    expect(field(en.models.apiKey).getAttribute("placeholder")).toBe(en.models.apiKeyEnterHint);
  });

  it("names the variable the model's client reads where the server reports it set", async () => {
    await openModelsPage([ATLAS, deepseek("sk-d…0000")]);
    await click(card("DeepSeek Flash")!);
    await waitFor(() => dialogs().length === 1);
    expect(field(en.models.apiKey).getAttribute("placeholder")).toBe(
      en.models.apiKeyEnvHint("DEEPSEEK_API_KEY"),
    );
  });

  it("holds an import while its base URL is blank, and says so under a field that asks for one", async () => {
    await openModelsPage();
    await type(searchBox(), "");
    await click(button(`＋ ${en.models.addGroup}`));
    await type(field(en.models.groupNameLabel), "acme");
    await click(button(en.models.groupModeImport));
    const url = field(en.models.baseUrl);
    expect(url.getAttribute("placeholder")).toBe(en.models.baseUrlEnterHint);
    expect(document.body.textContent).toContain(en.models.baseUrlRequired);
    expect(button(en.models.detectProtocol).disabled).toBe(true);

    // A protocol picked by hand brings Fetch, which still waits for the base URL.
    await pickProtocol("openai-chat");
    expect(button(en.models.groupImportFetch).disabled).toBe(true);

    await type(url, "https://acme.example/v1");
    expect(button(en.models.groupImportFetch).disabled).toBe(false);
    expect(button(en.models.detectProtocol).disabled).toBe(false);
    expect(document.body.textContent).not.toContain(en.models.baseUrlRequired);
  });

  it("imports only the models left ticked, under the new group, with its connection once", async () => {
    const server = await openImport(["m-a", "m-b", "m-b", "m-c"]);
    await fetchList("m-a");
    expect(server.lists).toEqual([
      { baseUrl: "https://acme.example/v1", clientType: "openai-chat", apiKey: "sk-acme" },
    ]);
    // A repeated id is offered once, and every model starts ticked.
    expect(pickRows().map((row) => row.id)).toEqual(["m-a", "m-b", "m-c"]);
    expect(tickedIds()).toEqual(["m-a", "m-b", "m-c"]);
    expect(server.puts).toHaveLength(0);

    await click(pickBox("m-b")!);
    await click(button(en.models.groupImportPicked(2)));
    await waitFor(() => server.puts.length === 1);

    const put = server.puts[0]!;
    expect(idsIn(put, "acme")).toEqual(["m-a", "m-c"]);
    // The rows already configured are sent once, as they were.
    expect(idsIn(put, "custom")).toEqual(["atlas-1"]);
    expect(put.models).toHaveLength(3);
    expect(put.providers).toEqual({
      acme: { baseUrl: "https://acme.example/v1", clientType: "openai-chat", apiKey: "sk-acme" },
    });
    await waitFor(() => dialogs().length === 0);
    // Two imported; the repeated m-b is skipped, the unticked m-b is not counted.
    expect(toastStore.getState().items.map((t) => t.text)).toContain(en.models.groupImported(2, 1));
  });

  it("imports nothing on the second click of a double-click, and imports on a single click", async () => {
    const server = await openImport(["m-a", "m-b", "m-c"]);
    const action = button(en.models.groupImportFetch);
    await click(action);
    await waitFor(() => pickBox("m-a") !== undefined);
    // The same button now imports; a double-click's second click lands on it.
    expect(action.textContent).toBe(en.models.groupImportPicked(3));
    await run(() =>
      action.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 2 }),
      ),
    );
    expect(server.puts).toHaveLength(0);
    expect(dialogs()).toHaveLength(1);

    await click(action);
    await waitFor(() => server.puts.length === 1);
    expect(idsIn(server.puts[0]!, "acme")).toEqual(["m-a", "m-b", "m-c"]);
  });

  it("holds Import while nothing is ticked", async () => {
    const server = await openImport(["m-a", "m-b"]);
    await fetchList("m-a");
    await click(button(en.models.groupImportSelectNone));
    expect(tickedIds()).toEqual([]);
    expect(button(en.models.groupImportPicked(0)).disabled).toBe(true);

    await click(pickBox("m-b")!);
    expect(button(en.models.groupImportPicked(1)).disabled).toBe(false);
    expect(server.puts).toHaveLength(0);
  });

  it("keeps the ticks a filter hides, and Select none clears only the rows it shows", async () => {
    const plain = ["m-01", "m-02", "m-03", "m-04", "m-05", "m-06"];
    const fp8 = plain.map((id) => `${id}-fp8`);
    const server = await openImport([...plain, ...fp8]);
    await fetchList("m-01");
    await click(pickBox("m-01")!);

    await type(field(en.models.groupImportFilter), "FP8");
    expect(pickRows().map((row) => row.id)).toEqual(fp8);
    await click(button(en.models.groupImportSelectNone));
    expect(tickedIds()).toEqual([]);

    await type(field(en.models.groupImportFilter), "");
    expect(tickedIds()).toEqual(plain.slice(1));
    await click(button(en.models.groupImportPicked(5)));
    await waitFor(() => server.puts.length === 1);
    expect(idsIn(server.puts[0]!, "acme")).toEqual(plain.slice(1));
  });

  it("locks the key, the base URL and the protocol while the list is being fetched", async () => {
    const server = await openImport(["m-a"]);
    const release = server.holdListing();
    await click(button(en.models.groupImportFetch));
    await waitFor(() => server.lists.length === 1);
    expect(field(en.models.apiKey).disabled).toBe(true);
    expect(field(en.models.baseUrl).disabled).toBe(true);
    expect(protocolMenu().disabled).toBe(true);

    await run(release);
    await waitFor(() => pickBox("m-a") !== undefined);
    expect(field(en.models.apiKey).disabled).toBe(false);
    expect(protocolMenu().disabled).toBe(false);
  });

  it.each([
    {
      edited: "API key",
      edit: () => type(field(en.models.apiKey), "sk-other"),
      restore: () => type(field(en.models.apiKey), "sk-acme"),
      sent: (req: EndpointModelListRequest) => req.apiKey,
      value: "sk-other",
    },
    {
      edited: "base URL",
      edit: () => type(field(en.models.baseUrl), "https://other.example/v1"),
      restore: () => type(field(en.models.baseUrl), "https://acme.example/v1"),
      sent: (req: EndpointModelListRequest) => req.baseUrl,
      value: "https://other.example/v1",
    },
    {
      edited: "protocol",
      edit: () => pickProtocol("openai-responses"),
      restore: () => pickProtocol("openai-chat"),
      sent: (req: EndpointModelListRequest) => req.clientType,
      value: "openai-responses",
    },
  ])(
    "hides the list while the $edited differs from the fetch's, and fetches with the new one",
    async ({ edit, restore, sent, value }) => {
      const server = await openImport(["m-a", "m-b"]);
      await fetchList("m-a");
      await click(pickBox("m-b")!);

      await edit();
      expect(pickBox("m-a")).toBeUndefined();
      expect(hasButton(en.models.groupImportFetch)).toBe(true);

      // Put back, the list returns as it was left, without asking the endpoint again.
      await restore();
      expect(tickedIds()).toEqual(["m-a"]);
      expect(server.lists).toHaveLength(1);

      await edit();
      await fetchList("m-a");
      expect(server.lists.map(sent)[1]).toBe(value);
      expect(server.puts).toHaveLength(0);
    },
  );

  it.each([
    {
      endpoint: "cannot list models",
      listing: { ok: false, unsupported: true, message: "no models endpoint" },
      said: en.models.groupImportUnsupported,
    },
    {
      endpoint: "fails with a reason",
      listing: { ok: false, message: "401 invalid key" },
      said: "401 invalid key",
    },
    { endpoint: "fails without one", listing: { ok: false }, said: en.models.groupImportFailed },
    { endpoint: "lists nothing usable", listing: ["", "  "], said: en.models.groupImportEmpty },
  ])(
    "says so in the dialog and writes nothing when the endpoint $endpoint",
    async ({ listing, said }) => {
      const server = await openImport(listing);
      await click(button(en.models.groupImportFetch));
      await waitFor(() => dialogs()[0]!.textContent!.includes(said));

      expect(pickRows()).toEqual([]);
      expect(button(en.models.groupImportFetch).disabled).toBe(false);
      expect(server.puts).toHaveLength(0);
    },
  );
});

// @vitest-environment jsdom
/**
 * A group's settings dialog (features/models/provider-settings-dialog.tsx) under the settings
 * commit model, driven the way a user drives it. (provider-settings.test.ts holds what a save
 * sends and what the dialog shows; this file is about when it may save and how it is left.)
 *
 * - Save waits while nothing differs from what the group stores: typing a key makes it live,
 *   and typing the stored base URL back makes the form clean again.
 * - A base URL that is not an absolute http(s) URL is said under the field as it is typed, and
 *   holds Save.
 * - Closing with edits asks first, on Esc and on Cancel: "keep editing" keeps the dialog and
 *   the typing, "discard" closes it; an untouched dialog closes at once.
 * - A landed save hands the server's table to the page.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, Fragment } from "react";
import type { ModelsResponse, ProviderConnectionDto } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { ProviderSettingsDialog } from "../src/features/models/provider-settings-dialog";
import { userProviderInfo } from "../src/features/models/model-grouping";
import { json, stubFetch } from "./helpers/fetch";
import {
  button,
  click,
  field,
  hasButton,
  mount,
  pressEscape,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const STORED: ProviderConnectionDto = {
  baseUrl: "https://proxy.example/v1",
  clientType: "openai-chat",
  apiKeyMasked: "sk-g…2222",
};
const ANSWER: ModelsResponse = { providers: { acme: STORED }, models: [] };

async function openSettings() {
  const network = stubFetch(() => json(ANSWER));
  const onClose = vi.fn();
  const onSaved = vi.fn();
  await mount(
    h(
      Fragment,
      null,
      h(ProviderSettingsDialog, {
        projectId: "p1",
        provider: userProviderInfo("acme"),
        group: STORED,
        rows: [],
        detectedEnvKeys: new Set<string>(),
        onClose,
        onSaved,
      }),
      h(UnsavedPrompt),
    ),
  );
  return { network, onClose, onSaved };
}

const promptOpen = () => hasButton(en.common.discard);

describe("a group's settings dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a change before Save goes live, and is clean again once it is typed back", async () => {
    await openSettings();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.models.apiKey), "sk-new-key");
    expect(button(en.common.save).disabled).toBe(false);
    await type(field(en.models.apiKey), "");
    await type(field(en.models.baseUrl), "https://other.example/v1");
    expect(button(en.common.save).disabled).toBe(false);
    await type(field(en.models.baseUrl), "https://proxy.example/v1 ");
    expect(button(en.common.save).disabled).toBe(true);
  });

  it("says why a base URL is refused as it is typed, and holds Save", async () => {
    await openSettings();
    await type(field(en.models.baseUrl), "proxy.example/v1");
    expect(document.body.textContent).toContain(en.models.baseUrlInvalid);
    expect(button(en.common.save).disabled).toBe(true);
  });

  it.each([
    ["Escape", pressEscape],
    ["Cancel", () => click(button(en.common.cancel))],
  ])("asks on %s while edited, and keep editing leaves the typing", async (_, leave) => {
    const { onClose } = await openSettings();
    await type(field(en.models.apiKey), "sk-new-key");
    await leave();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(onClose).not.toHaveBeenCalled();
    expect(field(en.models.apiKey).value).toBe("sk-new-key");

    await leave();
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes an untouched dialog at once", async () => {
    const { onClose } = await openSettings();
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands the server's table to the page once the save lands", async () => {
    const { network, onSaved } = await openSettings();
    await type(field(en.models.apiKey), "sk-new-key");
    await click(button(en.common.save));
    await waitFor(() => onSaved.mock.calls.length === 1);
    expect(network.requests.at(-1)!.body).toEqual({ apiKey: "sk-new-key" });
    expect(onSaved).toHaveBeenCalledWith(ANSWER);
  });
});

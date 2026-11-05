// @vitest-environment jsdom
/**
 * The Proxy options page (features/settings/proxy-section.tsx) under the settings commit model,
 * against the admin settings fake.
 *
 * - A switch writes the moment it is flipped, with only its own field in the request, and the
 *   address typed beside it stays as typed and unsaved.
 * - A refused switch write puts the switch back and says why in a toast.
 * - While the address has unsaved edits both switches are held, with a hint to save it first.
 * - Save and Reset are held while the address is clean; Reset puts the stored address back
 *   without asking.
 * - Save sends the address alone and shows it in the form the server stored; the page is clean.
 * - A rejected address stays on screen, unsaved, with the reason under the box.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved, toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ProxySection } from "../src/features/settings/proxy-section";
import { adminSettingsServer } from "./helpers/admin-settings";
import { button, click, field, mount, switchNamed, type, unmountAll, waitFor } from "./helpers/dom";

const ADDRESS = "Proxy address";
const FOR_APP = "Application uses the proxy";
const FOR_AGENT = "Agent environment uses the proxy";

async function openPage() {
  const server = adminSettingsServer();
  await mount(h(ProxySection));
  await waitFor(() => document.querySelector(`input[aria-label="${ADDRESS}"]:enabled`) !== null);
  return server;
}

const toasts = () => toastStore.getState().items.map((t) => [t.kind, t.text]);

describe("the Proxy options page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => toastStore.setState({ items: [] }));
  afterEach(async () => {
    await unmountAll();
  });

  it("writes a flipped switch alone, and leaves the switches alone while nothing is typed", async () => {
    const server = await openPage();
    await click(switchNamed(FOR_AGENT));
    expect(server.puts()).toEqual([{ proxyForAgent: true }]);
    expect(switchNamed(FOR_AGENT).getAttribute("aria-checked")).toBe("true");
    expect(hasUnsaved()).toBe(false);
  });

  it("puts a refused switch back and says why", async () => {
    const server = await openPage();
    server.refuseNext(500, "internal");
    await click(switchNamed(FOR_APP));
    expect(switchNamed(FOR_APP).getAttribute("aria-checked")).toBe("true");
    expect(server.stored().proxyForApp).toBe(true);
    expect(toasts().map(([kind]) => kind)).toEqual(["error"]);
  });

  it("holds both switches with a hint while the address has unsaved edits", async () => {
    await openPage();
    await type(field(ADDRESS), "http://other:3128");
    expect(switchNamed(FOR_APP).disabled).toBe(true);
    expect(switchNamed(FOR_AGENT).disabled).toBe(true);
    expect(document.body.textContent).toContain("Save the proxy address first");
    await type(field(ADDRESS), "http://proxy.local:8080");
    expect(switchNamed(FOR_APP).disabled).toBe(false);
  });

  it("holds Save and Reset while clean, and Reset puts the stored address back", async () => {
    const server = await openPage();
    expect(button("Save").disabled).toBe(true);
    expect(button("Reset").disabled).toBe(true);
    await type(field(ADDRESS), "http://other:3128");
    expect(button("Save").disabled).toBe(false);
    await click(button("Reset"));
    expect(field(ADDRESS).value).toBe("http://proxy.local:8080");
    expect(button("Save").disabled).toBe(true);
    expect(server.puts()).toEqual([]);
  });

  it("saves the address alone and shows it as the server stored it", async () => {
    const server = await openPage();
    await type(field(ADDRESS), " other:3128 ");
    await click(button("Save"));
    expect(server.puts()).toEqual([{ proxyUrl: " other:3128 " }]);
    expect(field(ADDRESS).value).toBe("http://other:3128");
    expect(button("Save").disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("keeps a rejected address on screen, unsaved, with the reason under the box", async () => {
    const server = await openPage();
    server.refuseNext(400, "invalid_proxy_url");
    await type(field(ADDRESS), "ftp://nowhere");
    await click(button("Save"));
    expect(field(ADDRESS).value).toBe("ftp://nowhere");
    expect(field(ADDRESS).getAttribute("aria-invalid")).toBe("true");
    expect(button("Save").disabled).toBe(false);
    expect(hasUnsaved()).toBe(true);
  });
});

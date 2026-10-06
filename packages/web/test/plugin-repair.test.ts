/**
 * "Fix with AI" on a plugin the running build cannot fully run (features/plugins/plugin-repair.tsx).
 *
 * - The chat it opens is in the temporary Workspace, with the default Agent, and its text is
 *   the repair prompt: the plugin, what became of it, and the platform's reason verbatim.
 * - The draft the bridge writes from it is a composed one — in the composer, never sent.
 * - No Agent to hand it to means no chat.
 * - The row offers the button only where the build cannot fully run the plugin and someone
 *   wired it; it says "disabled on this build" and shows the reason.
 */
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { aiChatRouteState, buildAiDraft } from "../src/features/ai-create/ai-bridge";
import { repairChatRequest } from "../src/features/plugins/plugin-repair";
import { ModuleRow } from "../src/features/plugins/plugins-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

const agent = (agentId: string) => ({ agentId }) as AgentSummary;
const UNMET = {
  specifier: "@acme/unmet",
  disabled: true,
  reason: "/PlatformModule/Unmet: 'Thing' names interface '@acme/unmet#Nope'",
};

afterEach(() => setActiveStrings(zh));

describe("the chat a plugin repair opens", () => {
  it("is the default Agent's, in the temporary Workspace, with the repair prompt", () => {
    setActiveStrings(en);
    const request = repairChatRequest(UNMET, [agent("other"), agent("default_agent")]);
    expect(request).toMatchObject({ agentId: "default_agent", workspace: "" });
    expect(request!.text).toContain("`@acme/unmet`");
    expect(request!.text).toContain("it is disabled");
    expect(request!.text).toContain(UNMET.reason);
    expect(request!.text).toContain("before you change an installed plugin");
    // The Workspace is pinned on the route too, so a Project default does not override it.
    expect(aiChatRouteState(request!)).toEqual({ agentId: "default_agent", workspace: "" });
  });

  it("says a plugin that still runs is only missing part of itself", () => {
    setActiveStrings(en);
    const request = repairChatRequest({ ...UNMET, disabled: false }, [agent("a")]);
    expect(request!.text).toContain("part of what it contributes is not in use");
    expect(request!.text).not.toContain("it is disabled");
  });

  it("is written in the reader's language", () => {
    setActiveStrings(zh);
    const request = repairChatRequest(UNMET, [agent("a")]);
    expect(request!.text).toContain("它已被停用");
    expect(request!.text).toContain(UNMET.reason);
  });

  it("lands in the composer as a composed draft, not a sent message", () => {
    setActiveStrings(en);
    const request = repairChatRequest(UNMET, [agent("a")])!;
    const draft = buildAiDraft({ text: "typed earlier", workspace: "/srv/project" }, request);
    expect(draft).toMatchObject({
      agentId: "a",
      text: request.text,
      workspace: "",
      aiPrefill: true,
    });
  });

  it("is not opened when the Project has no Agent", () => {
    expect(repairChatRequest(UNMET, [])).toBeNull();
  });
});

describe("the row of a plugin the build cannot fully run", () => {
  beforeEach(() => {
    stubLocalStorage().setItem("penguin.lang", "en");
  });

  const inLocale = <P extends object>(child: FunctionComponent<P>, props: P) =>
    renderToStaticMarkup(createElement(LocaleProvider, null, createElement(child, props)));
  const row = (over: Partial<Parameters<typeof ModuleRow>[0]>) =>
    inLocale(ModuleRow, {
      specifier: "@acme/unmet",
      entry: undefined,
      state: "disabled",
      unsatisfied: UNMET.reason,
      shipped: false,
      busy: false,
      blocked: false,
      onInstall: null,
      onRemove: () => undefined,
      onRepair: () => undefined,
      ...over,
    });
  const repairButton = `aria-label="${en.plugins.repair} @acme/unmet"`;

  it("says it is disabled on this build, why, and offers the repair beside Remove", () => {
    const html = row({});
    expect(html).toContain(en.plugins.stateDisabled);
    expect(html).toContain("names interface");
    expect(html).toContain(repairButton);
    expect(html).toContain(`aria-label="${en.plugins.uninstall} @acme/unmet"`);
  });

  it("a running row that lost a contribution says so and offers the same repair", () => {
    const html = row({ state: "active", unsatisfied: "contributes to 'nowhere.slot'" });
    expect(html).toContain(en.plugins.stateActive);
    expect(html).toContain("Part of it is not in use on this build");
    expect(html).toContain(repairButton);
  });

  it("offers no repair to someone who may not change plugins, nor on a row that runs whole", () => {
    expect(row({ onRepair: null })).not.toContain(repairButton);
    const healthy = inLocale(ModuleRow, {
      specifier: "@acme/unmet",
      entry: undefined,
      state: "active",
      shipped: false,
      busy: false,
      blocked: false,
      onInstall: null,
      onRemove: () => undefined,
      onRepair: () => undefined,
    });
    expect(healthy).not.toContain(repairButton);
  });
});

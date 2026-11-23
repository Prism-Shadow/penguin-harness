// @vitest-environment jsdom
/**
 * A composer mode the Agent lacks, offered in the "+" menu (features/chat/prompt-modes.ts and
 * chat-input.tsx), on the new-chat page against the draft world's server.
 *
 * - Given an Agent without the Plan mode plugin, the "+" menu lists Plan mode greyed with
 *   Install; picking it installs the plugin on that Agent and turns the mode on, and the first
 *   send carries it.
 * - Given an Agent that has it, the menu lists it as a switch and offers no install.
 * - Given the install refused, the reason is toasted, the mode stays off and is still offered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toastStore } from "@prismshadow/penguin-ui";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import { button, click, hasButton, type, unmountAll, waitFor } from "./helpers/dom";
import { draftWorld, mountDraft } from "./helpers/draft-world";

// The page's socket is the test's to drive (see draft-send.test.ts for the one seam).
vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

/** The library's composer-mode plugin. */
const PLAN = {
  name: "plan",
  title: "Plan mode",
  description: "Discuss the approach first.",
  version: "0.2.18",
  package: "@penguinharness/plan",
  source: "builtin",
  skills: [],
  hooks: ["user_prompt"],
  composerMode: true,
  composerCommand: "plan",
  mcpServers: [],
} satisfies PluginItem;

beforeEach(() => toastStore.setState({ items: [] }));
afterEach(async () => {
  await unmountAll();
  localStorage.clear();
  sessionStorage.clear();
});

const composer = () => document.querySelector("textarea")!;
const planChip = () => S.chat.switchOff("Plan mode");
/** The "+" menu's Plan mode row (the menu's rows are plain buttons), or undefined. */
const planRow = () =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Plan mode"));

/** The draft page with its library read, and the "+" menu open. */
async function openPlusMenu() {
  await mountDraft();
  await waitFor(() => composer() !== null);
  await waitFor(() => hasButton(S.chat.plusMenu), 40);
  await click(button(S.chat.plusMenu));
}

describe("a composer mode the Agent lacks", () => {
  it("is offered greyed with Install, installed on the Agent when picked, turned on, and sent", async () => {
    const world = draftWorld({ plugins: { library: [PLAN], hooks: [] } });
    await openPlusMenu();
    await waitFor(() => planRow()?.textContent?.endsWith(S.chat.switchInstall) === true, 40);
    await click(planRow()!);

    await waitFor(() => hasButton(planChip()), 40);
    expect(world.installs().map((r) => [r.machine, r.body])).toEqual([[null, { names: ["plan"] }]]);

    await type(composer(), "Plan the migration");
    await waitFor(() => hasButton(S.chat.send) && !button(S.chat.send).disabled, 40);
    await click(button(S.chat.send));
    await waitFor(() => world.tasks().length === 1, 40);
    expect(world.tasks()[0]!.body).toMatchObject({ promptHooks: ["plan"] });
  });

  it("selects its installed slash command without sending, then preserves the text of a pasted command", async () => {
    const world = draftWorld({ plugins: { library: [PLAN], hooks: ["plan"] } });
    await mountDraft();
    await waitFor(() => composer() !== null);
    await type(composer(), "/plan");
    const command = () =>
      [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("/plan"));
    await waitFor(() => command() !== undefined, 40);
    await click(command()!);
    await waitFor(() => hasButton(planChip()), 40);
    expect(composer().value).toBe("");
    expect(world.tasks()).toEqual([]);
    await type(composer(), "/plan draft the migration");
    expect(composer().value).toBe("draft the migration");
    await click(button(S.chat.send));
    await waitFor(() => world.tasks().length === 1, 40);
    expect(world.tasks()[0]!.body).toMatchObject({
      promptHooks: ["plan"],
      input: [{ type: "text", text: "draft the migration" }],
    });
  });

  it("keeps a slash prefix as ordinary draft text when the Agent has no matching mode", async () => {
    const world = draftWorld({ plugins: { library: [PLAN], hooks: [] } });
    await openPlusMenu();
    await waitFor(() => planRow() !== undefined, 40);
    await click(button(S.chat.plusMenu));
    await type(composer(), "/plan draft the migration");
    expect(composer().value).toBe("/plan draft the migration");
    expect(hasButton(planChip())).toBe(false);
    expect(world.installs()).toEqual([]);
  });

  it("is a plain switch on an Agent that has it, with nothing to install", async () => {
    const world = draftWorld({ plugins: { library: [PLAN], hooks: ["plan"] } });
    await openPlusMenu();
    await waitFor(() => planRow() !== undefined, 40);
    expect(planRow()!.textContent).not.toContain(S.chat.switchInstall);
    expect(world.installs()).toEqual([]);
  });

  it("stays off and offered when the install is refused, saying why", async () => {
    const world = draftWorld({ plugins: { library: [PLAN], hooks: [] } });
    world.refuseNext("install", { status: 403, code: "forbidden" });
    await openPlusMenu();
    await waitFor(() => planRow()?.textContent?.endsWith(S.chat.switchInstall) === true, 40);
    await click(planRow()!);

    await waitFor(() => toastStore.getState().items.some((t) => t.kind === "error"), 40);
    expect(hasButton(planChip())).toBe(false);
    await click(button(S.chat.plusMenu));
    expect(planRow()?.textContent?.endsWith(S.chat.switchInstall)).toBe(true);
  });
});

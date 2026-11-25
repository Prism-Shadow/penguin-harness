// @vitest-environment jsdom
/**
 * A new conversation's approval mode comes from the server it will run on
 * (features/chat/draft-permission.ts): each server keeps its own Sandbox default preset, and the
 * server creating the Session applies it when the request names no approval mode.
 *
 * - Given a draft on a machine whose default preset asks, with nothing picked and no Project
 *   pin, the permission button shows the machine's default and the create names no approval mode.
 * - Given a draft on a machine that does not answer for its defaults, and a Project pin on this
 *   server, the create still goes out, naming the pin.
 * - Given a draft that moved from a machine to this server while the machine's defaults were
 *   still on their way, the machine's late answer changes neither the button nor the create.
 * - Given a draft on a machine, the permission menu's More… opens that machine's Sandbox settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toastStore } from "@prismshadow/penguin-ui";
import type { ChatDefaultsDto } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import { draftKey, saveDraft } from "@prismshadow/penguin-library-session/web";
import { ADMIN_ME } from "./helpers/admin-settings";
import { whereIs } from "./helpers/agent-app";
import { button, click, hasButton, menuItem, run, type, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json } from "./helpers/fetch";
import { AGENT_ID, MACHINE, PROJECT_ID, draftWorld, mountDraft } from "./helpers/draft-world";
import type { DraftWorld } from "./helpers/draft-world";

// The page's socket is the test's to drive, as in draft-send.test.ts.
vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

const DRAFT_KEY = draftKey(ADMIN_ME.user.userId, PROJECT_ID);
const send = () => button(S.chat.send);
const composer = () => document.querySelector("textarea")!;
const permission = () =>
  document.querySelector<HTMLButtonElement>(`button[aria-label^="${S.chat.permission.label}:"]`)!;
/** Whether the permission button names `mode` as the approval mode the Session would start with. */
const shows = (mode: keyof typeof S.chat.approvalModeNames) =>
  permission().getAttribute("data-tooltip")!.includes(S.chat.approvalModeNames[mode]!);

/** A server's defaults whose Sandbox default preset gives `mode`. */
const startsWith = (mode: "allow-all" | "always-ask"): ChatDefaultsDto => ({
  sandbox: { mode: "danger-full-access", network: "open", defaultApprovalMode: mode },
});

beforeEach(() => toastStore.setState({ items: [] }));
afterEach(async () => {
  await unmountAll();
  localStorage.clear();
  sessionStorage.clear();
});

/** The draft page on the machine's Workspace, with text typed and its Send live. */
async function draftOnMachine() {
  saveDraft(DRAFT_KEY, { agentId: AGENT_ID, workspace: "/srv/app", machineId: MACHINE });
  const router = await mountDraft();
  await waitFor(() => composer() !== null);
  await type(composer(), "Look at the build");
  await waitFor(() => hasButton(S.chat.send) && !send().disabled, 40);
  return router;
}

/** Each create so far: the server it reached and the approval mode it named. */
const creates = (world: DraftWorld) =>
  world.creates().map((r) => [r.machine, (r.body as { approvalMode?: string }).approvalMode]);

describe("a new conversation's approval mode", () => {
  it("is left to the machine's default preset when nothing is picked or pinned", async () => {
    const world = draftWorld({
      chatDefaults: (machine) => startsWith(machine === null ? "allow-all" : "always-ask"),
    });
    const router = await draftOnMachine();
    await waitFor(() => !permission().disabled);
    expect(shows("always-ask")).toBe(true);

    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);
    expect(creates(world)).toEqual([[MACHINE, undefined]]);
  });

  it("is the Project's pin when the machine does not answer for its defaults", async () => {
    const world = draftWorld({
      chatDefaults: (machine) =>
        machine === null ? { approvalMode: "read-only" } : apiError(503, "machine_no_answer"),
    });
    const router = await draftOnMachine();
    expect(permission().disabled).toBe(true);

    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);
    expect(creates(world)).toEqual([[MACHINE, "read-only"]]);
  });

  it("ignores the machine's answer once the draft has moved to this server", async () => {
    let answerMachine: (defaults: ChatDefaultsDto) => void = () => {};
    const late = new Promise<ChatDefaultsDto>((resolve) => {
      answerMachine = resolve;
    });
    const world = draftWorld({
      chatDefaults: (machine) => (machine === null ? startsWith("allow-all") : late),
    });
    const router = await draftOnMachine();
    expect(permission().disabled).toBe(true);

    // A temporary Workspace on this server (a Workspace group's "+" names one this way).
    await run(() =>
      router.navigate("/chat/new", { state: { projectId: PROJECT_ID, workspace: "" } }),
    );
    await waitFor(() => !permission().disabled);
    await run(() => answerMachine({ approvalMode: "always-ask", ...startsWith("always-ask") }));
    expect(shows("allow-all")).toBe(true);

    await waitFor(() => hasButton(S.chat.send) && !send().disabled, 40);
    await click(send());
    await waitFor(() => whereIs(router) === "/chat/session-1", 40);
    expect(creates(world)).toEqual([[null, undefined]]);
  });

  it("is set on the machine's own Sandbox page from the menu's More…", async () => {
    draftWorld({
      extra: (r) => (r.path === "/api/admin/plugin-config" ? json({ plugins: [] }) : undefined),
    });
    await draftOnMachine();
    await waitFor(() => !permission().disabled);

    await click(permission());
    await click(menuItem(S.chat.permission.more));
    // The page's machine switch names the machine whose settings it shows ("lab" is its alias).
    await waitFor(() => hasButton(S.settings.pluginConfigMachine));
    expect(button(S.settings.pluginConfigMachine).textContent).toBe("lab");
  });
});

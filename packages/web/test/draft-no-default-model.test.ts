// @vitest-environment jsdom
/**
 * The new-chat page of a Project with models but no default model (features/chat/draft-view.tsx):
 * an attention notice in the start page's version line says so, the version line hidden while it
 * shows, and Send waits until the chat has a model.
 *
 * - Given an owner, and no model chosen for the chat, the notice reads 「还没有默认模型」 with one
 *   button, 「设置默认模型」, that asks for the 「默认模型」 dialog; Send stays off with text typed.
 * - Given a member, the notice tells them to ask an owner and offers no button.
 * - Given a default model set while the page is open, the notice goes, the version line returns
 *   and Send comes on.
 * - Given a model chosen for this chat earlier, there is no notice and Send is on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import { onDefaultModelsRequest } from "../src/lib/default-models-request";
import { dispatchChatDefaultsChanged } from "../src/features/chat";
import { draftKey, saveDraft } from "../src/features/chat/draft-cache";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, hasButton, run, type, unmountAll, waitFor } from "./helpers/dom";
import { MODELS, PROJECT_ID, draftWorld, mountDraft } from "./helpers/draft-world";

// The page's socket is the test's to drive, as in draft-send.test.ts: mocked at the stand-in the
// app imports (vitest.config.ts).
vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

/** The Project's model table with its one model and no default. */
const NO_DEFAULT = { ...MODELS, defaultModel: undefined } as unknown as ModelsResponse;
const M1 = { provider: "custom", modelId: "m-1" };

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
  sessionStorage.clear();
});

const composer = () => document.querySelector("textarea");
const send = () => button(S.chat.send);
/** The no-default notice, by what it says. */
const notice = () =>
  [...document.querySelectorAll('[role="status"]')].find((el) =>
    el.textContent?.includes(S.defaultModels.composerNone),
  );

/** The start page's version line under the logo, which the notice takes the place of. */
const versionLine = () => document.querySelector('[data-slot="version"]');

/** The draft page, mounted and loaded, with `text` typed. */
async function draftWith(text: string) {
  await mountDraft();
  await waitFor(() => composer() !== null && hasButton(S.chat.send), 40);
  await type(composer()!, text);
}

describe("a new chat in a Project with no default model", () => {
  it("shows the owner the notice and its button, which asks for the dialog, and keeps Send off", async () => {
    draftWorld({ models: NO_DEFAULT });
    let requests = 0;
    const stop = onDefaultModelsRequest(() => {
      requests += 1;
    });
    try {
      await draftWith("Hello");
      await waitFor(() => notice() !== undefined, 40);

      expect(notice()!.textContent).toContain(S.defaultModels.composerNone);
      expect(notice()!.textContent).not.toContain(S.defaultModels.composerNoneMember);
      expect(versionLine()).toBeNull();
      expect(send().disabled).toBe(true);

      await click(button(S.defaultModels.composerAction));
      expect(requests).toBe(1);
    } finally {
      stop();
    }
  });

  it("tells a member to ask an owner, with no button", async () => {
    draftWorld({ models: NO_DEFAULT, role: "member" });
    await draftWith("Hello");
    await waitFor(() => notice() !== undefined, 40);

    expect(notice()!.textContent).toContain(S.defaultModels.composerNoneMember);
    expect(hasButton(S.defaultModels.composerAction)).toBe(false);
    expect(versionLine()).toBeNull();
    expect(send().disabled).toBe(true);
  });

  it("drops the notice and turns Send on once a default model is set", async () => {
    draftWorld({ models: NO_DEFAULT });
    await draftWith("Hello");
    await waitFor(() => notice() !== undefined, 40);

    await run(() => dispatchChatDefaultsChanged({ projectId: PROJECT_ID, defaultModel: M1 }));
    await waitFor(() => notice() === undefined && !send().disabled, 40);

    expect(notice()).toBeUndefined();
    expect(versionLine()).not.toBeNull();
    expect(send().disabled).toBe(false);
  });

  it("shows no notice when a model was chosen for this chat", async () => {
    draftWorld({ models: NO_DEFAULT });
    saveDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID), { modelRef: M1 });
    await draftWith("Hello");
    await waitFor(() => !send().disabled, 40);

    expect(notice()).toBeUndefined();
  });
});

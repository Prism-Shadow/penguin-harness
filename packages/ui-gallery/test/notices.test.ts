/**
 * The demo's notices, as the app reads them through its own endpoint wrappers: the screenshot
 * script and the browser checks raise them with `notices=1`, and every other frame keeps them
 * down.
 *
 * - Given a store with the notices raised, the signed-in admin is on the initial password and has
 *   not dismissed its banner, and the docs Agent compacts above what the demo model can hold, so
 *   its Sessions carry the context-window notice.
 * - Given a plain store, the admin's password is settled, the banner is dismissed, and the docs
 *   Agent compacts within the window: neither notice is up.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as api from "../../web/src/api/endpoints";
import { modelWindowBelowCompactionLimit } from "../../web/src/lib/context";
import { IDS } from "../src/app/mock/ids";
import { resetStore } from "../src/app/mock/store";

/** Which of the two notices the app would raise, from what it reads at boot and on a chat page. */
async function noticesUp(): Promise<{ banner: boolean; contextWindow: boolean }> {
  const me = await api.getMe();
  const { prefs } = await api.getPrefs();
  const config = await api.getAgentConfig(IDS.project, IDS.agents.docs, null);
  const { models } = await api.getModels(IDS.project, null);
  const model = models.find((m) => m.isDefault);
  return {
    banner: me.user.passwordIsInitial === true && prefs.initialPasswordBannerDismissed !== true,
    contextWindow: modelWindowBelowCompactionLimit(
      model?.contextWindow,
      config.config.compaction?.maxContextLength,
    ),
  };
}

describe("the demo's notices", () => {
  afterEach(() => {
    resetStore({ lang: "en", signedIn: true });
  });

  it("raised, put up the initial-password banner and the context-window notice", async () => {
    resetStore({ lang: "en", signedIn: true, notices: true });
    expect(await noticesUp()).toEqual({ banner: true, contextWindow: true });
  });

  it("are down in a plain store", async () => {
    resetStore({ lang: "zh", signedIn: true });
    expect(await noticesUp()).toEqual({ banner: false, contextWindow: false });
  });
});

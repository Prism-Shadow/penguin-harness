/**
 * The notices a conversation can carry, raised on request (`notices=1` on the frame URL): the
 * demo account otherwise keeps them down, so its surfaces read as a settled account. Raised, the
 * admin is still on the initial password with the banner not yet dismissed (the banner across
 * the main column), and the docs Agent compacts above what the demo model can hold (the
 * context-window notice over the composer, in every docs Agent Session).
 */
import { DEFAULT_MODEL } from "./fixtures";
import type { DemoFixtures } from "./fixtures";
import { IDS } from "./ids";

export function raiseNotices(f: DemoFixtures): void {
  f.user = { ...f.user, passwordIsInitial: true };
  f.prefs = { ...f.prefs, initialPasswordBannerDismissed: false };
  const docs = f.agentConfigs[IDS.agents.docs];
  if (docs !== undefined) {
    docs.config.compaction = {
      ...docs.config.compaction,
      maxContextLength: DEFAULT_MODEL.contextWindow * 2,
    };
  }
}

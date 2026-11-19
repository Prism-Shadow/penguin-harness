/**
 * A conversation taking a new id, told to whoever keeps something under the old one
 * (`ChatModule.sessionHandovers`): a draft's first send created its Session (the draft's dock
 * scope hands over to it), a Session healed into a new one, or a failed first send hands the
 * draft its own back. The chat module records the contributions at boot in their order; the
 * draft page and the Session page hand over (body/draft-view.tsx, session/main-chat-lifecycle.tsx),
 * and every handover is awaited in turn, so the next one starts from what the last one moved.
 *
 * A handover is not gated on its module's server half: it only moves what its own module holds,
 * and holds nothing while that half is away.
 */
import type { SessionHandover } from "@prismshadow/penguin-web-plugin";

let handovers: readonly SessionHandover[] = [];

/** The chat module's side: the contributed handovers, in order. */
export function setSessionHandovers(next: readonly SessionHandover[]): void {
  handovers = next;
}

/** Moves what each contributor keeps under `fromScope` to `toSessionId`, one after another. */
export async function handOverSession(fromScope: string, toSessionId: string): Promise<void> {
  if (fromScope === toSessionId) return;
  for (const handover of handovers) await handover(fromScope, toSessionId);
}

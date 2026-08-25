/**
 * Origin hint for a Feishu-relayed message: the origin block ([feishu_message]) is not
 * rendered verbatim on screen; it collapses into one line reading "Message from Feishu"
 * (naming the sender when the block carries one). The sender's text body itself is
 * rendered as usual by the caller — the scheduled-task banner's treatment.
 */
import { S } from "../../lib/strings";
import type { FeishuOrigin } from "./agent-handoff";

export function FeishuBanner({ origin }: { origin: FeishuOrigin }) {
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      {S.feishu.banner(origin.senderName)}
    </p>
  );
}

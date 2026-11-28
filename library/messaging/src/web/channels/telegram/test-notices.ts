/** What a Telegram credential test reports, as the notices the editor shows for it. */
import type { TelegramTestResponse } from "@prismshadow/penguin-server/api";
import { S } from "@prismshadow/penguin-web/internal";
import type { MessagingTestNotice } from "../channel-form";

/**
 * The notices one Telegram credential-test response turns into, in the order they are shown
 * (the updateCheckOutcome idiom: the classification is a pure function, the host only picks
 * toasts for it).
 *
 * A success whose bot still has Group Privacy on produces TWO. The success line stands
 * unchanged — the credentials really are fine, and the bot really will answer a direct chat —
 * and the privacy notice rides beside it rather than lengthening it: it is about group chats
 * only, and it is the one thing a user cannot discover by testing, since a bot that cannot
 * hear a group produces silence and never an error.
 */
export function telegramTestNotices(res: TelegramTestResponse): MessagingTestNotice[] {
  if (!res.ok) {
    return [{ tone: "error", text: S.messaging.testFail(res.error ?? S.common.unknownError) }];
  }
  const ms = res.latencyMs ?? 0;
  const notices: MessagingTestNotice[] = [
    // The success line names the bot: the one detail a user can check against @BotFather.
    {
      tone: "success",
      text:
        res.botUsername !== undefined
          ? S.messaging.testOkAs(res.botUsername, ms)
          : S.messaging.testOk(ms),
    },
  ];
  // Only an answered `true`: an absent field is unknown, and unknown is not a problem.
  if (res.groupPrivacy === true) notices.push({ tone: "info", text: S.messaging.testPrivacyOn });
  return notices;
}

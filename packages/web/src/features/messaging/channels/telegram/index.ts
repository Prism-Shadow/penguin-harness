/** The Telegram bot channel, as the binding editor shows it. */
import type {
  TelegramBindingInfo,
  TelegramBindingPutRequest,
  TelegramTestRequest,
} from "@prismshadow/penguin-server/api";
import * as api from "../../../../api/endpoints";
import { S } from "../../../../lib/strings";
import type { MessagingChannelForm } from "../channel-form";
import { TelegramFields } from "./fields";
import {
  emptyTelegramFields,
  loadTelegramFields,
  telegramDirty,
  telegramTestable,
  telegramToPut,
  telegramToTest,
  type TelegramFormFields,
} from "./form";
import { telegramTestNotices } from "./test-notices";

export const telegramForm: MessagingChannelForm<
  TelegramFormFields,
  TelegramBindingInfo,
  TelegramBindingPutRequest,
  TelegramTestRequest
> = {
  empty: emptyTelegramFields,
  load: loadTelegramFields,
  toPut: telegramToPut,
  toTest: telegramToTest,
  dirty: telegramDirty,
  testable: telegramTestable,
  accountId: (info) => info.botId,
  secretMasked: (info) => info.botTokenMasked,
  put: (sessionId, body) => api.putTelegramBinding(sessionId, body),
  test: async (sessionId, body) => {
    const res = await api.testTelegramBinding(sessionId, body);
    return { notices: telegramTestNotices(res), error: res.error };
  },
  enableFocus: "credential",
  credentialFields: (fields) => [["bot-token", fields.botToken]],
  Fields: TelegramFields,
  copy: () => S.telegram,
  renderMarkdownHelp: () => S.messaging.renderMarkdownHelpTelegram,
  troubles: () => [
    S.messaging.troubleOnePoller,
    S.messaging.troubleGroupPrivacy,
    S.messaging.troubleNoGroupInbound,
  ],
  // The BotFather section of the bot-features page: "a detailed guide to using @BotFather",
  // opening on /newbot and the token it returns — which is the setup fold's steps, one level
  // deeper. NOT /bots/tutorial: that one is "From BotFather to 'Hello World'", and past its
  // token section it is about downloading an IDE and picking a framework, i.e. about WRITING a
  // bot. Nobody here is writing one — PenguinHarness is the bot. The fragment is a plain
  // document anchor present in the served HTML, so it lands where it says (unlike a hash
  // route, which the server never sees).
  tutorial: "https://core.telegram.org/bots/features#botfather",
};

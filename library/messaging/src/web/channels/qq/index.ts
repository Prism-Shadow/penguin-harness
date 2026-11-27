/** The QQ bot channel, as the binding editor shows it. */
import type {
  QQBindingInfo,
  QQBindingPutRequest,
  QQTestRequest,
} from "@prismshadow/penguin-server/api";
import * as api from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { plainTestOutcome, type MessagingChannelForm } from "../channel-form";
import { QQFields } from "./fields";
import {
  emptyQQFields,
  loadQQFields,
  qqDirty,
  qqTestable,
  qqToPut,
  qqToTest,
  type QQFormFields,
} from "./form";

export const qqForm: MessagingChannelForm<
  QQFormFields,
  QQBindingInfo,
  QQBindingPutRequest,
  QQTestRequest
> = {
  empty: emptyQQFields,
  load: loadQQFields,
  toPut: qqToPut,
  toTest: qqToTest,
  dirty: qqDirty,
  testable: qqTestable,
  accountId: (info) => info.appId,
  secretMasked: (info) => info.appSecretMasked,
  put: (sessionId, body) => api.putQQBinding(sessionId, body),
  test: async (sessionId, body) => plainTestOutcome(await api.testQQBinding(sessionId, body)),
  // The typed fields are the fallback below the QR, so the scan is where a missing credential
  // starts too.
  enableFocus: "scan",
  Fields: QQFields,
  copy: () => S.qq,
  renderMarkdownHelp: () => S.messaging.renderMarkdownHelpQQ,
  // On QQ every send is a passive reply anchored to an inbound message, and that anchor
  // expires, so holding the reply to the run's end loses a long run's output entirely instead
  // of merely delaying it: a different outcome, not a nuance of the same one.
  finalReplyOnlyNote: () => S.messaging.finalReplyOnlyQQWarning,
  // What the QR button spares the reader: the last two setup steps. Disclosed beside them
  // rather than parked beside the button, which is a control and so cannot be the title a
  // standing sentence would need.
  setupNote: () => S.qq.scanHint,
  // The reply budget belongs to "what binding does" rather than troubleshooting: it is not a
  // fault, it is how the channel delivers a long answer.
  whatNote: () => S.qq.replyBudget,
  troubles: () => [S.messaging.troubleQQPassive],
  // The wiki ROOT is the onboarding guide itself — registering a developer account, creating
  // the bot, and the page its AppID and AppSecret are shown on. That is what a reader of the
  // setup fold is after; the API reference one level down at /develop/api-v2/ answers a
  // question they are not asking yet.
  tutorial: "https://bot.q.qq.com/wiki/",
};

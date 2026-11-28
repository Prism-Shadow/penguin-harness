/** The WeChat official claw bot channel, as the binding editor shows it. */
import type { WeChatBindingInfo, WeChatBindingPutRequest } from "@prismshadow/penguin-server/api";
import * as api from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { plainTestOutcome, type MessagingChannelForm } from "../channel-form";
import { WeChatFields } from "./fields";
import {
  emptyWeChatFields,
  loadWeChatFields,
  wechatDirty,
  wechatTestable,
  wechatToPut,
  wechatToTest,
  type WeChatFormFields,
} from "./form";

export const wechatForm: MessagingChannelForm<
  WeChatFormFields,
  WeChatBindingInfo,
  WeChatBindingPutRequest,
  undefined
> = {
  empty: emptyWeChatFields,
  load: loadWeChatFields,
  toPut: wechatToPut,
  toTest: wechatToTest,
  dirty: wechatDirty,
  testable: wechatTestable,
  accountId: (info) => info.botId,
  secretMasked: (info) => info.botTokenMasked,
  put: (sessionId, body) => api.putWeChatBinding(sessionId, body),
  // No body: this channel's probe reads the stored binding, there being no draft.
  test: async (sessionId) => plainTestOutcome(await api.testWeChatBinding(sessionId)),
  enableFocus: "scan",
  Fields: WeChatFields,
  copy: () => S.wechat,
  renderMarkdownHelp: () => S.messaging.renderMarkdownHelpWeChat,
  // Why this channel's form has no fields, said where a reader looking for them arrives.
  setupNote: () => S.wechat.scanOnly,
  // What actually travels on this channel, which is more than on any other here and is the
  // question its users ask first.
  whatNote: () => S.wechat.media,
  troubles: () => [S.messaging.troubleWeChatDirect, S.messaging.troubleWeChatReplyWindow],
  // The bot is authorized by a scan and has no public console and no walkthrough to point at;
  // inventing a URL would send a reader to a page that does not answer them.
  tutorial: null,
};

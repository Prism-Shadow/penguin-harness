/** The Feishu (Lark) self-built app channel, as the binding editor shows it. */
import type {
  FeishuBindingInfo,
  FeishuBindingPutRequest,
  FeishuTestRequest,
} from "@prismshadow/penguin-server/api";
import * as api from "../../../../api/endpoints";
import { S } from "../../../../lib/strings";
import { plainTestOutcome, type MessagingChannelForm } from "../channel-form";
import { FeishuFields } from "./fields";
import {
  emptyFeishuFields,
  feishuDirty,
  feishuTestable,
  feishuToPut,
  feishuToTest,
  loadFeishuFields,
  type FeishuFormFields,
} from "./form";

export const feishuForm: MessagingChannelForm<
  FeishuFormFields,
  FeishuBindingInfo,
  FeishuBindingPutRequest,
  FeishuTestRequest
> = {
  empty: emptyFeishuFields,
  load: loadFeishuFields,
  toPut: feishuToPut,
  toTest: feishuToTest,
  dirty: feishuDirty,
  testable: feishuTestable,
  accountId: (info) => info.appId,
  secretMasked: (info) => info.appSecretMasked,
  put: (sessionId, body) => api.putFeishuBinding(sessionId, body),
  test: async (sessionId, body) => plainTestOutcome(await api.testFeishuBinding(sessionId, body)),
  enableFocus: "credential",
  credentialFields: (fields) => [
    ["app-id", fields.appId],
    ["app-secret", fields.appSecret],
  ],
  Fields: FeishuFields,
  copy: () => S.feishu,
  renderMarkdownHelp: () => S.messaging.renderMarkdownHelpFeishu,
  troubles: () => [],
  // Feishu's own echo-bot walkthrough: creating a self-built app and its long connection.
  tutorial: "https://open.feishu.cn/document/develop-an-echo-bot/introduction",
};

/**
 * The messaging mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { MessagingBindingRow } from "../db/repos/messaging-bindings.js";

/** MessagingBindings: the mechanism MessagingBindingsRepo implements. */
export abstract class MessagingBindings extends Interface<{
  find(sessionId: string, channel: string): MessagingBindingRow | null;
  findEnabled(sessionId: string): MessagingBindingRow | null;
  listForSession(sessionId: string): MessagingBindingRow[];
  findEnabledByAccount(channel: string, accountId: string): MessagingBindingRow | null;
  listAll(): MessagingBindingRow[];
  upsert(args: {
    sessionId: string;
    channel: string;
    accountId: string;
    config: Record<string, unknown>;
    linePerMessage?: boolean;
    finalReplyOnly?: boolean;
    renderMarkdown?: boolean;
  }): MessagingBindingRow;
  setEnabled(sessionId: string, channel: string, enabled: boolean): void;
  recordChat(sessionId: string, channel: string, chatId: string, isDirect: boolean): void;
  recordInboundWatermark(sessionId: string, channel: string, messageId: string | null): void;
  delete(sessionId: string, channel: string): void;
  deleteSession(sessionId: string): void;
}>() {}

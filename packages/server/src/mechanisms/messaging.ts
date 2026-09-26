/**
 * The messaging mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { MessagingBindingRow } from "../db/repos/messaging-bindings.js";

/** MessagingBindings: the mechanism MessagingBindingsRepo implements. */
@Interface()
export abstract class MessagingBindings {
  abstract find(sessionId: string, channel: string): MessagingBindingRow | null;
  abstract findEnabled(sessionId: string): MessagingBindingRow | null;
  abstract listForSession(sessionId: string): MessagingBindingRow[];
  abstract findEnabledByAccount(channel: string, accountId: string): MessagingBindingRow | null;
  abstract listAll(): MessagingBindingRow[];
  abstract upsert(args: {
    sessionId: string;
    channel: string;
    accountId: string;
    config: Record<string, unknown>;
    linePerMessage?: boolean;
    finalReplyOnly?: boolean;
    renderMarkdown?: boolean;
  }): MessagingBindingRow;
  abstract setEnabled(sessionId: string, channel: string, enabled: boolean): void;
  abstract recordChat(sessionId: string, channel: string, chatId: string, isDirect: boolean): void;
  abstract recordInboundWatermark(
    sessionId: string,
    channel: string,
    messageId: string | null,
  ): void;
  abstract delete(sessionId: string, channel: string): void;
  abstract deleteSession(sessionId: string): void;
}

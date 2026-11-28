/**
 * WeChat's credential section: the scan block, the stored-token row, and the direct-chats rule.
 * There is nothing to type on this channel, so the QR is not the easy path but the only one.
 */
import { S } from "@prismshadow/penguin-web/internal";
import { WeChatScanConnect } from "../../wechat-scan-connect";
import type { ChannelFieldsProps } from "../channel-form";
import { StoredSecretRow } from "../fields-kit";
import type { WeChatFormFields } from "./form";

export function WeChatFields({
  sessionId,
  fields,
  patch,
  facts,
  readOnly,
  scanId,
  onBound,
}: ChannelFieldsProps<WeChatFormFields>) {
  return (
    <>
      <div id={scanId}>
        <fieldset disabled={readOnly} className="min-w-0">
          <WeChatScanConnect
            sessionId={sessionId}
            enabled={facts.enabled}
            bound={facts.secretConfigured}
            onBound={(binding) => onBound(binding)}
          />
        </fieldset>
      </div>
      {facts.secretMasked !== null && (
        <StoredSecretRow
          masked={facts.secretMasked}
          clearLabel={S.wechat.clearToken}
          checked={fields.clearToken}
          enabled={facts.enabled}
          readOnly={readOnly}
          onChange={(checked) => patch({ clearToken: checked })}
        />
      )}
      {/* This channel's rule that cannot wait for a collapsed fold: it carries direct chats
          only, so a user who binds it and then writes in a group sees nothing arrive and
          concludes the binding is broken. */}
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.wechat.directOnly}</p>
    </>
  );
}

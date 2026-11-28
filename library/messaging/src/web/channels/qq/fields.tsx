/**
 * QQ's credential section: the scan block first, the typed App ID and App Secret below it as
 * the fallback for a bot the scan cannot reach, and the replies-only rule under them.
 */
import { Input, PasswordInput } from "@prismshadow/penguin-ui";
import { S } from "@prismshadow/penguin-web/internal";
import { QQScanConnect } from "../../qq-scan-connect";
import type { ChannelFieldsProps } from "../channel-form";
import { CornerLinkedField, ExternalLink, StoredSecretRow, errorText } from "../fields-kit";
import type { QQFormFields } from "./form";

/**
 * Where the credential is issued. The trailing slash is load-bearing and must not be tidied
 * away: /qqbot/dashboard answers 404, while /qqbot/ alone serves a 700-byte shell that only
 * lands anywhere because the retired hash-route app still redirects out of it.
 */
const CREDENTIAL_SOURCE = "https://q.qq.com/qqbot/dashboard/";

export function QQFields({
  sessionId,
  fields,
  patch,
  facts,
  errors,
  readOnly,
  scanId,
  onBound,
}: ChannelFieldsProps<QQFormFields>) {
  return (
    <>
      {/* The easy path leads: scanning is what most people will do, and the fields below
          are the fallback for a bot the scan cannot reach. Both are inside this channel's
          section, so nothing above the fields moves when the QR opens. */}
      <div id={scanId}>
        {/* A disabled fieldset takes every control of the scan with it: a scan starts a
            login on the machine, which cannot be asked. */}
        <fieldset disabled={readOnly} className="min-w-0">
          <QQScanConnect
            sessionId={sessionId}
            enabled={facts.enabled}
            onBound={(binding) => onBound(binding)}
          />
        </fieldset>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{S.qq.scanOrManual}</p>
      <CornerLinkedField
        label={S.qq.appId}
        required
        link={<ExternalLink href={CREDENTIAL_SOURCE} label={S.messaging.console} />}
      >
        <Input
          size="sm"
          disabled={readOnly}
          aria-label={S.qq.appId}
          error={errorText(errors.appId)}
          value={fields.appId}
          onChange={(e) => patch({ appId: e.target.value })}
          className="font-mono"
          placeholder="102000000"
          autoComplete="off"
        />
      </CornerLinkedField>
      <PasswordInput
        size="sm"
        disabled={readOnly}
        label={S.qq.appSecret}
        {...(facts.secretConfigured ? { placeholder: S.qq.appSecretKeepHint } : { required: true })}
        error={errorText(errors.appSecret)}
        value={fields.appSecret}
        onChange={(e) => patch({ appSecret: e.target.value, clearSecret: false })}
        autoComplete="off"
      />
      {facts.secretMasked !== null && fields.appSecret === "" && (
        <StoredSecretRow
          masked={facts.secretMasked}
          clearLabel={S.qq.clearSecret}
          checked={fields.clearSecret}
          enabled={facts.enabled}
          readOnly={readOnly}
          onChange={(checked) => patch({ clearSecret: checked })}
        />
      )}
      {/* The one channel whose rule cannot wait for a collapsed fold: QQ delivers only
          replies to messages sent from QQ, so a user who binds it and then types in the
          web app sees nothing arrive and concludes the binding is broken. It sits under
          this channel's fields rather than above them, which keeps the controls at the
          same height across channels. */}
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.qq.repliesOnly}</p>
    </>
  );
}

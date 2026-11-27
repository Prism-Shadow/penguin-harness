/** Feishu's credential section: App ID (console link at its corner), App Secret, API domain. */
import { Input, PasswordInput } from "@prismshadow/penguin-ui";
import { S } from "../../../../lib/strings";
import type { ChannelFieldsProps } from "../channel-form";
import { CornerLinkedField, ExternalLink, StoredSecretRow, errorText } from "../fields-kit";
import type { FeishuFormFields } from "./form";

/** Where the credential is issued: the developer console's app list. */
const CREDENTIAL_SOURCE = "https://open.feishu.cn/app";

export function FeishuFields({
  fields,
  patch,
  facts,
  errors,
  readOnly,
  fieldId,
}: ChannelFieldsProps<FeishuFormFields>) {
  return (
    <>
      <CornerLinkedField
        label={S.feishu.appId}
        required
        link={<ExternalLink href={CREDENTIAL_SOURCE} label={S.messaging.console} />}
      >
        <Input
          size="sm"
          id={fieldId("app-id")}
          disabled={readOnly}
          aria-label={S.feishu.appId}
          error={errorText(errors.appId)}
          value={fields.appId}
          onChange={(e) => patch({ appId: e.target.value })}
          className="font-mono"
          placeholder="cli_xxxxxxxxxxxxxxxx"
          autoComplete="off"
        />
      </CornerLinkedField>
      <PasswordInput
        size="sm"
        id={fieldId("app-secret")}
        disabled={readOnly}
        label={S.feishu.appSecret}
        {...(facts.secretConfigured
          ? { placeholder: S.feishu.appSecretKeepHint }
          : { required: true })}
        error={errorText(errors.appSecret)}
        value={fields.appSecret}
        onChange={(e) => patch({ appSecret: e.target.value, clearSecret: false })}
        autoComplete="off"
      />
      {facts.secretMasked !== null && fields.appSecret === "" && (
        <StoredSecretRow
          masked={facts.secretMasked}
          clearLabel={S.feishu.clearSecret}
          checked={fields.clearSecret}
          enabled={facts.enabled}
          readOnly={readOnly}
          onChange={(checked) => patch({ clearSecret: checked })}
        />
      )}
      <Input
        size="sm"
        disabled={readOnly}
        label={S.feishu.baseDomain}
        hint={S.feishu.baseDomainHint}
        error={errorText(errors.baseDomain)}
        value={fields.baseDomain}
        onChange={(e) => patch({ baseDomain: e.target.value })}
        className="font-mono"
        placeholder="https://open.feishu.cn"
        autoComplete="off"
      />
    </>
  );
}

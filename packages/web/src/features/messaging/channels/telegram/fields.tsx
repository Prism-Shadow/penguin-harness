/** Telegram's credential section: the Bot Token, with @BotFather at its corner. */
import { PasswordInput } from "@prismshadow/penguin-ui";
import { S } from "../../../../lib/strings";
import type { ChannelFieldsProps } from "../channel-form";
import { CornerLinkedField, ExternalLink, StoredSecretRow, errorText } from "../fields-kit";
import type { TelegramFormFields } from "./form";

/**
 * Where the credential is actually issued. Telegram has no web console: the token comes from
 * @BotFather inside the app, and this link is the one that leads there.
 */
const CREDENTIAL_SOURCE = "https://t.me/BotFather";

export function TelegramFields({
  fields,
  patch,
  facts,
  errors,
  readOnly,
  fieldId,
}: ChannelFieldsProps<TelegramFormFields>) {
  return (
    <>
      <CornerLinkedField
        label={S.telegram.botToken}
        required={!facts.secretConfigured}
        // Not the shared "developer console" label: this one opens @BotFather in the
        // Telegram app, and a corner link promising a console that does not exist sends
        // the reader looking for a web page Telegram has never had. The label names the
        // thing the click actually reaches — Telegram's own page for it is titled
        // "Launch @BotFather".
        link={<ExternalLink href={CREDENTIAL_SOURCE} label={S.telegram.openBotFather} />}
      >
        <PasswordInput
          size="sm"
          id={fieldId("bot-token")}
          disabled={readOnly}
          aria-label={S.telegram.botToken}
          {...(facts.secretConfigured ? { placeholder: S.telegram.botTokenKeepHint } : {})}
          error={errorText(errors.botToken)}
          value={fields.botToken}
          onChange={(e) => patch({ botToken: e.target.value, clearToken: false })}
          autoComplete="off"
        />
      </CornerLinkedField>
      {facts.secretMasked !== null && fields.botToken === "" && (
        <StoredSecretRow
          masked={facts.secretMasked}
          clearLabel={S.telegram.clearToken}
          checked={fields.clearToken}
          enabled={facts.enabled}
          readOnly={readOnly}
          onChange={(checked) => patch({ clearToken: checked })}
        />
      )}
    </>
  );
}

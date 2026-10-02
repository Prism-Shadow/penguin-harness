/**
 * A settings entry's head: its title, its store name, its description, the actions it offers
 * (what the deployment must do once on the machine, as buttons beside what each will do) and
 * its live notices — a spinner for work in progress, a strip for what needs attention, quiet
 * text for the rest.
 */
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import { Button, NoticeStrip, Spinner } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Locale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";

export function ConfigHeading({
  entry,
  nested,
  disabled,
  onAction,
  locale,
}: {
  entry: PluginConfigEntry;
  /** Drawn inside another entry's card (a sandbox backend's group): a step smaller. */
  nested: boolean;
  disabled: boolean;
  onAction: (action: string) => void;
  locale: Locale;
}) {
  const localized = (en: string | undefined, zh: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zh);
  const description = localized(entry.configuration.description, entry.configuration.descriptionZh);
  return (
    <div className="space-y-1.5">
      <div>
        <p className={nested ? "text-xs font-semibold" : "text-sm font-semibold"}>
          {localized(entry.configuration.title, entry.configuration.titleZh) ?? entry.name}
        </p>
        <p className="font-mono text-xs text-fg-muted">{entry.name}</p>
        {description !== undefined && (
          <p className="mt-1 text-xs text-fg-muted">{description}</p>
        )}
      </div>
      {(entry.actions ?? []).length > 0 && (
        <div className="space-y-2">
          {(entry.actions ?? []).map((action) => {
            const description = localized(action.description, action.descriptionZh);
            return (
              <div key={action.id} className="flex items-start gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onAction(action.id)}
                >
                  {localized(action.title, action.titleZh) ?? action.title}
                </Button>
                {description !== undefined && (
                  <p className="text-xs text-fg-muted">{description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(entry.notices ?? []).map((notice, i) =>
        notice.tone === "progress" ? (
          <p key={i} className={`flex items-center gap-2 text-xs ${toneInk.busy}`}>
            <Spinner size="sm" label={S.common.loading} />
            <span className="min-w-0 break-words">{localized(notice.text, notice.textZh)}</span>
          </p>
        ) : notice.tone === "attention" ? (
          <NoticeStrip tone="attention" as="p" key={i} className="rounded-md px-3 py-2 text-xs">
            {localized(notice.text, notice.textZh)}
          </NoticeStrip>
        ) : (
          <p key={i} className="text-xs text-fg-muted">
            {localized(notice.text, notice.textZh)}
          </p>
        ),
      )}
    </div>
  );
}

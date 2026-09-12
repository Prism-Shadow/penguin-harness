/**
 * General page of System settings: per-account preferences that are neither appearance nor
 * credentials. Everything applies the moment it is touched — the stores persist each value
 * (language, currency and task-completion notifications per browser) — so the page carries
 * no Save button and no draft state to lose.
 *
 * The notification row is the one that reaches outside the app: turning it on asks the
 * platform for permission then and there (lib/notification-pref explains why the prompt
 * hangs off this switch rather than off a page load), so it settles on whatever that
 * request answered rather than on what was clicked.
 */
import { useState, useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { Switch } from "../../components/ui/switch";
import {
  enableNotifications,
  notificationHintFor,
  notificationPermission,
  notificationsEnabledVersion,
  readNotificationsEnabled,
  subscribeNotificationsEnabled,
  writeNotificationsEnabled,
} from "../../lib/notification-pref";
import type { NotificationAccess } from "../../lib/notification-pref";
import { useLocale } from "../../state/locale";
import type { LangPref } from "../../state/locale";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { PrefRow } from "./setting-row";
import { TraceImportRow } from "./trace-import-row";

export function GeneralSection() {
  const { lang, setLang } = useLocale();
  const { currency, setCurrency } = useTheme();

  useSyncExternalStore(subscribeNotificationsEnabled, notificationsEnabledVersion);
  const notificationsOn = readNotificationsEnabled();
  // What the platform last answered: its own state, because a refusal has to stay on screen
  // as a hint after the click that produced it. `asked` goes with it, so a prompt closed
  // without an answer is told apart from a browser that was simply never asked.
  const [access, setAccess] = useState<NotificationAccess>(notificationPermission);
  const [asked, setAsked] = useState(false);

  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];
  const currencyOptions: ReadonlyArray<{ value: Currency; label: string }> = [
    { value: "USD", label: S.models.currencyUsd },
    { value: "CNY", label: S.models.currencyCny },
  ];

  const hint = notificationHintFor(access, asked);
  const notificationHint =
    hint === "unsupported"
      ? S.settings.notificationsUnsupported
      : hint === "denied"
        ? S.settings.notificationsDenied
        : hint === "dismissed"
          ? S.settings.notificationsDismissed
          : undefined;

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.language} info={S.settings.languageInfo}>
        <Segmented options={langOptions} value={lang} onChange={setLang} />
      </PrefRow>
      <PrefRow label={S.models.currency} info={S.settings.currencyInfo}>
        <Segmented options={currencyOptions} value={currency} onChange={setCurrency} cols={2} />
      </PrefRow>
      <PrefRow
        label={S.settings.notifications}
        hint={notificationHint}
        info={S.settings.notificationsInfo}
      >
        <Switch
          checked={notificationsOn}
          disabled={access === "unsupported"}
          onChange={(on) => {
            if (!on) {
              writeNotificationsEnabled(false);
              return;
            }
            // Only a granted request stores the preference, so anything else leaves the
            // switch where it was and turns the hint on instead.
            void enableNotifications().then((answer) => {
              setAccess(answer);
              setAsked(true);
            });
          }}
        />
      </PrefRow>
      <TraceImportRow />
    </div>
  );
}

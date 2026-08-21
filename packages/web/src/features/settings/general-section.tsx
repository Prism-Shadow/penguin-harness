/**
 * General page of System settings: per-account preferences that are neither appearance nor
 * credentials. Everything applies the moment it is touched — the stores persist each value
 * (language and currency per browser, the CLI-sessions filter per user via PUT /me/prefs)
 * — so the page carries no Save button and no draft state to lose.
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { Switch } from "../../components/ui/switch";
import { useLocale } from "../../state/locale";
import type { LangPref } from "../../state/locale";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { useSessions } from "../../state/sessions";
import { PrefRow } from "./setting-row";

export function GeneralSection() {
  const { lang, setLang } = useLocale();
  const { currency, setCurrency } = useTheme();
  const { showCliSessions, setShowCliSessions } = useSessions();

  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];
  const currencyOptions: ReadonlyArray<{ value: Currency; label: string }> = [
    { value: "USD", label: S.models.currencyUsd },
    { value: "CNY", label: S.models.currencyCny },
  ];

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.language} hint={S.settings.languageHint}>
        <Segmented options={langOptions} value={lang} onChange={setLang} />
      </PrefRow>
      <PrefRow label={S.models.currency} hint={S.settings.currencyHint}>
        <Segmented options={currencyOptions} value={currency} onChange={setCurrency} cols={2} />
      </PrefRow>
      {/* Flipping this refetches the whole conversation list under the new filter, so the
          sidebar behind the dialog updates without a reload. */}
      <PrefRow label={S.settings.showCliSessions} hint={S.settings.showCliSessionsHint}>
        <Switch checked={showCliSessions} onChange={setShowCliSessions} />
      </PrefRow>
    </div>
  );
}

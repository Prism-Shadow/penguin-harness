/**
 * General page of System settings: per-account preferences that are neither appearance nor
 * credentials. Everything applies the moment it is touched — the stores persist each value
 * (language and currency per browser) — so the page carries no Save button and no draft
 * state to lose.
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
import { useLocale } from "../../state/locale";
import type { LangPref } from "../../state/locale";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { PrefRow } from "./setting-row";
import { TraceImportRow } from "./trace-import-row";

export function GeneralSection() {
  const { lang, setLang } = useLocale();
  const { currency, setCurrency } = useTheme();

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
      <PrefRow label={S.settings.language} info={S.settings.languageInfo}>
        <Segmented options={langOptions} value={lang} onChange={setLang} />
      </PrefRow>
      <PrefRow label={S.models.currency} info={S.settings.currencyInfo}>
        <Segmented options={currencyOptions} value={currency} onChange={setCurrency} cols={2} />
      </PrefRow>
      <TraceImportRow />
    </div>
  );
}

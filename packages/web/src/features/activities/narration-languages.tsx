/**
 * One narration across every language, so a line can be checked in all of them at once:
 * script, whether it still needs translating, and whether it is spoken yet, with a way to
 * open that language. Shown only when the activity has more than one.
 */
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

export function NarrationLanguages({
  manifest,
  assetKey,
  language,
  defaultLanguage,
  onLanguage,
}: {
  manifest: AssetManifest;
  assetKey: string;
  /** The language open in the editor. */
  language: string;
  defaultLanguage: string;
  onLanguage: (language: string) => void;
}) {
  const words = S.activities.narrationLanguages;
  const languages = Object.keys(manifest.assets).sort((a, b) =>
    a === defaultLanguage ? -1 : b === defaultLanguage ? 1 : a.localeCompare(b),
  );
  if (languages.length < 2) return null;
  const source = manifest.assets[defaultLanguage]?.find((entry) => entry.key === assetKey)?.script;
  return (
    <section aria-label={words.title} className="space-y-1">
      <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400">{words.title}</h4>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
        {languages.map((code) => {
          const entry = manifest.assets[code]?.find((item) => item.key === assetKey);
          const untranslated = code !== defaultLanguage && !entry?.script?.trim();
          const outdated =
            code !== defaultLanguage &&
            entry?.translatedFrom !== undefined &&
            entry.translatedFrom !== source;
          const open = code === language;
          return (
            <li key={code} className="flex items-start gap-3 px-3 py-2 text-xs">
              <span className="w-12 shrink-0 font-medium tabular-nums">{code}</span>
              <span className="min-w-0 flex-1">
                {entry ? (
                  untranslated ? (
                    <span className={toneInk.attention}>
                      {S.activities.speechTranslation.missing}
                    </span>
                  ) : (
                    <span className="line-clamp-2 text-gray-700 dark:text-gray-300">
                      {entry.script}
                    </span>
                  )
                ) : (
                  <span className="text-gray-500">{words.absent}</span>
                )}
                {outdated && (
                  <span className={`block ${toneInk.attention}`}>
                    {S.activities.speechTranslation.outdated}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-gray-500">
                {entry?.path ? words.spoken : entry ? words.unspoken : ""}
              </span>
              {entry && !open && (
                <button
                  type="button"
                  onClick={() => onLanguage(code)}
                  className="shrink-0 text-brand-700 hover:underline dark:text-brand-300"
                >
                  {words.open}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

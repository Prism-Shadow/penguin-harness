/**
 * Language menu: 中文 / English / follow system, persisted via the locale context.
 * A small dropdown (globe + current label); closes on outside click or selection.
 * Scroll position across the locale remount is preserved by LocaleScope.
 */
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../state/locale";
import type { LangPref } from "../state/locale";
import { S } from "../lib/strings";
import { CheckIcon, ChevronDownIcon, GlobeIcon } from "./icons";

export function LangToggle() {
  const { lang, setLang } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const OPTIONS: Array<{ value: LangPref; label: string }> = [
    { value: "en", label: S.lang.en },
    { value: "zh", label: S.lang.zh },
    { value: "system", label: S.lang.system },
  ];
  const current = OPTIONS.find((o) => o.value === lang) ?? OPTIONS[2]!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={S.lang.label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-100"
      >
        <GlobeIcon className="h-[18px] w-[18px]" />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="anim-fade absolute right-0 z-40 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={lang === o.value}
              onClick={() => {
                setLang(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {o.label}
              {lang === o.value && (
                <CheckIcon className="h-3.5 w-3.5 text-brand-600 dark:text-brand-300" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

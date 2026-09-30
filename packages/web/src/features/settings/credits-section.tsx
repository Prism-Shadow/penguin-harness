/**
 * Credits page: the fonts the app bundles, which themes set them, and the licence each ships
 * under, with the licence's full text one click away. The list comes from the UI package's font
 * metadata (the same record its licence files and build scripts are checked against), so a face
 * added or dropped there appears or disappears here without an edit.
 *
 * MiSans's licence asks software that uses the face to credit it, and this page is where the
 * app does: the face is listed with its licence for every account and every backend, which is
 * why the page itself is visible to everyone, the desktop shell's window included. The page is
 * the list and nothing else; the rail already names it.
 *
 * Each licence text is a disclosure (the WAI-ARIA pattern: a real button with `aria-expanded`
 * and `aria-controls`, the panel kept in the DOM and `hidden` while folded). A licence runs to
 * pages, so the open panel scrolls inside a capped height rather than pushing the next font a
 * screen away.
 */
import { useId, useState } from "react";
import { FONT_CREDITS } from "@prismshadow/penguin-ui/fonts-credits";
import type { FontCredit } from "@prismshadow/penguin-ui/fonts-credits";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { ICON_GAP } from "../../lib/icon-scale";
import { Chevron } from "../../components/ui/chevron";

/** A theme id in the reader's words. */
function themeName(id: ThemeId): string {
  return S.settings.themeNames[id];
}

function LicenseText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center ${ICON_GAP.row} text-xs text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200`}
      >
        <Chevron open={open} size={12} />
        {S.settings.creditsLicenseText}
      </button>
      <pre
        id={panelId}
        hidden={!open}
        className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-600 dark:bg-gray-900 dark:text-gray-300"
      >
        {text}
      </pre>
    </div>
  );
}

function CreditRow({ font }: { font: FontCredit }) {
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <p className="text-sm font-medium">{font.family}</p>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500 dark:text-gray-400">{S.settings.creditsThemes}</dt>
        {/* A face no theme sets by default (IBM Plex Sans Condensed) still ships, so it is
            listed and licensed like the rest, and says so rather than leaving the line blank. */}
        <dd>
          {font.themes.length > 0
            ? font.themes.map(themeName).join(" · ")
            : S.settings.creditsNoTheme}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">{S.settings.creditsLicense}</dt>
        <dd>{font.licenseTitle}</dd>
        <dt className="text-gray-500 dark:text-gray-400">{S.settings.creditsSource}</dt>
        <dd className="min-w-0 break-all">
          <a
            href={font.source}
            target="_blank"
            rel="noreferrer"
            className="text-link underline-offset-2 hover:underline"
          >
            {font.source}
          </a>
        </dd>
      </dl>
      <LicenseText text={font.licenseText} />
    </li>
  );
}

export function CreditsSection() {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800/60">
      {FONT_CREDITS.map((font) => (
        <CreditRow key={font.id} font={font} />
      ))}
    </ul>
  );
}

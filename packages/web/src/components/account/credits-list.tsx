/**
 * Credit lists: the fonts the app bundles and the icon families its icons are drawn from, which
 * themes use each, and the licence each ships under, with the licence's full text one click away.
 * The lists come from the UI package's credits (the same records its licence files are checked
 * against), so a face or an icon family added or dropped there appears or disappears here without
 * an edit.
 *
 * MiSans's licence asks software that uses the face to credit it, and this is where the app
 * does: the face is listed with its licence for every account and every backend, inside the App
 * info dialog's credits section, which the account menu offers to everyone, the desktop shell's
 * window included. The lists and nothing else; the section around them already names them.
 *
 * Each licence text is a disclosure (the WAI-ARIA pattern: a real button with `aria-expanded`
 * and `aria-controls`, the panel kept in the DOM and `hidden` while folded). A licence runs to
 * pages, so the open panel scrolls inside a capped height rather than pushing the next font a
 * screen away.
 */
import { useId, useState } from "react";
import { FONT_CREDITS, ICON_CREDITS } from "@prismshadow/penguin-ui/fonts-credits";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { Chevron, ICON_GAP, Text } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

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
        {S.appInfo.creditsLicenseText}
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

/** One credited font or icon family, in the shape both credit lists share. */
interface Credit {
  readonly name: string;
  readonly themes: readonly ThemeId[];
  readonly source: string;
  readonly licenseTitle: string;
  readonly licenseText: string;
}

function CreditRow({ font }: { font: Credit }) {
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <p className="text-sm font-medium">{font.name}</p>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500 dark:text-gray-400">{S.appInfo.creditsThemes}</dt>
        {/* A face no theme sets by default (IBM Plex Sans Condensed) still ships, so it is
            listed and licensed like the rest, and says so rather than leaving the line blank. */}
        <dd>
          {font.themes.length > 0
            ? font.themes.map(themeName).join(" · ")
            : S.appInfo.creditsNoTheme}
        </dd>
        <dt className="text-gray-500 dark:text-gray-400">{S.appInfo.creditsLicense}</dt>
        <dd>{font.licenseTitle}</dd>
        <dt className="text-gray-500 dark:text-gray-400">{S.appInfo.creditsSource}</dt>
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

function CreditList({ label, credits }: { label: string; credits: readonly Credit[] }) {
  return (
    <section>
      <Text variant="eyebrow" className="mb-2">
        {label}
      </Text>
      <ul className="divide-y divide-line-muted">
        {credits.map((credit) => (
          <CreditRow key={credit.name} font={credit} />
        ))}
      </ul>
    </section>
  );
}

export function CreditsList() {
  return (
    <div className="space-y-6">
      <CreditList
        label={S.appInfo.creditsFonts}
        credits={FONT_CREDITS.map((font) => ({ ...font, name: font.family }))}
      />
      <CreditList label={S.appInfo.creditsIcons} credits={ICON_CREDITS} />
    </div>
  );
}

/**
 * The banner above every group on the models page: TokenDance's own connect flow, offered as the
 * way to skip setting model keys by hand. The page shows it to the owner while the TokenDance
 * group has models and no stored key; once dismissed it stays hidden in this browser.
 *
 * Its slow highlight sweep is the one decoration on the page, asked for by name, and it crosses
 * the brand name only; the rest of the banner stands still. It is CSS only (`.banner-shimmer`
 * in styles.css), and the word's resting state is plain ink, so the global reduced-motion rule
 * leaves it plain.
 */
import { useState } from "react";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { Button, CloseButton, ICON_GAP, ProviderLogo } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** The group the banner connects: it is TokenDance's by name, so it names the group too. */
export const TOKENDANCE_PROVIDER_ID = "tokendance";

/**
 * The banner's sentence split around the brand name, so the sweep can ride that word alone;
 * null when a wording does not carry the name, which then shows plain.
 */
export function splitBrand(text: string, brand: string): [before: string, after: string] | null {
  const at = brand === "" ? -1 : text.indexOf(brand);
  return at === -1 ? null : [text.slice(0, at), text.slice(at + brand.length)];
}

/** The localStorage key remembering the dismissal: a display preference of this browser. */
export const TOKENDANCE_BANNER_DISMISSED_KEY = "penguin.tokenDanceBannerDismissed";

/** Minimal storage surface; tests inject an in-memory one. */
export interface BannerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage that is missing or refuses to answer reads as "not dismissed": the banner shows. */
export function bannerDismissed(storage?: BannerStorage): boolean {
  try {
    return (storage ?? localStorage).getItem(TOKENDANCE_BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(TOKENDANCE_BANNER_DISMISSED_KEY, "1");
  } catch {
    // The banner still goes away for this page view; only the memory of it is lost.
  }
}

export function TokenDanceBanner({ onConnect }: { onConnect: () => void }) {
  const [dismissed, setDismissed] = useState(() => bannerDismissed());
  if (dismissed) return null;
  const brand = providerInfo(TOKENDANCE_PROVIDER_ID)?.label ?? "TokenDance";
  const parts = splitBrand(S.models.tokenDanceBanner, brand);
  return (
    <div
      className={`mb-3 flex items-center ${ICON_GAP.card} rounded-md border border-gray-200 bg-gray-100 py-2.5 pl-3.5 pr-2 dark:border-gray-800 dark:bg-gray-900`}
    >
      <ProviderLogo
        provider="tokendance"
        className="h-6 w-6 shrink-0 text-gray-900 dark:text-gray-100"
      />
      <p className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">
        {parts === null ? (
          S.models.tokenDanceBanner
        ) : (
          <>
            {parts[0]}
            <span className="banner-shimmer">{brand}</span>
            {parts[1]}
          </>
        )}
      </p>
      <Button size="sm" variant="primary" className="shrink-0" onClick={onConnect}>
        {S.models.oauthKey}
      </Button>
      <CloseButton
        className="shrink-0"
        onClose={() => {
          rememberDismissal();
          setDismissed(true);
        }}
      />
    </div>
  );
}

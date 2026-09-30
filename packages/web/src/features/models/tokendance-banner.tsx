/**
 * The banner above every group on the models page: TokenDance's own connect flow, offered as the
 * way to skip setting model keys by hand. The page shows it to the owner while the TokenDance
 * group has models and no stored key; once dismissed it stays hidden in this browser.
 *
 * Its slow highlight sweep is the one decoration on the page, asked for by name. It is CSS only
 * (`.banner-shimmer` in styles.css), `transform`-driven from a resting place outside the banner,
 * so the global reduced-motion rule leaves the banner plain.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { ICON_GAP } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import { CloseButton } from "../../components/ui/icons";
import { ProviderLogo } from "../../components/ui/provider-logo";

/** The group the banner connects: it is TokenDance's by name, so it names the group too. */
export const TOKENDANCE_PROVIDER_ID = "tokendance";

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
  return (
    <div
      className={`banner-shimmer relative mb-3 flex items-center ${ICON_GAP.card} overflow-hidden rounded-md border border-gray-200 bg-gray-100 py-2.5 pl-3.5 pr-2 dark:border-gray-800 dark:bg-gray-900`}
    >
      <ProviderLogo
        provider="tokendance"
        className="h-6 w-6 shrink-0 text-gray-900 dark:text-gray-100"
      />
      <p className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">
        {S.models.tokenDanceBanner}
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

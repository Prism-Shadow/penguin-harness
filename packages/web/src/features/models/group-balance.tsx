/**
 * A group's balance where it is shown: in its header on the models page — muted, after the pin
 * that puts it beside the user name and the refresh — and there, in the sidebar's user row.
 * Both read the one store in balance.ts, and both show the amount in the display currency the
 * cost center and the model prices use.
 *
 * The amount is plain text, and the refresh before it is a glyph: the shared tooltip only
 * speaks for an element with no words of its own (tooltip.tsx), so the glyph is what carries
 * the vendor's own figures and the read time — or, when no balance could be read, the reason.
 * A balance that cannot be read is a muted dash with that reason, never red text: it is
 * information about an account, not an error the user made on this page.
 */
import { useEffect } from "react";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { GlyphIcon, ICONS, ICON_SIZE, IconButton, ProviderLogo } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import { useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import {
  displayBalance,
  formatBalance,
  isPinned,
  requestBalance,
  setPinnedBalance,
  useBalance,
  usePinnedBalance,
} from "./balance";
import type { BalanceState } from "./balance";
import { HEADER_SQUARE, HEADER_TEXT } from "./group-header";

/** How often the pinned balance is read again while the app is open (plus once per page load). */
export const PINNED_BALANCE_REFRESH_MS = 5 * 60 * 1000;

/**
 * What a balance reads as: the text shown — the amount in the display currency — and the
 * sentence behind it (the refresh glyph's hint and the accessible name), which keeps the
 * vendor's own figures and the time they were read.
 */
export function balanceView(
  state: BalanceState | undefined,
  label: string,
  currency: Currency,
): { text: string; title: string } {
  const answer = state?.answer;
  if (answer === undefined) {
    if (state?.requestError !== undefined) return { text: "—", title: state.requestError };
    // Nothing read yet: a quiet placeholder, not a dash, which would claim a failure.
    return { text: "…", title: S.models.balanceTitle(label, "…", "…") };
  }
  if (answer.ok) {
    const title = S.models.balanceTitle(
      label,
      formatBalance(answer),
      formatDateTime(answer.fetchedAt),
    );
    return {
      text: displayBalance(answer, currency),
      title: answer.available === false ? `${title} · ${S.models.balanceUnavailable}` : title,
    };
  }
  const reason = S.models.balanceErrors[answer.error] ?? answer.message;
  return {
    text: "—",
    title:
      answer.status !== undefined ? `${reason}${S.models.balanceStatus(answer.status)}` : reason,
  };
}

/**
 * The pin before a balance, which keeps it beside the user name: the session list's group pin
 * glyph, drawn filled while on. The accessible name stays static and `aria-pressed` carries
 * the state, as that pin's does.
 */
function BalancePin({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <IconButton
      variant="ghost"
      className={HEADER_SQUARE}
      label={S.models.pinBalance}
      title={pinned ? S.models.unpinBalance : S.models.pinBalance}
      aria-pressed={pinned}
      onClick={onToggle}
    >
      <GlyphIcon d={ICONS.pin} size={ICON_SIZE.groupHeaderAction} filled={pinned} />
    </IconButton>
  );
}

/**
 * A group's balance in its header: the pin, the refresh, then the amount, in the header's one
 * box and gap (group-header.ts). Read once when the header mounts, again on every refresh
 * click, which skips the server's cache.
 */
export function GroupBalance({
  projectId,
  provider,
}: {
  projectId: string;
  provider: ModelProviderInfo;
}) {
  const state = useBalance(projectId, provider.id);
  const pinned = isPinned(usePinnedBalance(), projectId, provider.id);
  const { currency } = useTheme();
  useEffect(() => {
    void requestBalance(projectId, provider.id);
  }, [projectId, provider.id]);
  const { text, title } = balanceView(state, provider.label, currency);
  const hint = `${title} · ${S.models.balanceRefreshHint}`;
  return (
    <span className="flex shrink-0 items-center gap-2">
      <BalancePin
        pinned={pinned}
        onToggle={() => setPinnedBalance(pinned ? null : { projectId, provider: provider.id })}
      />
      <IconButton
        variant="ghost"
        className={HEADER_SQUARE}
        label={hint}
        onClick={() => void requestBalance(projectId, provider.id, true)}
      >
        <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.groupHeaderAction} />
      </IconButton>
      <span
        className={`${HEADER_TEXT} whitespace-nowrap tabular-nums text-gray-500 dark:text-gray-400${state?.loading === true && state.answer !== undefined ? " opacity-60" : ""}`}
      >
        {text}
      </span>
    </span>
  );
}

/**
 * The pinned balance as the sidebar shows it, or null when nothing is pinned or the pinned
 * Project is no longer one this user can open. Reads it when mounted — once per page load —
 * and every five minutes after that; never faster.
 */
export function usePinnedBalanceView(): { provider: string; text: string; title: string } | null {
  const pin = usePinnedBalance();
  const { projects } = useProject();
  const { currency } = useTheme();
  const reachable = pin !== null && projects.some((p) => p.projectId === pin.projectId);
  const projectId = reachable ? pin.projectId : null;
  const provider = pin?.provider ?? "";
  const state = useBalance(projectId, provider);
  useEffect(() => {
    if (projectId === null) return;
    void requestBalance(projectId, provider);
    const timer = window.setInterval(
      () => void requestBalance(projectId, provider),
      PINNED_BALANCE_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [projectId, provider]);
  if (projectId === null) return null;
  return { provider, ...balanceView(state, providerInfo(provider)?.label ?? provider, currency) };
}

/**
 * The pinned balance beside the user name: the group's logo and the amount, muted. It sits
 * inside the account menu's trigger, so it carries no hint of its own; the sentence behind it
 * is spoken with the trigger's name.
 */
export function PinnedBalanceBadge() {
  const view = usePinnedBalanceView();
  if (view === null) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
      <ProviderLogo provider={view.provider} className="h-3.5 w-3.5 shrink-0" />
      {view.text}
      <span className="sr-only"> · {view.title}</span>
    </span>
  );
}

/**
 * A group's balance where it is shown: in its header on the models page — muted, with a
 * refresh and the pin that puts it beside the user name — and there, in the sidebar's user row
 * and the collapsed rail's avatar tooltip. Both read the one store in balance.ts.
 *
 * The amount is plain text, and the refresh beside it is a glyph: the shared tooltip only
 * speaks for an element with no words of its own (tooltip.tsx), so the glyph is what carries
 * the read time — or, when no balance could be read, the reason. A balance that cannot be read
 * is a muted dash with that reason, never red text: it is information about an account, not
 * an error the user made on this page.
 */
import { useEffect } from "react";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useProject } from "../../state/project";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { REFRESH_ICON } from "../../components/ui/icons";
import { PIN_ICON } from "../../components/ui/session-row-menu";
import { ProviderLogo } from "../../components/ui/provider-logo";
import {
  formatBalance,
  isPinned,
  requestBalance,
  setPinnedBalance,
  useBalance,
  usePinnedBalance,
} from "./balance";
import type { BalanceState } from "./balance";

/** How often the pinned balance is read again while the app is open (plus once per page load). */
export const PINNED_BALANCE_REFRESH_MS = 5 * 60 * 1000;

/**
 * What a balance reads as: the text shown, the sentence behind it (the refresh glyph's hint and
 * the accessible name), and whether it is a failure — the dash, whose reason must be reachable
 * without first finding the glyph by hovering.
 */
export function balanceView(
  state: BalanceState | undefined,
  label: string,
): { text: string; title: string; failed: boolean } {
  const answer = state?.answer;
  if (answer === undefined) {
    if (state?.requestError !== undefined) {
      return { text: "—", title: state.requestError, failed: true };
    }
    // Nothing read yet: a quiet placeholder, not a dash, which would claim a failure.
    return { text: "…", title: S.models.balanceTitle(label, "…"), failed: false };
  }
  if (answer.ok) {
    const title = S.models.balanceTitle(label, formatDateTime(answer.fetchedAt));
    return {
      text: formatBalance(answer),
      title: answer.available === false ? `${title} · ${S.models.balanceUnavailable}` : title,
      failed: false,
    };
  }
  const reason = S.models.balanceErrors[answer.error] ?? answer.message;
  return {
    text: "—",
    title:
      answer.status !== undefined ? `${reason}${S.models.balanceStatus(answer.status)}` : reason,
    failed: true,
  };
}

/**
 * The pin beside a balance: the session list's group pin, glyph and behaviour — revealed on
 * header hover or keyboard focus while off, always visible once on. The accessible name stays
 * static and `aria-pressed` carries the state, as that pin's does.
 */
function BalancePin({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-tooltip={pinned ? S.models.unpinBalance : S.models.pinBalance}
      aria-label={S.models.pinBalance}
      aria-pressed={pinned}
      onClick={onToggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 hover:text-gray-800 dark:hover:text-gray-200 ${
        pinned
          ? "text-gray-500 dark:text-gray-400"
          : "text-gray-400 opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100 dark:text-gray-500"
      }`}
    >
      <GlyphIcon d={PIN_ICON} size={ICON_SIZE.groupHeaderAction} />
    </button>
  );
}

/**
 * A group's balance in its header: read once when the header mounts, again on every refresh.
 * The refresh glyph is revealed with the header, like the pin, except beside a dash, where it
 * stays in view because its hint is the only place the reason is shown. The pin comes first, so
 * a pinned balance keeps its pin against the amount and the hidden glyph's slot trails.
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
  useEffect(() => {
    void requestBalance(projectId, provider.id);
  }, [projectId, provider.id]);
  const { text, title, failed } = balanceView(state, provider.label);
  const hint = `${title} · ${S.models.balanceRefreshHint}`;
  return (
    <span className="flex shrink-0 items-center">
      <span
        className={`whitespace-nowrap pl-1 text-xs tabular-nums text-gray-500 dark:text-gray-400${state?.loading === true && state.answer !== undefined ? " opacity-60" : ""}`}
      >
        {text}
      </span>
      <BalancePin
        pinned={pinned}
        onToggle={() => setPinnedBalance(pinned ? null : { projectId, provider: provider.id })}
      />
      <button
        type="button"
        onClick={() => void requestBalance(projectId, provider.id, true)}
        data-tooltip={hint}
        aria-label={`${text} · ${hint}`}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200${
          failed ? "" : " opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100"
        }`}
      >
        <GlyphIcon d={REFRESH_ICON} size={ICON_SIZE.groupHeaderAction} />
      </button>
    </span>
  );
}

/**
 * The pinned balance as the sidebar and the rail show it, or null when nothing is pinned or the
 * pinned Project is no longer one this user can open. Reads it when mounted — once per page
 * load — and every five minutes after that; never faster.
 */
export function usePinnedBalanceView(): {
  provider: string;
  /** The group's display name. */
  label: string;
  text: string;
  title: string;
} | null {
  const pin = usePinnedBalance();
  const { projects } = useProject();
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
  const label = providerInfo(provider)?.label ?? provider;
  return { provider, label, ...balanceView(state, label) };
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

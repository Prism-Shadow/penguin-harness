/**
 * A group's balance where it is shown: in its header on the models page — one control, the
 * amount with a small chevron, opening a menu — and beside the user name in the sidebar's user
 * row. Both read the one store in balance.ts, and both show the amount in the display currency
 * the cost center and the model prices use.
 *
 * The header's menu is three short lines: pin the balance at the sidebar's bottom-left (beside
 * the user name), refresh it, and — not a row to choose — when it was read, or why the last read
 * failed. A balance that cannot be read is a muted dash, never red text: it is information about
 * an account, not an error the user made on this page.
 */
import { useEffect, useState } from "react";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { ChevronDown, Dropdown, Menu, MenuItem, ProviderLogo } from "@prismshadow/penguin-ui";
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
import { HEADER_TEXT } from "./group-header";

/** How often the pinned balance is read again while the app is open (plus once per page load). */
export const PINNED_BALANCE_REFRESH_MS = 5 * 60 * 1000;

/**
 * What a balance reads as: the text shown — the amount in the display currency — the sentence
 * spoken behind it (the vendor's own figures and the read time, or why there is no balance),
 * and the balance menu's last line: when it was read, or why the read failed.
 */
export function balanceView(
  state: BalanceState | undefined,
  label: string,
  currency: Currency,
): { text: string; title: string; updated: string } {
  const answer = state?.answer;
  if (answer === undefined) {
    if (state?.requestError !== undefined) {
      const failed = S.models.balanceFailed(state.requestError);
      return { text: "—", title: failed, updated: failed };
    }
    // Nothing read yet: a quiet placeholder, not a dash, which would claim a failure.
    return {
      text: "…",
      title: S.models.balanceTitle(label, "…", "…"),
      updated: S.models.balanceUpdatedAt("…"),
    };
  }
  if (answer.ok) {
    const time = formatDateTime(answer.fetchedAt);
    const title = S.models.balanceTitle(label, formatBalance(answer), time);
    return {
      text: displayBalance(answer, currency),
      title: answer.available === false ? `${title} · ${S.models.balanceUnavailable}` : title,
      updated: S.models.balanceUpdatedAt(time),
    };
  }
  const reason = S.models.balanceErrors[answer.error] ?? answer.message;
  const failed = S.models.balanceFailed(
    answer.status !== undefined ? `${reason}${S.models.balanceStatus(answer.status)}` : reason,
  );
  return { text: "—", title: failed, updated: failed };
}

/**
 * The balance menu's body, three lines: pin (or unpin) at the sidebar's bottom-left, refresh,
 * and when the balance was read (or why the read failed). The pin is per account, so a
 * member's menu holds it too. The last line sits outside the `menu` role: it is information,
 * not a row to choose.
 */
export function BalanceMenu({
  pinned,
  updated,
  onPin,
  onRefresh,
}: {
  pinned: boolean;
  /** When the balance was read, or why the read failed (balanceView's `updated`). */
  updated: string;
  onPin: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <Menu density="sm">
        <MenuItem label={pinned ? S.models.unpinBalance : S.models.pinBalance} onSelect={onPin} />
        <MenuItem label={S.models.balanceRefresh} onSelect={onRefresh} />
      </Menu>
      <p className="border-t border-line-muted px-3 py-1.5 text-xs text-fg-muted">{updated}</p>
    </>
  );
}

/**
 * A group's balance in its header: the amount and a chevron, opening the balance menu, in the
 * header's one box (group-header.ts). Read once when the header mounts, again from the menu's
 * refresh, which skips the server's cache.
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void requestBalance(projectId, provider.id);
  }, [projectId, provider.id]);
  const { text, title, updated } = balanceView(state, provider.label, currency);
  const refreshing = state?.loading === true && state.answer !== undefined;
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="flex shrink-0"
      menuClass="w-56 max-w-[calc(100vw-2rem)] origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`${HEADER_TEXT} gap-1 whitespace-nowrap rounded-control tabular-nums text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200${refreshing ? " opacity-60" : ""}`}
        >
          {text}
          <span className="sr-only"> · {title}</span>
          <ChevronDown size={10} />
        </button>
      }
    >
      <BalanceMenu
        pinned={pinned}
        updated={updated}
        onPin={() => {
          setOpen(false);
          setPinnedBalance(pinned ? null : { projectId, provider: provider.id });
        }}
        onRefresh={() => {
          setOpen(false);
          void requestBalance(projectId, provider.id, true);
        }}
      />
    </Dropdown>
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

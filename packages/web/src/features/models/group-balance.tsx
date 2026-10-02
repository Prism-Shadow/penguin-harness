/**
 * A group's balance where it is shown: in its header on the models page — one control, the
 * amount with a small chevron, opening a menu — and beside the user name in the sidebar's user
 * row. Both read the one store in balance.ts, and both show the amount in the display currency
 * the cost center and the model prices use.
 *
 * The header's menu holds what used to stand around the amount as two glyphs — the pin that
 * keeps the balance beside the user name, and the refresh — and, under them, a line that cannot
 * be clicked: the vendor's own figures and the read time, or, when no balance could be read, the
 * reason. A balance that cannot be read is a muted dash, never red text: it is information about
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
 * What a balance reads as: the text shown — the amount in the display currency — and the
 * sentence behind it (the menu's information line and the trigger's spoken tail), which keeps
 * the vendor's own figures and the time they were read.
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
 * The balance menu's body: pin (or unpin) beside the user name, re-read the balance, and the
 * line with what was read. The pin is per account, so a member's menu holds it too. The line
 * sits outside the `menu` role: it is information, not a row to choose.
 */
export function BalanceMenu({
  pinned,
  info,
  onPin,
  onRefresh,
}: {
  pinned: boolean;
  /** The vendor's figures and read time, or the reason there is no balance (balanceView's title). */
  info: string;
  onPin: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <Menu density="sm">
        <MenuItem label={pinned ? S.models.unpinBalance : S.models.pinBalance} onSelect={onPin} />
        <MenuItem label={S.models.balanceRefresh} onSelect={onRefresh} />
      </Menu>
      <p className="border-t border-line-muted px-3 py-1.5 text-xs text-fg-muted">{info}</p>
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
  const { text, title } = balanceView(state, provider.label, currency);
  const refreshing = state?.loading === true && state.answer !== undefined;
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="flex shrink-0"
      menuClass="w-64 max-w-[calc(100vw-2rem)] origin-top-right"
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
        info={title}
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

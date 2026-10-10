/**
 * The chat page's direct lookup of the routed Session: what opens a deep-linked conversation
 * without waiting for the sidebar's list, and what decides that a Session the list does not
 * hold is gone.
 *
 * The page drives it from one effect, which re-runs on every list change. Three things follow
 * from that, and this keeps all three out of the effect's closure:
 *
 * - One lookup per Session is in flight at a time. Re-issuing it on every re-run fired a dozen
 *   identical requests for one deep link.
 * - Whether the list is still loading is read when a lookup SETTLES, not when it left. A lookup
 *   that fails while the list's first load is still running decides nothing (a Session created
 *   a moment ago can be neither listed nor answered for yet): the slot is freed, and the page
 *   asks again once the list settles. But a lookup that left during that load and fails after
 *   it is a verdict; read from the closure that sent it, it was taken for a mid-load failure,
 *   and since nothing re-runs the effect for it, a deep link to a deleted Session stayed on the
 *   skeleton.
 * - An answer about a Session the page has since left is dropped.
 */
export interface RouteProbeHandlers<T> {
  /** The lookup found the routed Session. */
  found(row: T): void;
  /** The lookup settled it after the list had: the Session is not there. */
  gone(): void;
}

export class RouteProbe {
  private inFlight: string | null = null;
  private routed: string | null = null;
  private listLoading = true;

  /**
   * What the page shows now: the routed Session's probe key (null on none) and whether the
   * Session list is still loading. Called on every run of the page's effect, before anything
   * else, so a lookup settling later reads the page as it is then.
   */
  track(routeKey: string | null, listLoading: boolean): void {
    this.routed = routeKey;
    this.listLoading = listLoading;
  }

  /**
   * Look up the Session `key` names, unless a lookup for it is already in flight. `lookup`
   * resolves to the row, or to null when the answer is not one the page may show (a Session of
   * another Project); a null or a rejection is a failure.
   */
  run<T>(key: string, lookup: () => Promise<T | null>, on: RouteProbeHandlers<T>): void {
    if (this.inFlight === key) return;
    this.inFlight = key;
    const settle = (row: T | null) => {
      if (this.inFlight === key) this.inFlight = null;
      if (this.routed !== key) return;
      if (row !== null) on.found(row);
      else if (!this.listLoading) on.gone();
    };
    lookup().then(settle, () => settle(null));
  }
}

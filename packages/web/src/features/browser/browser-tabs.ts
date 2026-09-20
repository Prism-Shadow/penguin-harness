/**
 * What each Browser tab is showing: the address, by tab id.
 *
 * Beside the dock store rather than in it. The dock knows tabs by a key and nothing more —
 * which is what lets it restore an arrangement without understanding it — so the one thing a
 * Browser tab has to remember rides here, in one localStorage entry, and a reload brings
 * each tab back to the page it was on. The address is the SITE's (`http://localhost:3000/x`),
 * never the `<label>.localhost` host it is shown on: that host is asked for again on mount.
 */

const TABS_KEY = "penguin.browser.tabs";
/** Addresses kept; a closed tab forgets its own, this only bounds what a crash leaves behind. */
const MAX_TABS = 100;

type Stored = Record<string, { address: string }>;

function read(): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Stored) : {};
  } catch {
    return {}; // node env / private mode / malformed entry
  }
}

function write(tabs: Stored): void {
  try {
    const entries = Object.entries(tabs).slice(-MAX_TABS);
    localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private-mode storage failures only cost persistence.
  }
}

/** A new tab's id, remembering the address it opens on ("" = the blank start page). */
export function newBrowserTab(address = ""): string {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  write({ ...read(), [id]: { address } });
  return id;
}

export function browserAddress(id: string): string {
  const entry = read()[id];
  return typeof entry?.address === "string" ? entry.address : "";
}

export function setBrowserAddress(id: string, address: string): void {
  const tabs = read();
  delete tabs[id]; // re-inserted last, so the cap ages out the tab untouched longest
  write({ ...tabs, [id]: { address } });
}

export function forgetBrowserTab(id: string): void {
  const tabs = read();
  delete tabs[id];
  write(tabs);
}

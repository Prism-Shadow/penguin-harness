/**
 * The cookies of this Chrome profile, handed to a paired server for its built-in browser's
 * import — never without the user's say in Chrome. A `read-cookies` command opens the consent
 * page in a tab, naming the server that asks; Allow there reads the profile's cookies through
 * chrome.cookies, while Deny, closing the page, or two minutes without an answer refuses the
 * command `import_declined`. A second command from the same server while its page is open waits
 * for the same answer, so one import asks once.
 *
 * Chrome hands the values over already decrypted — the reason this route exists: its app-bound
 * encryption keeps them from any other reader of its files.
 */
import type { ChromeExtensionCookie } from "./wire.js";

/** How long the consent page waits for the user before it counts as a refusal. */
export const CONSENT_TIMEOUT_MS = 120_000;

/** What the consent page shows: which server asks. */
export interface ConsentRequest {
  id: string;
  /** The asking server's origin, as it was paired. */
  origin: string;
}

export interface CookieExportOptions {
  /** Opens the consent page for request `id` where the user sees it; resolves with its tab id. */
  openPage(id: string): Promise<number>;
  closePage(tabId: number): Promise<void>;
  /** Every cookie of the profile's own store. */
  readAll(): Promise<chrome.cookies.Cookie[]>;
  newId?(): string;
  timeoutMs?: number;
}

interface Pending {
  request: ConsentRequest;
  tabId: number | null;
  answer: Promise<boolean>;
  settle(allow: boolean): void;
}

export class CookieExport {
  /** The open consent requests, one per asking server. */
  private readonly pending = new Map<string, Pending>();
  private readonly newId: () => string;
  private readonly timeoutMs: number;

  constructor(private readonly options: CookieExportOptions) {
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.timeoutMs = options.timeoutMs ?? CONSENT_TIMEOUT_MS;
  }

  /** `read-cookies` from the server at `origin`: its cookies once the user allows it, else `import_declined`. */
  async read(origin: string): Promise<{ cookies: ChromeExtensionCookie[] }> {
    if (!(await this.ask(origin))) throw new Error("import_declined");
    return { cookies: (await this.options.readAll()).map(toExtensionCookie) };
  }

  /** What the consent page for `id` asks about; null once it is answered or gone. */
  request(id: string): ConsentRequest | null {
    return this.byId(id)?.request ?? null;
  }

  /** The user's answer on the consent page. */
  answer(id: string, allow: boolean): void {
    this.byId(id)?.settle(allow);
  }

  /** A tab closed: a consent page closed without an answer is a refusal. */
  tabClosed(tabId: number): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.tabId === tabId) entry.settle(false);
    }
  }

  private byId(id: string): Pending | undefined {
    return [...this.pending.values()].find((entry) => entry.request.id === id);
  }

  private ask(origin: string): Promise<boolean> {
    const open = this.pending.get(origin);
    if (open !== undefined) return open.answer;
    let resolve!: (allow: boolean) => void;
    const entry: Pending = {
      request: { id: this.newId(), origin },
      tabId: null,
      answer: new Promise<boolean>((r) => {
        resolve = r;
      }),
      settle: () => {},
    };
    const timer = setTimeout(() => entry.settle(false), this.timeoutMs);
    entry.settle = (allow) => {
      if (this.pending.get(origin) !== entry) return;
      this.pending.delete(origin);
      clearTimeout(timer);
      resolve(allow);
      if (entry.tabId !== null) void this.options.closePage(entry.tabId).catch(() => {});
    };
    this.pending.set(origin, entry);
    this.options.openPage(entry.request.id).then(
      (tabId) => {
        // Answered (or timed out) before the tab was known: it has nothing left to ask.
        if (this.pending.get(origin) === entry) entry.tabId = tabId;
        else void this.options.closePage(tabId).catch(() => {});
      },
      () => entry.settle(false),
    );
    return entry.answer;
  }
}

/** A Chrome cookie as the wire carries it: the fields an import reads, nothing of the store's. */
export function toExtensionCookie(cookie: chrome.cookies.Cookie): ChromeExtensionCookie {
  return {
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite as ChromeExtensionCookie["sameSite"],
    ...(!cookie.session && cookie.expirationDate !== undefined
      ? { expirationDate: cookie.expirationDate }
      : {}),
    ...(cookie.partitionKey !== undefined ? { partitioned: true } : {}),
  };
}

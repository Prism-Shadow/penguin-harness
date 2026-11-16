/**
 * The platform UI bridge: how an Agent reaches the Web App page a person is looking at.
 *
 * A page (one browser tab of the Web App) registers itself, then holds one long poll open.
 * A command is queued for the page and answered on that same poll's next round trip: the
 * broker keeps the caller waiting on a promise until the page posts its answer, the page
 * goes away, or the deadline passes. Nothing here knows what a command means — `state`,
 * `screenshot`, `pick` and `element` are the page's own vocabulary (features/platform-ui).
 *
 * One page answers a user: the most recently seen one, unless the caller names a page. That
 * is the tab the person is using; a command routed to a hidden tab would capture a stale
 * screen. Pages of other users are never visible to a caller, so a person's screen is only
 * reachable with their own credential.
 *
 * The broker is in memory on purpose: a page connection lives in one server process, and a
 * record that outlived the connection would only be a page nobody can answer from.
 */
import { Component, Interface } from "@prismshadow/penguin-core/kernel";

/** What the page can be asked; the page's layer is the authority on each one's payload. */
export type UiCommandName = "state" | "screenshot" | "pick" | "element";

/** One page, as it registers itself. */
export interface UiPageRegistration {
  pageId: string;
  /** The path the page is on, for the caller to know which screen answers. */
  route: string;
  title: string;
  projectId?: string | null;
}

/** A registered page, as listings show it. */
export interface UiPageInfo extends UiPageRegistration {
  userId: string;
  connectedAt: string;
  lastSeenAt: string;
}

/** One command on its way to a page. */
export interface UiCommandDelivery {
  id: string;
  name: UiCommandName;
  payload?: Record<string, unknown>;
  issuedAt: string;
}

/** What a page answers with; `ok: false` carries the page's own short reason. */
export interface UiCommandAnswer {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** One dispatch: what to ask, optionally which page, and how long to wait. */
export interface UiCommandRequest {
  name: UiCommandName;
  payload?: Record<string, unknown>;
  pageId?: string;
  timeoutMs?: number;
}

/** The bridge, as routes and plugin commands reach it. */
@Interface()
export abstract class PlatformUi {
  /** Registers (or refreshes) a page of this user. */
  abstract register(userId: string, page: UiPageRegistration): UiPageInfo;
  /** Drops a page; its next poll finds it gone. */
  abstract unregister(userId: string, pageId: string): void;
  /** Refreshes what a poll already knows (route, title) and the page's liveness. */
  abstract touch(
    userId: string,
    pageId: string,
    patch: Partial<UiPageRegistration>,
  ): UiPageInfo | null;
  /** This user's live pages, most recently seen first. */
  abstract pages(userId: string): UiPageInfo[];
  /** Holds the poll open until a command is queued, the wait ends, or the page is gone. */
  abstract poll(userId: string, pageId: string, waitMs: number): Promise<UiCommandDelivery[]>;
  /** The page's answer to one command; false when nothing was waiting for it. */
  abstract answer(
    userId: string,
    pageId: string,
    commandId: string,
    answer: UiCommandAnswer,
  ): boolean;
  /** Asks a page and waits for its answer. */
  abstract dispatch(userId: string, request: UiCommandRequest): Promise<UiCommandAnswer>;
}

/** Longest a poll is held; the page's own loop asks again right away. */
export const MAX_POLL_WAIT_MS = 25_000;
/** A page that has not polled for this long is gone (a closed tab never unregisters). */
export const PAGE_TTL_MS = 90_000;
/** Default deadline for one command; picking an element can ask for more. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
/** Ceiling on one command's deadline, whatever the caller asks. */
export const MAX_COMMAND_TIMEOUT_MS = 300_000;

export interface UiPageBrokerOptions {
  now?: () => number;
  newId?: () => string;
  pageTtlMs?: number;
}

interface PageEntry {
  info: UiPageInfo;
  lastSeenMs: number;
  queue: UiCommandDelivery[];
  waiter: { resolve: (commands: UiCommandDelivery[]) => void } | null;
}

interface PendingCommand {
  userId: string;
  pageId: string;
  resolve: (answer: UiCommandAnswer) => void;
}

let commandSeq = 0;

function defaultId(): string {
  commandSeq += 1;
  return `ui-${Date.now().toString(36)}-${commandSeq.toString(36)}`;
}

/**
 * The broker itself, free of the kernel so a unit test can drive it directly: registration,
 * the held poll, dispatch with a deadline, and the pruning that makes a closed tab a page
 * a caller can be told about instead of one that never answers.
 */
export class UiPageBroker {
  private readonly pages = new Map<string, PageEntry>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly pageTtlMs: number;

  constructor(options: UiPageBrokerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultId;
    this.pageTtlMs = options.pageTtlMs ?? PAGE_TTL_MS;
  }

  private key(userId: string, pageId: string): string {
    return `${userId}\0${pageId}`;
  }

  register(userId: string, page: UiPageRegistration): UiPageInfo {
    this.prune();
    const at = new Date(this.now()).toISOString();
    const key = this.key(userId, page.pageId);
    const existing = this.pages.get(key);
    if (existing !== undefined) {
      existing.info = {
        ...existing.info,
        route: page.route,
        title: page.title,
        projectId: page.projectId ?? existing.info.projectId ?? null,
      };
      existing.lastSeenMs = this.now();
      existing.info.lastSeenAt = at;
      return existing.info;
    }
    const entry: PageEntry = {
      info: {
        ...page,
        projectId: page.projectId ?? null,
        userId,
        connectedAt: at,
        lastSeenAt: at,
      },
      lastSeenMs: this.now(),
      queue: [],
      waiter: null,
    };
    this.pages.set(key, entry);
    return entry.info;
  }

  unregister(userId: string, pageId: string): void {
    const key = this.key(userId, pageId);
    const entry = this.pages.get(key);
    if (entry === undefined) return;
    this.drop(key, entry);
  }

  touch(userId: string, pageId: string, patch: Partial<UiPageRegistration>): UiPageInfo | null {
    const entry = this.pages.get(this.key(userId, pageId));
    if (entry === undefined) return null;
    entry.info = {
      ...entry.info,
      ...(patch.route === undefined ? {} : { route: patch.route }),
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.projectId === undefined ? {} : { projectId: patch.projectId }),
    };
    entry.lastSeenMs = this.now();
    entry.info.lastSeenAt = new Date(this.now()).toISOString();
    return entry.info;
  }

  pagesOf(userId: string): UiPageInfo[] {
    this.prune();
    return [...this.pages.values()]
      .filter((entry) => entry.info.userId === userId)
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
      .map((entry) => entry.info);
  }

  async poll(userId: string, pageId: string, waitMs: number): Promise<UiCommandDelivery[]> {
    const entry = this.pages.get(this.key(userId, pageId));
    if (entry === undefined) throw new Error("unknown_page");
    entry.lastSeenMs = this.now();
    entry.info.lastSeenAt = new Date(this.now()).toISOString();
    if (entry.queue.length > 0) return entry.queue.splice(0, entry.queue.length);
    // A page holds one poll at a time; an earlier one that never returned (a reload) is let go.
    entry.waiter?.resolve([]);
    entry.waiter = null;
    const wait = Math.min(Math.max(waitMs, 0), MAX_POLL_WAIT_MS);
    return await new Promise<UiCommandDelivery[]>((resolve) => {
      let settled = false;
      const finish = (commands: UiCommandDelivery[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (entry.waiter?.resolve === finish) entry.waiter = null;
        resolve(commands);
      };
      const timer = setTimeout(() => finish([]), wait);
      entry.waiter = { resolve: finish };
    });
  }

  answer(userId: string, pageId: string, commandId: string, answer: UiCommandAnswer): boolean {
    const pending = this.pending.get(commandId);
    if (pending === undefined) return false;
    if (pending.userId !== userId || pending.pageId !== pageId) return false;
    this.pending.delete(commandId);
    pending.resolve(answer);
    return true;
  }

  async dispatch(userId: string, request: UiCommandRequest): Promise<UiCommandAnswer> {
    this.prune();
    const entry =
      request.pageId === undefined
        ? this.mostRecent(userId)
        : this.pages.get(this.key(userId, request.pageId));
    if (entry === undefined) {
      return {
        ok: false,
        error:
          request.pageId === undefined
            ? "no_page: no Web App page of this user is connected"
            : `no_page: page ${request.pageId} is not connected`,
      };
    }
    const delivery: UiCommandDelivery = {
      id: this.newId(),
      name: request.name,
      ...(request.payload === undefined ? {} : { payload: request.payload }),
      issuedAt: new Date(this.now()).toISOString(),
    };
    const timeoutMs = Math.min(
      Math.max(request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, 1_000),
      MAX_COMMAND_TIMEOUT_MS,
    );
    const answer = new Promise<UiCommandAnswer>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(delivery.id);
        resolve({
          ok: false,
          error: `timeout: the page did not answer within ${timeoutMs} ms`,
        });
      }, timeoutMs);
      this.pending.set(delivery.id, {
        userId,
        pageId: entry.info.pageId,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
    });
    if (entry.waiter !== null) {
      const waiter = entry.waiter;
      entry.waiter = null;
      waiter.resolve([delivery]);
    } else {
      entry.queue.push(delivery);
    }
    return answer;
  }

  private mostRecent(userId: string): PageEntry | undefined {
    let best: PageEntry | undefined;
    for (const entry of this.pages.values()) {
      if (entry.info.userId !== userId) continue;
      if (best === undefined || entry.lastSeenMs > best.lastSeenMs) best = entry;
    }
    return best;
  }

  /** Drops pages whose last poll is older than the TTL, answering their waiting callers. */
  private prune(): void {
    const cutoff = this.now() - this.pageTtlMs;
    for (const [key, entry] of [...this.pages.entries()]) {
      if (entry.lastSeenMs >= cutoff) continue;
      this.drop(key, entry);
    }
  }

  private drop(key: string, entry: PageEntry): void {
    entry.waiter?.resolve([]);
    entry.waiter = null;
    entry.queue = [];
    this.pages.delete(key);
    for (const [id, pending] of [...this.pending.entries()]) {
      if (pending.userId !== entry.info.userId || pending.pageId !== entry.info.pageId) continue;
      this.pending.delete(id);
      pending.resolve({ ok: false, error: "page_gone: the page left before it answered" });
    }
  }
}

/** The bridge as the tree provides it: one in-memory broker for this server process. */
@Component()
export class PlatformUiService implements PlatformUi {
  private readonly broker = new UiPageBroker();

  register(userId: string, page: UiPageRegistration): UiPageInfo {
    return this.broker.register(userId, page);
  }

  unregister(userId: string, pageId: string): void {
    this.broker.unregister(userId, pageId);
  }

  touch(userId: string, pageId: string, patch: Partial<UiPageRegistration>): UiPageInfo | null {
    return this.broker.touch(userId, pageId, patch);
  }

  pages(userId: string): UiPageInfo[] {
    return this.broker.pagesOf(userId);
  }

  poll(userId: string, pageId: string, waitMs: number): Promise<UiCommandDelivery[]> {
    return this.broker.poll(userId, pageId, waitMs);
  }

  answer(userId: string, pageId: string, commandId: string, answer: UiCommandAnswer): boolean {
    return this.broker.answer(userId, pageId, commandId, answer);
  }

  dispatch(userId: string, request: UiCommandRequest): Promise<UiCommandAnswer> {
    return this.broker.dispatch(userId, request);
  }
}

/**
 * `@prismshadow/penguin-web-plugin/testing` — a stand-in host for a plugin web half's own tests,
 * which cannot import the Web App (the app depends on the plugin). It hands the face working
 * abilities without a browser or a server behind them:
 *
 * - `apiFetch` sends the request through the global `fetch` (stub it, as the app's tests do) as
 *   JSON, and throws `ApiError` with the server's `{ error: { code, message } }` on a failure;
 * - a failure's words are the plugin's own error text for its code (its string tables'
 *   `apiErrors`), else the server's message; toasts, Settings requests and dock openings are
 *   recorded rather than shown;
 * - the dock has no tab on screen and the conversation scope is the placeholder `~none`; a tone
 *   map names the tone (`tone-danger`), which is enough to tell tones apart;
 * - a date prints as the ISO text it was handed, and a byte count as its number of bytes.
 *
 * Anything else a test needs differently it passes in `overrides`. Calling it again replaces the
 * previous stand-in.
 */
import {
  provideWebHost,
  type ApiErrorShape,
  type ApiFetchOptions,
  type Tone,
  type WebHost,
} from "./bridge";
import { contributedErrorText } from "./strings";

/** What the stand-in was asked to do that has no screen to show it on. */
export interface TestHostRecord {
  /** Each failure toast's words, in order. */
  toasts: string[];
  /** Each Settings page asked for (undefined: the first page). */
  settings: Array<string | undefined>;
  /** Each dock panel opened, by kind. */
  panels: string[];
}

class TestApiError extends Error implements ApiErrorShape {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  readonly details?: Readonly<Record<string, string>>;
  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
    if (details !== undefined) this.details = details;
  }
}

const tones = (): Readonly<Record<Tone, string>> => ({
  busy: "tone-busy",
  attention: "tone-attention",
  success: "tone-success",
  link: "tone-link",
  danger: "tone-danger",
  muted: "tone-muted",
});

async function fetchJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const query = Object.entries(options.query ?? {}).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]],
  );
  const url = query.length > 0 ? `${path}?${new URLSearchParams(query).toString()}` : path;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    ...(options.body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }
      : {}),
  });
  const text = await res.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new TestApiError(res.status, error?.code ?? "internal", error?.message ?? res.statusText);
  }
  return body as T;
}

/** Hands the face a stand-in host; answers what it records. */
export function provideTestHost(overrides: Partial<WebHost> = {}): TestHostRecord {
  const record: TestHostRecord = { toasts: [], settings: [], panels: [] };
  const apiErrorText = (err: unknown): string =>
    err instanceof TestApiError
      ? (contributedErrorText(err.code) ?? err.message)
      : err instanceof Error
        ? err.message
        : String(err);
  const failureOf: WebHost["failureOf"] = (err, ctx) => ({
    text: ctx?.text ?? apiErrorText(err),
    report: null,
  });
  provideWebHost({
    ApiError: TestApiError,
    apiFetch: fetchJson,
    apiErrorText,
    failureOf,
    failureNode: (err, ctx) => failureOf(err, ctx).text,
    toastApiError: (err, ctx) => record.toasts.push(failureOf(err, ctx).text),
    requestSettings: (request) => record.settings.push(request?.section),
    openPanel: (kind) => record.panels.push(kind),
    isTabShown: () => false,
    currentDockScope: () => "~none",
    isOpenPageDrag: () => false,
    formatDateTime: (iso) => iso,
    formatRelativeShort: (iso) => iso,
    formatRelativeLong: (iso) => iso,
    formatBytes: (bytes) => `${bytes}B`,
    toneInk: tones(),
    toneSurface: tones(),
    toneDot: tones(),
    ...overrides,
  });
  return record;
}

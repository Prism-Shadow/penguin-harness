/**
 * The host abilities a plugin's web half calls, and the one door through which the Web App hands
 * them over.
 *
 * Nothing here is implemented: the Web App calls `provideWebHost` with its own functions before
 * it boots its module tree (packages/web/src/web-app/plugin-host.ts), and every function below forwards
 * to the one it was given. That is what keeps the dependency one-way — a plugin imports this
 * package, the Web App imports this package and the plugin — and it is also what keeps a
 * plugin's requests on the Web App's own transport: `apiFetch` here is the Web App's `apiFetch`,
 * so the test socket stand-in and the gallery's network swap catch a plugin's calls exactly as
 * they catch the app's.
 *
 * `ApiError` and the three tone maps are live bindings, reassigned when the host is provided:
 * read them where they are used (`err instanceof ApiError`, `toneInk.busy`), never copy them
 * into a constant at load time. Calling a forwarding function, or reading a tone, before the host
 * is provided throws, naming what is missing; before then nothing is an `ApiError`. A plugin's
 * own tests hand over a stand-in from `@prismshadow/penguin-web-plugin/testing`.
 */
import type { ReactNode } from "react";
import type { Failure, ReportMask } from "@prismshadow/penguin-ui";

/** A status tone, chosen by meaning (the Web App's lib/tone.ts holds what each one means). */
export type Tone = "busy" | "attention" | "success" | "link" | "danger" | "muted";

/** One event on the user channel (`/api/events`), or a connected machine's wrapped in `machine_event`. */
export interface UserChannelEvent {
  readonly type: string;
  readonly event?: { readonly type: string };
}

/** The dock a panel's tab lands in. */
export type DockPosition = "right" | "bottom";

/** What one API call sends: the Web App's `ApiFetchOptions`. */
export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON request body. */
  body?: unknown;
  /** Query parameters; undefined values are skipped. */
  query?: Record<string, string | number | undefined>;
  /** The machine that answers: omitted routes by the path, `null` forces this server. */
  server?: string | null;
}

/** An API failure as the Web App's client throws it: the HTTP status and the server's code. */
export interface ApiErrorShape extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  readonly details?: Readonly<Record<string, string>>;
}

export interface ApiErrorClass {
  new (
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
    details?: Record<string, string>,
  ): ApiErrorShape;
}

/** How a failure is worded and reported (the Web App's lib/failure.tsx). */
export interface FailureContext {
  /** The model a missing credential is about. */
  modelId?: string;
  /** The surface's own words, in place of the code's text. */
  text?: string;
  /** What happened, for the report. */
  what?: string;
  /** Paths to keep out of the report. */
  privatePaths?: readonly string[];
  /** What else to mask in the report. */
  mask?: ReportMask;
}

/** What the Web App hands over. */
export interface WebHost {
  ApiError: ApiErrorClass;
  apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T>;
  apiErrorText(err: unknown, ctx?: { modelId?: string }): string;
  failureOf(err: unknown, ctx?: FailureContext): Failure;
  failureNode(err: unknown, ctx?: FailureContext): ReactNode;
  toastApiError(err: unknown, ctx?: FailureContext): void;
  /** Opens the Settings dialog, on `section` when the viewer may open it. */
  requestSettings(request?: { section?: string }): void;
  /** Navigates the Web App's router to `to`. */
  navigate(to: string): void;
  openPanel(kind: string, position?: DockPosition, fallback?: DockPosition): void;
  /** Whether that panel's tab is the shown one in an open dock. */
  isTabShown(kind: string): boolean;
  /** The conversation the docks belong to now. */
  currentDockScope(): string;
  formatDateTime(iso: string): string;
  /** How long ago `iso` was, in the language on screen, in a row's few characters ("3d"). */
  formatRelativeShort(iso: string): string;
  /** The same in words, as a sentence says it ("3 days ago"). */
  formatRelativeLong(iso: string): string;
  /** A byte count in the app's units ("4.9GB"). */
  formatBytes(bytes: number): string;
  /** Calls `listener` with every event on this server's user channel (`/api/events`) until the returned function is called. */
  subscribeUserEvents(listener: (event: UserChannelEvent) => void): () => void;
  toneInk: Readonly<Record<Tone, string>>;
  toneSurface: Readonly<Record<Tone, string>>;
  toneDot: Readonly<Record<Tone, string>>;
}

let host: WebHost | null = null;

const unprovided = (name: string): Error =>
  new Error(
    `@prismshadow/penguin-web-plugin: ${name} was used before the Web App provided its host (packages/web/src/web-app/plugin-host.ts)`,
  );

function need<K extends keyof WebHost>(name: K): WebHost[K] {
  if (host === null) throw unprovided(name);
  return host[name];
}

/** Stands in until the host is provided; nothing is ever an instance of it. */
class UnprovidedApiError extends Error implements ApiErrorShape {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A tone map that throws on every read until the host's replaces it. */
function unprovidedTones(name: string): Readonly<Record<Tone, string>> {
  return new Proxy({} as Record<Tone, string>, {
    get: (_target, key) => {
      if (typeof key === "symbol") return undefined;
      throw unprovided(name);
    },
  });
}

export type ApiError = ApiErrorShape;
export let ApiError: ApiErrorClass = UnprovidedApiError;
export let toneInk: Readonly<Record<Tone, string>> = unprovidedTones("toneInk");
export let toneSurface: Readonly<Record<Tone, string>> = unprovidedTones("toneSurface");
export let toneDot: Readonly<Record<Tone, string>> = unprovidedTones("toneDot");

/** The Web App's side: hands its implementations over. Called once, before the module tree boots. */
export function provideWebHost(next: WebHost): void {
  host = next;
  ApiError = next.ApiError;
  toneInk = next.toneInk;
  toneSurface = next.toneSurface;
  toneDot = next.toneDot;
}

export function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  return need("apiFetch")<T>(path, options);
}

export function apiErrorText(err: unknown, ctx?: { modelId?: string }): string {
  return need("apiErrorText")(err, ctx);
}

export function failureOf(err: unknown, ctx?: FailureContext): Failure {
  return need("failureOf")(err, ctx);
}

export function failureNode(err: unknown, ctx?: FailureContext): ReactNode {
  return need("failureNode")(err, ctx);
}

export function toastApiError(err: unknown, ctx?: FailureContext): void {
  need("toastApiError")(err, ctx);
}

export function requestSettings(request?: { section?: string }): void {
  need("requestSettings")(request);
}

export function navigate(to: string): void {
  need("navigate")(to);
}

export function openPanel(kind: string, position?: DockPosition, fallback?: DockPosition): void {
  need("openPanel")(kind, position, fallback);
}

export function isTabShown(kind: string): boolean {
  return need("isTabShown")(kind);
}

export function currentDockScope(): string {
  return need("currentDockScope")();
}

export function formatDateTime(iso: string): string {
  return need("formatDateTime")(iso);
}

export function formatRelativeShort(iso: string): string {
  return need("formatRelativeShort")(iso);
}

export function formatRelativeLong(iso: string): string {
  return need("formatRelativeLong")(iso);
}

export function formatBytes(bytes: number): string {
  return need("formatBytes")(bytes);
}

export function subscribeUserEvents(listener: (event: UserChannelEvent) => void): () => void {
  return need("subscribeUserEvents")(listener);
}

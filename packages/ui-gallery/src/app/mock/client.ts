/**
 * The Web App's `api/client.ts`, swapped in by the gallery's Vite config: the same exports
 * with the same shapes, answered by the demo store's router instead of `fetch`. The app's
 * endpoint wrappers, its providers and its features import this file without knowing.
 *
 * A request takes a beat (a few ms) before it answers, so the app's loading states render
 * the way they do against a server, and so nothing that relies on "the answer comes later"
 * runs in the wrong order.
 */
import { ApiError } from "./errors";
import { router } from "./routes";
import { getStore } from "./store";
import type { Method } from "./router";

export { ApiError };

/** Session-invalidation callback (registered by AuthProvider; not triggered by auth endpoints). */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

function isAuthEndpoint(path: string): boolean {
  return path.startsWith("/api/auth/");
}

export interface ApiFetchOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  server?: string | null;
}

export interface ApiFetchMeta {
  serverNowMs: number | null;
}

/** A beat in the browser; none under Node, where the tests walk every endpoint. */
const LATENCY_MS = typeof window === "undefined" ? 0 : 24;

const beat = () => new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS));

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return (await apiFetchWithMeta<T>(path, options)).data;
}

export async function apiFetchWithMeta<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T } & ApiFetchMeta> {
  let url = path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  await beat();
  let answer;
  try {
    answer = await router.dispatch(getStore(), options.method ?? "GET", url, options.body);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 && !isAuthEndpoint(path)) onUnauthorized?.();
      throw error;
    }
    throw new ApiError(500, "internal", error instanceof Error ? error.message : String(error));
  }
  const serverNowMs = Date.now();
  if (answer.kind === "empty") return { data: undefined as T, serverNowMs };
  if (answer.kind === "raw") return { data: answer.body as T, serverNowMs };
  return { data: answer.body as T, serverNowMs };
}

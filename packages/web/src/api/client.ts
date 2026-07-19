/**
 * fetch wrapper: JSON request/response, unified errors -> ApiError,
 * same-origin cookie auth (credentials: same-origin; CSRF relies on SameSite=Lax + JSON
 * Content-Type, see server README).
 *
 * When the session becomes invalid (server 401, e.g. database rebuilt, cookie expired),
 * notifies AuthProvider to clear the current user, letting the route guard redirect to the
 * login page — instead of each page popping its own "unauthorized" error.
 */
import { S } from "../lib/strings";

/** Unified API error: carries the HTTP status code and server error code (server error body {error:{code,message}}). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Session-invalidation callback (registered by AuthProvider; not triggered by 401s from the login/register endpoints themselves). */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** 401/409 from auth endpoints themselves are business failures (e.g. wrong password) and must not trigger a global logout. */
function isAuthEndpoint(path: string): boolean {
  return path.startsWith("/api/auth/");
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON request body (auto-serialized with Content-Type: application/json). */
  body?: unknown;
  /** Query parameters (undefined values are skipped). */
  query?: Record<string, string | number | undefined>;
}

/** Makes an API request; non-2xx responses uniformly throw ApiError; 204/empty body returns undefined. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  let url = path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      ...(options.body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options.body),
          }
        : {}),
    });
  } catch {
    throw new ApiError(0, "network_error", S.errors.networkError);
  }

  if (!response.ok) {
    let code = "http_error";
    let message: string = S.common.unknownError;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body: fall back to the default message.
    }
    if (response.status === 401 && !isAuthEndpoint(path)) onUnauthorized?.();
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

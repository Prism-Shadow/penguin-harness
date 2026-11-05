/**
 * Routing for the mocked API: a method and a path pattern per handler, `:name` segments bound
 * as params, the query parsed, the body passed through. A request no route matches answers
 * 404 with the `gallery_unmocked` code — that, and nothing else, is what the coverage test
 * treats as a gap. A signed-out request to anything but the public routes answers 401, as the
 * server does, so the app's sign-out path is exercised too.
 *
 * Machine-routed paths (`/server/<id>/api/…`) are answered as if by this server: the demo has
 * one machine's worth of everything.
 */
import { ApiError, UNMOCKED } from "./errors";
import type { DemoStore } from "./store";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A handler's answer: JSON (the default), a raw body with headers, or nothing (204). */
export type Answer =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "raw"; status: number; body: string; headers: Record<string, string> }
  | { kind: "empty"; status: number };

export interface RequestContext {
  store: DemoStore;
  method: Method;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type Handler = (ctx: RequestContext) => unknown | Answer | Promise<unknown | Answer>;

interface Route {
  method: Method;
  pattern: string;
  segments: string[];
  handler: Handler;
}

/** Marks an answer as raw text with headers (a file's content, a download). */
export function raw(body: string, headers: Record<string, string> = {}, status = 200): Answer {
  return { kind: "raw", status, body, headers };
}

/** Marks an answer as bodiless (a 204, or a 202 that says nothing). */
export function empty(status = 204): Answer {
  return { kind: "empty", status };
}

/** JSON with a status other than 200 (a 201 on creation). */
export function json(body: unknown, status: number): Answer {
  return { kind: "json", status, body };
}

/** Throws the failure the app expects for a refused request. */
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}

function isAnswer(value: unknown): value is Answer {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ((value as Answer).kind === "json" ||
      (value as Answer).kind === "raw" ||
      (value as Answer).kind === "empty")
  );
}

export class Router {
  private readonly routes: Route[] = [];
  private readonly publicPaths = new Set<string>();

  add(method: Method, pattern: string, handler: Handler): this {
    this.routes.push({ method, pattern, segments: pattern.split("/"), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler): this {
    return this.add("POST", pattern, handler);
  }
  put(pattern: string, handler: Handler): this {
    return this.add("PUT", pattern, handler);
  }
  patch(pattern: string, handler: Handler): this {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: Handler): this {
    return this.add("DELETE", pattern, handler);
  }

  /** Routes a signed-out request may take. */
  public(...patterns: string[]): this {
    for (const pattern of patterns) this.publicPaths.add(pattern);
    return this;
  }

  /** The route a method and path name, with the params bound; null when none matches. */
  match(method: Method, path: string): { route: Route; params: Record<string, string> } | null {
    const parts = path.split("/");
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchSegments(route.segments, parts);
      if (params !== null) return { route, params };
    }
    return null;
  }

  /** Every pattern, for the tests. */
  patterns(): readonly { method: Method; pattern: string }[] {
    return this.routes.map(({ method, pattern }) => ({ method, pattern }));
  }

  async dispatch(store: DemoStore, method: Method, url: string, body: unknown): Promise<Answer> {
    const { path, query } = splitUrl(url);
    const found = this.match(method, path);
    if (found === null) {
      throw new ApiError(
        404,
        UNMOCKED,
        `The gallery's demo API has no answer for ${method} ${path}.`,
      );
    }
    if (!store.signedIn && !this.publicPaths.has(found.route.pattern)) {
      throw new ApiError(401, "unauthorized", "Not signed in.");
    }
    const result = await found.route.handler({
      store,
      method,
      path,
      params: found.params,
      query,
      body,
    });
    if (isAnswer(result)) return result;
    if (result === undefined) return { kind: "empty", status: 204 };
    return { kind: "json", status: 200, body: result };
  }
}

/** `:name` segments bind; `*` at the end swallows the rest; anything else matches literally. */
function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i]!;
    if (expected === "*") {
      params["*"] = parts.slice(i).map(decode).join("/");
      return params;
    }
    const actual = parts[i];
    if (actual === undefined) return null;
    if (expected.startsWith(":")) params[expected.slice(1)] = decode(actual);
    else if (expected !== actual) return null;
  }
  return parts.length === pattern.length ? params : null;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The path (machine prefix removed) and query of a request URL, relative or absolute. */
export function splitUrl(url: string): { path: string; query: URLSearchParams } {
  const withoutOrigin = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const hash = withoutOrigin.indexOf("#");
  const clean = hash === -1 ? withoutOrigin : withoutOrigin.slice(0, hash);
  const q = clean.indexOf("?");
  let path = q === -1 ? clean : clean.slice(0, q);
  const query = new URLSearchParams(q === -1 ? "" : clean.slice(q + 1));
  const machine = /^\/server\/[^/]+(\/api\/.*)$/.exec(path);
  if (machine) path = machine[1]!;
  return { path, query };
}

/** Whether a URL is one the mock answers: this server's API, or a machine's through it. */
export function isApiUrl(url: string): boolean {
  const { path } = splitUrl(url);
  return path.startsWith("/api/");
}

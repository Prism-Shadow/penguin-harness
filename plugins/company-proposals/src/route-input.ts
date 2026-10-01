/**
 * What the routes read off a request: the caller (the identity claims a session's
 * subprocess may make), the JSON body and its fields, the path parameters. Shared by the
 * proposal routes (routes.ts) and the deploy routes (deploy-routes.ts).
 */
import type { Context } from "hono";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import { ProposalError } from "./service.js";

export type SessionVia = "password" | "desktop" | "setup" | "token" | string;

/**
 * The body's `sessionId` is an identity claim — "this write comes from inside that Session"
 * — and the only credential that backs it is the boot's local API token, which the control
 * environment hands a Session's subprocesses. A cookie proves a person, not a session, so a
 * cookie-authenticated claim is dropped and the write is attributed to that person.
 */
export function callerSessionId(
  via: SessionVia,
  body: Record<string, unknown>,
): string | undefined {
  const sessionId = body.sessionId;
  return via === "token" && typeof sessionId === "string" && sessionId !== ""
    ? sessionId
    : undefined;
}

/** Who performs this write; `agentId` is the same kind of claim as `sessionId`, backed by the same credential. */
export function actorOf(
  c: Context,
  body: Record<string, unknown>,
  opts: { agentIdField?: string } = {},
): OrgActor {
  const user = c.get("user" as never) as { userId: string };
  const via = c.get("sessionVia" as never) as SessionVia;
  const sessionId = callerSessionId(via, body);
  const field = opts.agentIdField ?? "agentId";
  const raw = body[field];
  const agentId = via === "token" && typeof raw === "string" && raw !== "" ? raw : undefined;
  return {
    userId: user.userId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
  };
}

/** The same claim on a read, where `?sessionId=` / `?agentId=` carry it. */
export function actorOfQuery(c: Context): OrgActor {
  const user = c.get("user" as never) as { userId: string };
  const via = c.get("sessionVia" as never) as SessionVia;
  const sessionId = c.req.query("sessionId");
  const agentId = c.req.query("agentId");
  return {
    userId: user.userId,
    ...(via === "token" && sessionId ? { sessionId } : {}),
    ...(via === "token" && agentId ? { agentId } : {}),
  };
}

export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ProposalError(400, "bad_request", "Body must be a JSON object.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ProposalError(400, "bad_request", "Body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string, maxLen = 20_000): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProposalError(400, "bad_request", `${key} must be a non-empty string.`);
  }
  if (value.length > maxLen) {
    throw new ProposalError(400, "bad_request", `${key} is too long (max ${maxLen} characters).`);
  }
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLen = 4000,
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new ProposalError(400, "bad_request", `${key} must be a string.`);
  if (value.length > maxLen) {
    throw new ProposalError(400, "bad_request", `${key} is too long (max ${maxLen} characters).`);
  }
  return value;
}

export function numberParam(c: Context): number {
  const raw = c.req.param("number");
  const n = Number(raw);
  if (!/^\d+$/.test(raw ?? "") || !Number.isInteger(n) || n < 1) {
    throw new ProposalError(404, "proposal_not_found", `Proposal does not exist: ${raw}`);
  }
  return n;
}

export function param(c: Context, name: "projectId" | "orgId"): string {
  const value = c.req.param(name);
  if (value === undefined || value === "") {
    throw new ProposalError(404, "org_not_found", `Missing ${name}.`);
  }
  return value;
}

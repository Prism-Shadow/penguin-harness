/**
 * Provider key-minting flows (the `oauth` descriptor in core's model catalog).
 *
 * A provider that publishes such a flow lets the user authorize in a browser and get a
 * **freshly minted API key** back, instead of copying one out of a console. The upstream
 * protocol is PKCE: the harness picks a random verifier, sends only its SHA-256 challenge
 * to the authorization page, and later presents the verifier to redeem the one-time code
 * the page hands back.
 *
 * Everything secret stays on this side of the wire. The verifier is generated here, kept
 * only in this process's memory, and never sent to the browser; the minted key goes
 * straight into the Project's model config and is never echoed to a caller, a URL, or a
 * log line. What the Web App holds is an opaque flow id and a status.
 *
 * That flow id is also a capability, and the flow store treats it as one: 32 random bytes
 * bound here to a user, a Project, a provider and a verifier, valid for ten minutes and
 * spendable once. The loopback redirect receiver leans on exactly that, because the browser
 * the provider redirects cannot be assumed to hold a session — see the route module. What
 * that receiver may do with the id is only `deposit`: the exchange itself runs on the
 * owner's own poll, so no key is ever written for a Project without its owner asking.
 *
 * Flows are in-memory and per-App: a restart or a platform push drops the pending ones,
 * which costs the user a re-authorization and nothing else (the upstream code expires in
 * minutes anyway, and no key exists until the exchange runs).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { APP_URL, providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderOAuth } from "@prismshadow/penguin-core/model-catalog";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ProjectConfigService } from "./project-config-service.js";

/** How the user gets the authorization code back to the harness. */
export type ModelOAuthMode = "callback" | "manual";

/** A flow's terminal-or-not state, as the Web App polls it. */
export type ModelOAuthStatus = "pending" | "done" | "error";

/**
 * Lifetime of a flow. The upstream one-time code is valid for ten minutes, so a flow that
 * outlived that window can only ever fail — expiring it here keeps the verifier's residency
 * in memory bounded by the same figure.
 */
export const FLOW_TTL_MS = 10 * 60 * 1000;

/**
 * Concurrent pending flows one user may hold in one Project. Reached only by repeatedly
 * opening the dialog without finishing; the oldest is evicted rather than refusing the
 * newest, so the button a user just pressed always works.
 */
const MAX_FLOWS_PER_OWNER = 8;

interface Flow {
  flowId: string;
  projectId: string;
  userId: string;
  provider: string;
  /** How the code travels back; only a `callback` flow has a redirect receiver to serve. */
  mode: ModelOAuthMode;
  exchangeUrl: string;
  /** PKCE verifier; dropped the moment the flow is spent. */
  verifier: string | null;
  /**
   * The authorization code a redirect deposited, waiting for the owner's next poll to
   * redeem it. Null until the redirect arrives and null again the instant the exchange
   * claims it, so it can never be redeemed twice; the flow's TTL bounds how long it may sit
   * here unspent.
   */
  code: string | null;
  createdAt: number;
  expiresAt: number;
  status: ModelOAuthStatus;
  /** Machine-readable failure reason, mirrored to the Web App so it can localize. */
  errorCode?: ModelOAuthErrorCode;
}

/**
 * Failure reasons a flow can end in. Deliberately coarse: each one maps to a sentence the
 * Web App already knows how to phrase, and none of them can carry a code, a verifier or a
 * key.
 */
export type ModelOAuthErrorCode =
  /** The authorization request itself was malformed (bad callback URL, incomplete PKCE). */
  | "invalid_request"
  /** The code is unknown, expired, already redeemed, or was minted for another verifier. */
  | "code_rejected"
  /** The provider answered, but not with a usable key. */
  | "upstream_failed"
  /** The provider could not be reached at all. */
  | "unreachable"
  /** A key was minted but could not be written into the Project's models. */
  | "apply_failed";

/** What `start` hands back to the Web App: an opaque id plus the page to send the user to. */
export interface ModelOAuthStartResult {
  flowId: string;
  authorizeUrl: string;
}

/**
 * PKCE verifier: two random UUIDs concatenated, as the upstream protocol documents. 72
 * characters drawn from `[0-9a-f-]`, inside both the 43–128 length window and the
 * `[A-Za-z0-9-._~]` alphabet the spec allows.
 */
export function createVerifier(): string {
  return `${randomUUID()}${randomUUID()}`;
}

/**
 * PKCE S256 challenge: base64url of the verifier's SHA-256 digest, unpadded. Node's
 * `base64url` digest encoding already substitutes `-`/`_` and drops `=`, so this is the
 * documented `btoa(...).replace(...)` chain by another name.
 */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

/**
 * The authorization page URL for one flow.
 *
 * `callbackUrl` is omitted in manual mode, which is what makes the page display a one-time
 * code for the user to carry back by hand instead of redirecting. S256 is sent either way:
 * without it a code observed in a redirect could be redeemed by whoever observed it, and
 * the manual mode refuses to run without it at all.
 *
 * Parameter order follows the published example so a URL from here is diffable against the
 * documentation; `URLSearchParams` percent-encodes the two URL-valued parameters.
 */
export function buildAuthorizeUrl(input: {
  oauth: ModelProviderOAuth;
  challenge: string;
  /** Absent in manual mode. */
  callbackUrl?: string;
}): string {
  const params = new URLSearchParams();
  if (input.callbackUrl !== undefined) params.set("callback_url", input.callbackUrl);
  params.set("code_challenge", input.challenge);
  params.set("code_challenge_method", "S256");
  // The app's own stable URL, never the callback's ephemeral port: it is stamped onto the
  // minted key and every later call made with that key inherits it.
  params.set("app_url", APP_URL);
  params.set("key_name", input.oauth.keyName);
  return `${input.oauth.authorizeUrl}?${params.toString()}`;
}

/** Outcome of redeeming a code: the key on success, a coarse reason on failure. */
export type ExchangeResult = { ok: true; key: string } | { ok: false; error: ModelOAuthErrorCode };

/**
 * Redeem an authorization code for a newly minted key.
 *
 * The reply carries the full key exactly once, so the caller must persist it before doing
 * anything that can throw — a lost reply leaves an orphaned key on the user's account that
 * only they can delete.
 *
 * Upstream status mapping: 400 is a malformed authorization request (bad callback URL,
 * incomplete PKCE, a method other than S256), 403 covers every code-level rejection —
 * unknown, expired, already redeemed, or a verifier that does not match the challenge.
 */
export async function exchangeCode(input: {
  exchangeUrl: string;
  code: string;
  verifier: string;
  fetchImpl: typeof fetch;
}): Promise<ExchangeResult> {
  let res: Response;
  try {
    res = await input.fetchImpl(input.exchangeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: input.code,
        code_verifier: input.verifier,
        code_challenge_method: "S256",
      }),
    });
  } catch {
    // The reason is intentionally not carried further: a fetch failure message can quote
    // the request, and the request holds the code and the verifier.
    return { ok: false, error: "unreachable" };
  }
  if (!res.ok) {
    if (res.status === 400) return { ok: false, error: "invalid_request" };
    if (res.status === 403) return { ok: false, error: "code_rejected" };
    return { ok: false, error: "upstream_failed" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "upstream_failed" };
  }
  const key = (body as { key?: unknown } | null)?.key;
  if (typeof key !== "string" || key === "") return { ok: false, error: "upstream_failed" };
  return { ok: true, key };
}

/** Writes a minted key onto every model of one provider group; returns how many it touched. */
export type ApplyGroupKey = (
  projectId: string,
  provider: string,
  apiKey: string,
) => Promise<number>;

@Component()
export class ModelOAuthService {
  private readonly flows = new Map<string, Flow>();
  @Use() private readonly projectConfig!: ProjectConfigService;
  private applyGroupKey: ApplyGroupKey = (projectId, provider, apiKey) =>
    this.projectConfig.setGroupApiKey(projectId, provider, apiKey);
  /** Replaced in tests so they never reach the network. */
  private fetchImpl: typeof fetch = (...args) => fetch(...args);
  private now: () => number = () => Date.now();

  /**
   * Open a flow for one provider group and return the page to send the user to.
   *
   * The provider is resolved in the built-in catalog, never taken from the caller: a group
   * that declares no `oauth` cannot be talked into one, and the authorize/exchange
   * endpoints are always the catalog's, so client input never chooses who receives the
   * challenge or who is asked for a key.
   */
  start(input: {
    projectId: string;
    userId: string;
    provider: string;
    mode: ModelOAuthMode;
    /** Where the provider should send the browser back to; ignored in manual mode. */
    callbackOrigin: string;
  }): ModelOAuthStartResult {
    const oauth = providerInfo(input.provider)?.oauth;
    if (oauth === undefined) {
      throw badRequest(`Provider ${input.provider} does not support authorizing a new API key.`);
    }
    this.sweep();
    this.evictOldest(input.userId, input.projectId);

    const flowId = randomBytes(32).toString("base64url");
    const verifier = createVerifier();
    const createdAt = this.now();
    // The callback keeps its own query string: the provider appends `code=` to whatever
    // path and parameters it was given, so the flow id rides back with the code.
    const callbackUrl =
      input.mode === "callback"
        ? `${input.callbackOrigin}/api/projects/${encodeURIComponent(input.projectId)}/model-oauth/callback?flow=${encodeURIComponent(flowId)}`
        : undefined;
    this.flows.set(flowId, {
      flowId,
      projectId: input.projectId,
      userId: input.userId,
      provider: input.provider,
      mode: input.mode,
      exchangeUrl: oauth.exchangeUrl,
      verifier,
      code: null,
      createdAt,
      expiresAt: createdAt + FLOW_TTL_MS,
      status: "pending",
    });
    return {
      flowId,
      authorizeUrl: buildAuthorizeUrl({
        oauth,
        challenge: codeChallenge(verifier),
        ...(callbackUrl !== undefined ? { callbackUrl } : {}),
      }),
    };
  }

  /**
   * Record the authorization code a redirect carried back — the whole power of the loopback
   * receiver, which answers without a session because the browser the provider redirects
   * cannot be assumed to hold one (on the desktop it is the *system* browser; see the route
   * module).
   *
   * Depositing reaches no provider and writes no credential. The exchange runs later, in
   * `poll`, under the flow owner's own session, so a caller who learned a flow id can at
   * most put a code in front of that poll — and only by beating the provider's own redirect
   * to the flow's single deposit slot, after which what they left there stays inert unless
   * the owner's own session polls the flow.
   *
   * Refused for anything the depositor may not act on: an unknown, foreign or expired flow
   * (404, the same answer to each, so a flow id stays useless as a probe for what exists), a
   * flow opened in manual mode — which was handed no callback URL and therefore has no
   * redirect to receive — and a flow already carrying a code or already spent (409). The
   * check and the write are one synchronous step, so two redirects arriving together cannot
   * both deposit.
   */
  deposit(input: { flowId: string; projectId: string; code: string }): void {
    const flow = this.require({ ...input, userId: null });
    if (flow.mode !== "callback") {
      throw new HttpError(
        404,
        "model_oauth_flow_not_found",
        "This authorization has expired or does not exist. Start a new one.",
      );
    }
    if (flow.status !== "pending" || flow.verifier === null || flow.code !== null) {
      throw new HttpError(
        409,
        "model_oauth_flow_used",
        "This authorization has already been used. Start a new one in PenguinHarness.",
      );
    }
    flow.code = input.code;
  }

  /**
   * A flow's current state for its owner, redeeming a deposited code on the way. 404 for
   * anything the caller may not see — unknown, expired, or belonging to another user or
   * Project — so a flow id is never a probe for what exists.
   *
   * The redirect flow's exchange happens here rather than in the receiver, which is what
   * keeps writing a key into a Project behind that Project owner's session. `applied` is set
   * only on the call that actually redeemed, and is how the route knows to publish the
   * credential change; a deposited code nobody polls for is dropped with the flow at its TTL.
   */
  async poll(input: { flowId: string; userId: string; projectId: string }): Promise<{
    status: ModelOAuthStatus;
    provider: string;
    error?: ModelOAuthErrorCode;
    applied?: number;
  }> {
    const flow = this.require(input);
    // Reading the code and claiming it inside `redeem` is one synchronous stretch, so two
    // overlapping polls cannot both reach the exchange: the second finds nothing deposited
    // and reports the flow still pending, and the tick after that reports the outcome.
    const result = flow.code !== null ? await this.redeem(flow, flow.code) : null;
    return {
      status: flow.status,
      provider: flow.provider,
      ...(flow.errorCode !== undefined ? { error: flow.errorCode } : {}),
      ...(result?.ok === true ? { applied: result.applied } : {}),
    };
  }

  /**
   * Redeem a code the owner pasted — manual mode's counterpart to the redirect, and the
   * only redemption a caller asks for directly. The flow must be this user's, in the named
   * Project, inside its TTL and unspent.
   */
  async complete(input: {
    flowId: string;
    userId: string;
    projectId: string;
    code: string;
  }): Promise<{ ok: true; applied: number } | { ok: false; error: ModelOAuthErrorCode }> {
    return this.redeem(this.require(input), input.code);
  }

  /**
   * Spend a flow: redeem one code against its verifier and write the minted key onto the
   * group. Refuses a flow that is not still pending with a verifier in hand.
   *
   * One shot: everything that marks the flow as spent happens before the first await, so
   * two callers arriving together cannot both reach the exchange, and the verifier and the
   * deposited code leave memory as they are used. A key that arrives but cannot be stored is
   * reported as `apply_failed` — the user has to authorize again and delete the orphan, and
   * saying so is the only honest answer, since the provider reveals a key exactly once.
   */
  private async redeem(
    flow: Flow,
    code: string,
  ): Promise<{ ok: true; applied: number } | { ok: false; error: ModelOAuthErrorCode }> {
    const verifier = flow.verifier;
    if (flow.status !== "pending" || verifier === null) {
      throw new HttpError(
        409,
        "model_oauth_flow_used",
        "This authorization has already been completed. Start a new one.",
      );
    }
    flow.verifier = null;
    flow.code = null;
    const result = await exchangeCode({
      exchangeUrl: flow.exchangeUrl,
      code,
      verifier,
      fetchImpl: this.fetchImpl,
    });
    if (!result.ok) {
      flow.status = "error";
      flow.errorCode = result.error;
      return { ok: false, error: result.error };
    }
    let applied: number;
    try {
      applied = await this.applyGroupKey(flow.projectId, flow.provider, result.key);
    } catch {
      flow.status = "error";
      flow.errorCode = "apply_failed";
      return { ok: false, error: "apply_failed" };
    }
    flow.status = "done";
    return { ok: true, applied };
  }

  /**
   * The flow a caller may act on. 404 for anything they may not see — unknown, expired, or
   * belonging to another user or another Project — so a flow id is never a probe for what
   * exists.
   *
   * A `null` userId waives the user check and nothing else, and only `deposit` passes it
   * (see there): the flow id is then the credential. The Project and the TTL are checked
   * either way.
   */
  private require(input: { flowId: string; userId: string | null; projectId: string }): Flow {
    this.sweep();
    const flow = this.flows.get(input.flowId);
    if (
      flow === undefined ||
      (input.userId !== null && flow.userId !== input.userId) ||
      flow.projectId !== input.projectId ||
      flow.expiresAt <= this.now()
    ) {
      throw new HttpError(
        404,
        "model_oauth_flow_not_found",
        "This authorization has expired or does not exist. Start a new one.",
      );
    }
    return flow;
  }

  /** Drops flows past their TTL, verifier included. */
  private sweep(): void {
    const now = this.now();
    for (const [id, flow] of this.flows) {
      if (flow.expiresAt <= now) this.flows.delete(id);
    }
  }

  private evictOldest(userId: string, projectId: string): void {
    const mine = [...this.flows.values()]
      .filter((f) => f.userId === userId && f.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const flow of mine.slice(0, Math.max(0, mine.length - (MAX_FLOWS_PER_OWNER - 1)))) {
      this.flows.delete(flow.flowId);
    }
  }
}

/**
 * The session credential's two pure halves: the signed claims (auth/session-token.ts) and the
 * default-deny route table (auth/session-scope.ts), each row walked against the calls the
 * CLI makes from inside a Session.
 */
import { describe, expect, it } from "vitest";
import { checkClaims, sessionScope } from "../src/auth/session-scope.js";
import type { ScopeLookups } from "../src/auth/session-scope.js";
import { mintSessionToken, verifySessionToken } from "../src/auth/session-token.js";
import type { SessionClaims } from "../src/auth/session-token.js";

const claims: SessionClaims = { projectId: "p", agentId: "dev", sessionId: "s-own" };
const desk: SessionClaims = { ...claims, orgId: "acme" };

const lookups: ScopeLookups = {
  sessionOf: (id) =>
    ({
      "s-own": { projectId: "p", agentId: "dev" },
      "s-sibling": { projectId: "p", agentId: "dev" },
      "s-colleague": { projectId: "p", agentId: "ops" },
      "s-made": { projectId: "p", agentId: "ops" },
      "s-elsewhere": { projectId: "q", agentId: "dev" },
    })[id] ?? null,
  createdBy: (id) => (id === "s-made" ? "p/dev" : undefined),
};

const verdict = (method: string, url: string, who: SessionClaims = claims) => {
  const u = new URL(url, "http://x");
  return sessionScope(method, u.pathname, u.searchParams, who, lookups);
};

describe("session token", () => {
  it("round-trips its claims and refuses a tampered, foreign or malformed value", () => {
    const token = mintSessionToken("boot", desk);
    expect(verifySessionToken("boot", token)).toEqual(desk);
    expect(verifySessionToken("next-boot", token)).toBeNull();
    const [head, , mac] = token.split(".");
    const other = Buffer.from(JSON.stringify({ ...desk, agentId: "ceo" })).toString("base64url");
    expect(verifySessionToken("boot", `${head}.${other}.${mac}`)).toBeNull();
    expect(verifySessionToken("boot", "pst1.")).toBeNull();
    expect(verifySessionToken("boot", "boot")).toBeNull();
  });
});

describe("session scope", () => {
  it("allows the calls an Agent's own commands make", () => {
    for (const [method, url] of [
      ["GET", "/api/me"],
      ["GET", "/api/projects/p/organizations"],
      ["GET", "/api/projects/p/agents"],
      ["POST", "/api/projects/p/agents"],
      ["GET", "/api/projects/p/agents/ops/sessions"],
      ["POST", "/api/projects/p/agents/ops/sessions"],
      ["GET", "/api/projects/p/agents/dev/schedules"],
      ["DELETE", "/api/projects/p/agents/dev/schedules/daily"],
      ["GET", "/api/projects/p/usage"],
      ["POST", "/api/sessions/s-own/tasks"],
      ["GET", "/api/sessions/s-sibling/stream"],
      ["GET", "/api/sessions/s-made/messages"],
      ["GET", "/api/telemetry?session=s-own&view=samples"],
    ] as const) {
      expect(verdict(method, url).kind, `${method} ${url}`).toBe("allow");
    }
  });

  it("refuses everything else, and what the rows narrow away", () => {
    for (const [method, url] of [
      ["GET", "/api/admin/users"],
      ["PUT", "/api/admin/settings"],
      ["GET", "/api/projects"],
      ["GET", "/api/projects/q/agents"],
      ["GET", "/api/projects/p/models"],
      ["GET", "/api/projects/p/agents/dev/config"],
      ["GET", "/api/projects/p/agents/ops/schedules"],
      ["GET", "/api/sessions/s-colleague"],
      ["GET", "/api/sessions/s-elsewhere/messages"],
      ["GET", "/api/sessions/s-missing"],
      ["GET", "/api/telemetry"],
      ["GET", "/api/telemetry?session=s-colleague"],
      ["DELETE", "/api/telemetry"],
      ["GET", "/server/m1/api/me"],
    ] as const) {
      expect(verdict(method, url).kind, `${method} ${url}`).toBe("deny");
    }
  });

  it("session lists are filtered, creations adopted", () => {
    expect(verdict("GET", "/api/projects/p/agents/ops/sessions")).toMatchObject({
      filterSessions: true,
    });
    expect(verdict("POST", "/api/projects/p/agents/ops/sessions")).toMatchObject({
      adoptCreated: true,
    });
  });

  it("an organization row: own org for a desk, the caller's claims checked", () => {
    expect(verdict("GET", "/api/projects/p/organizations/other/tickets", desk).kind).toBe("deny");
    expect(verdict("GET", "/api/projects/p/organizations/acme/tickets", desk)).toMatchObject({
      kind: "allow",
      claims: "caller",
    });
    // A Session working for no organization reaches the Project's (company-setup).
    expect(verdict("POST", "/api/projects/p/organizations/other/employees").kind).toBe("allow");
    for (const rest of ["employees", "calendar", "tickets/t1/start", "proposals/7/implement"]) {
      expect(
        verdict("POST", `/api/projects/p/organizations/acme/${rest}`, desk),
        rest,
      ).toMatchObject({ claims: "caller-session" });
    }
  });

  it("claims: own Agent and sessions pass; another's, or a write with none, do not", () => {
    expect(checkClaims({ agentId: "dev", sessionId: "s-own" }, claims, lookups, true)).toBeNull();
    expect(checkClaims({ sessionId: "s-made" }, claims, lookups, true)).toBeNull();
    expect(checkClaims({}, claims, lookups, false)).toBeNull();
    expect(checkClaims({ agentId: "ops" }, claims, lookups, false)).not.toBeNull();
    expect(checkClaims({ sessionId: "s-colleague" }, claims, lookups, true)).not.toBeNull();
    expect(checkClaims({}, claims, lookups, true)).not.toBeNull();
  });
});

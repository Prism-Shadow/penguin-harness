/**
 * A server behind the package's fetch fake ({@link stubFetch}) for the Project dialogs' suites:
 * the signed-in admin, one Project the admin owns, and the Project's settings the dialog reads
 * — its name, its members, its chat defaults and models, and its command policy, which a PUT
 * replaces and echoes the way the real route does. A test can refuse the next policy PUT.
 */
import type {
  CommandPolicyDto,
  CommandPolicyRuleDto,
  ProjectSummary,
} from "@prismshadow/penguin-server/api";
import { ADMIN_ME } from "./admin-settings";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch } from "./fetch";

export const PROJECT: ProjectSummary = {
  projectId: "p1",
  name: "Research",
  role: "owner",
  ownerUserId: "admin",
  createdAt: "2026-01-01T00:00:00Z",
};

export const FACTORY_RULE: CommandPolicyRuleDto = {
  name: "no-rm-root",
  pattern: "rm -rf /",
  enabled: true,
};

export interface ProjectSettingsServer {
  fetch: FakeFetch;
  /** The policy the server holds now. */
  policy(): CommandPolicyDto;
  /** The bodies of every policy PUT, oldest first. */
  policyPuts(): unknown[];
  /** The next policy PUT answers this error instead of storing. */
  refuseNextPolicy(): void;
}

export function projectSettingsServer(): ProjectSettingsServer {
  let policy: CommandPolicyDto = {
    enabled: true,
    rules: [FACTORY_RULE],
    defaultRules: [FACTORY_RULE],
  };
  let refuse = false;
  const puts: unknown[] = [];
  const fetch = stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects" && req.method === "GET") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/projects/p1/members") {
      return json({ members: [{ userId: "admin", role: "owner" }] });
    }
    if (req.path === "/api/projects/p1/chat-defaults") return json({});
    if (req.path === "/api/projects/p1/models") return json({ providers: {}, models: [] });
    if (req.path === "/api/projects/p1/command-policy" && req.method === "GET") {
      return json(policy);
    }
    if (req.path === "/api/projects/p1/command-policy" && req.method === "PUT") {
      puts.push(req.body);
      if (refuse) {
        refuse = false;
        return apiError(500, "internal", "refused by the test");
      }
      const body = req.body as { enabled: boolean; rules: CommandPolicyRuleDto[] };
      policy = { ...policy, enabled: body.enabled, rules: body.rules };
      return json(policy);
    }
    return apiError(404, "not_found");
  });
  return {
    fetch,
    policy: () => policy,
    policyPuts: () => puts,
    refuseNextPolicy: () => {
      refuse = true;
    },
  };
}

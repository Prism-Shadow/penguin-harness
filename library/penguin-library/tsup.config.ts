import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/agent-api/agent-api-repo.ts","src/agent-api/agent-api.ts","src/agent-api/index.ts","src/auth/account-data.ts","src/auth/auth.ts","src/auth/index.ts","src/auth/repos/auth-sessions.ts","src/auth/repos/background-images.ts","src/auth/repos/index.ts","src/auth/repos/user-drafts.ts","src/auth/repos/users.ts","src/db/database.ts","src/db/index.ts","src/db/migrations/index.ts","src/db/migrations/runner.ts","src/db/schema.ts","src/machine/browser-extensions.ts","src/machine/builtin-browser-vocab.ts","src/machine/index.ts","src/machine/machine.ts","src/messaging/index.ts","src/messaging/messaging.ts","src/messaging/repos/index.ts","src/messaging/repos/messaging-bindings.ts","src/messaging/repos/messaging-conversations.ts","src/model/index.ts","src/model/model.ts","src/model/repos/model-promotions.ts","src/model/repos/model-provider-auth-tokens.ts","src/observability/index.ts","src/observability/observability.ts","src/observability/repos/errors.ts","src/observability/repos/index.ts","src/observability/repos/usage.ts","src/organization/index.ts","src/organization/organization.ts","src/organization/organizations.ts","src/project/index.ts","src/project/project.ts","src/project/repos/agents.ts","src/project/repos/index.ts","src/project/repos/members.ts","src/project/repos/projects.ts","src/session/index.ts","src/session/repos/index.ts","src/session/repos/schedules.ts","src/session/repos/sessions.ts","src/session/session.ts","src/setting/attachment-limits.ts","src/setting/index.ts","src/setting/repos/index.ts","src/setting/repos/server-settings.ts","src/setting/repos/ui-prefs.ts","src/setting/setting.ts","src/trace/index.ts","src/trace/repos/index.ts","src/trace/repos/trace-index.ts","src/trace/trace.ts","src/workbench/index.ts","src/workbench/workbench.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});

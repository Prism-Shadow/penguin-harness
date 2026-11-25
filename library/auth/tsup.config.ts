import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/account-data.ts",
    "src/api-token.ts",
    "src/auth.ts",
    "src/auth-token.ts",
    "src/index.ts",
    "src/initial-password.ts",
    "src/live-streams.ts",
    "src/middleware.ts",
    "src/password.ts",
    "src/require-human.ts",
    "src/reset-admin-password.ts",
    "src/runtime-state.ts",
    "src/service.ts",
    "src/repos/auth-sessions.ts",
    "src/repos/background-images.ts",
    "src/repos/index.ts",
    "src/repos/user-drafts.ts",
    "src/repos/users.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});

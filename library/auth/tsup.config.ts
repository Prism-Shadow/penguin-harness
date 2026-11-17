import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/account-data.ts", "src/auth.ts", "src/index.ts", "src/repos/auth-sessions.ts", "src/repos/background-images.ts", "src/repos/index.ts", "src/repos/user-drafts.ts", "src/repos/users.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});

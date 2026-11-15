import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/identity.ts", "src/repos/users.ts", "src/repos/auth-sessions.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});

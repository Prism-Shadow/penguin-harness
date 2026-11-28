/**
 * The auth service moved to the auth domain library package
 * (@prismshadow/penguin-library-auth/service, services+routes restack S21) — it speaks the
 * library's vocabulary and structural ports. This file keeps the assembly: the Provider binds
 * the service's ports to the server's capabilities, and re-exports the moved shapes for the
 * server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { AuthState, Clock, Config } from "../hmr/capabilities.js";
import type { Auth, AuthSessions, Users } from "@prismshadow/penguin-library-auth";
import type { PasswordHasher } from "@prismshadow/penguin-library-auth/password";
import { AuthService, InitialProjectProvisioner } from "@prismshadow/penguin-library-auth/service";

export * from "@prismshadow/penguin-library-auth/service";

/** The auth assembly: binds the service's ports (the kernel does not inject @Use on a hand-built instance). */
@Module()
export class AuthServiceProvider {
  @Use() private readonly users!: Users;
  @Use() private readonly authSessions!: AuthSessions;
  /** Process-scoped auth values; the RUNTIME holds it so a printed link survives a push. */
  @Use() private readonly state!: AuthState;
  @Use() private readonly config!: Config;
  @Use() private readonly clock!: Clock;
  @Use() private readonly hasher!: PasswordHasher;
  /** Provisions the initial Project at signup — the Project domain provides it. */
  @Use() private readonly provisioner!: InitialProjectProvisioner;
  @Provide() service!: AuthService;
  @Provide() auth!: Auth;

  setup() {
    this.service = Object.assign(new AuthService(), {
      users: this.users,
      authSessions: this.authSessions,
      state: this.state,
      config: this.config,
      clock: this.clock,
      hasher: this.hasher,
      provisioner: this.provisioner,
    });
    this.auth = this.service;
  }
}

/**
 * Where PenguinHarness lives on a machine, as a function of this instance's PROFILE.
 *
 * The desktop shell runs as one of two profiles — release, or the dev instance that runs
 * beside it on its own data root (`packages/desktop/src/app-identity.ts`) — and the shell
 * hands that choice to its server as `PENGUIN_PROFILE`. A profile names a data-root family,
 * and it holds on every machine the instance touches: a dev instance installs to, starts,
 * probes and connects to a machine's DEV installation, never the release one there — so a
 * connect from the dev instance cannot stop the release server a person is using on that
 * machine, and the two keep separate Agents, Sessions and pushed versions on both ends.
 *
 * Both the program directory and the data root are separate per profile, so an install
 * from the dev instance never replaces the program the release server there is running.
 * The data root sits inside the program directory as the installer lays it out
 * (`<program>/data`), and each profile's server is told its root explicitly rather than
 * left to the default — the remote's own overrides are invisible over a non-interactive ssh.
 *
 * The port is fixed per profile for the reason the release one is (core's ports.ts): a
 * forward's local port equals its remote port, so the two profiles need distinct numbers.
 *
 * Pure, and the only place either path is spelled: every command in this directory takes a
 * layout rather than naming `~/.penguin` itself.
 */
import { DEFAULT_DEV_SERVER_PORT, DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";

export type Profile = "release" | "dev";

export interface RemoteLayout {
  profile: Profile;
  /** The installer's target (`PENGUIN_INSTALL_DIR`), in each shell's own spelling. */
  programDir: { posix: string; win: string };
  /** The server's data root there (`PENGUIN_HOME`), in each shell's own spelling. */
  dataRoot: { posix: string; win: string };
  /** The port the server is started on when this side has not remembered one. */
  defaultPort: number;
}

/** `PENGUIN_PROFILE=dev` selects the dev profile; anything else is release. */
export function profileFromEnv(env: NodeJS.ProcessEnv): Profile {
  return env.PENGUIN_PROFILE?.trim() === "dev" ? "dev" : "release";
}

export function remoteLayoutFor(profile: Profile): RemoteLayout {
  const dir = profile === "dev" ? ".penguin-dev" : ".penguin";
  return {
    profile,
    programDir: { posix: `$HOME/${dir}`, win: `%USERPROFILE%\\${dir}` },
    dataRoot: { posix: `$HOME/${dir}/data`, win: `%USERPROFILE%\\${dir}\\data` },
    defaultPort: profile === "dev" ? DEFAULT_DEV_SERVER_PORT : DEFAULT_SERVER_PORT,
  };
}

/** The layout this process reaches machines with. */
export function currentRemoteLayout(env: NodeJS.ProcessEnv = process.env): RemoteLayout {
  return remoteLayoutFor(profileFromEnv(env));
}

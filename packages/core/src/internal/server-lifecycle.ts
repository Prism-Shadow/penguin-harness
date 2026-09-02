/**
 * The exit code with which the server asks its supervisor to relaunch it: the process
 * contract between `penguin server|web`, which runs the service as a child process and
 * respawns it on exactly this code, and the server's `POST /api/version/restart`, which
 * exits with it after a graceful shutdown once a self-update has been installed — so the
 * relaunch runs the new release. Lives in core because both sides import core and neither
 * may import the other's internals. 75 is BSD's EX_TEMPFAIL ("try again"), clear of every
 * code the server otherwise exits with (0, 1, and 3 for "already running").
 */
export const SERVER_RESTART_EXIT_CODE = 75;

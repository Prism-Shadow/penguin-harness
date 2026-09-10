#!/bin/sh
# Container entrypoint: make the data root writable by the runtime user, then drop to it.
#
# The container starts as root purely so a bind mount from the host does not have to be
# chowned on the host first. Only the TOP LEVEL of the data root is touched: a root that
# has accumulated a year of Traces must not be walked on every boot, and a recursive chown
# would rewrite files a host user deliberately owns.
#
# Running the container with `--user` (compose: `user:`) skips all of this — the script is
# not root, so it just execs the command and the caller owns the mount.
set -eu

data_root="${PENGUIN_HOME:-/data}"

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p "$data_root"
  # A host directory already carrying uid 1000 is left exactly as it is, which also lets
  # the container start on a mount that refuses chown altogether (some network filesystems).
  if [ "$(stat -c %u "$data_root")" != "1000" ]; then
    chown 1000:1000 "$data_root"
  fi
  # setpriv execs in place, so the server keeps tini's direct child slot and SIGTERM
  # reaches it without a relay. --init-groups replaces root's supplementary groups with
  # the ones /etc/group gives uid 1000.
  exec setpriv --reuid=1000 --regid=1000 --init-groups -- "$@"
fi

exec "$@"

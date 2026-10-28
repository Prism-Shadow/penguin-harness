"""Trusted GDPevo service bootstrap and non-root readiness probe; no task scoring.

Mounted read-only by isolation.py. The service opens its own private log after
dropping identity. The PID-1 supervisor reports failures to Docker's log stream.
"""

import json
import os
import pwd
import shlex
import signal
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

LOG = Path("/opt/gdpevo/log/service.log")


def account():
    user = pwd.getpwnam("taskenv")
    if user.pw_uid == 0 or user.pw_gid == 0:
        raise ValueError("taskenv must have a non-root uid and gid")
    return user


def logs():
    with LOG.open("rb") as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 65536))
        sys.stdout.buffer.write(stream.read(65536))


def serve():
    user = account()
    if os.getuid() != 0:
        raise ValueError("The trusted supervisor must start as root before dropping service identity")
    # PID 1 exiting also terminates its private PID namespace. Container removal
    # remains the host's final cancellation boundary; no CAP_KILL is required.
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda number, _frame: sys.exit(128 + number))
    child = subprocess.Popen([sys.executable, __file__, "service"],
                             user=user.pw_uid, group=user.pw_gid, extra_groups=[])
    code = child.wait()
    print(f"GDPevo service exited with code {code}", file=sys.stderr, flush=True)
    subprocess.run([sys.executable, __file__, "logs"], user=user.pw_uid,
                   group=user.pw_gid, extra_groups=[], timeout=3)
    raise SystemExit(code if 0 < code < 256 else 1)


def service():
    user = account()
    if (os.getuid(), os.getgid()) != (user.pw_uid, user.pw_gid):
        raise ValueError("Only taskenv may open the service log")
    if os.environ["GDPEVO_ENV_DIR"] != "/opt/gdpevo/env":
        raise ValueError("Unsupported GDPevo service directory")
    # Opening here, after setuid in Popen, needs no DAC_OVERRIDE capability.
    with LOG.open("ab", buffering=0) as stream:
        os.dup2(stream.fileno(), 1)
        os.dup2(stream.fileno(), 2)
    os.chdir(os.environ["GDPEVO_ENV_DIR"])
    env = {**os.environ, "TASK_ENV_BIND": "127.0.0.1", "TASK_ENV_HOST": "127.0.0.1",
           "TASK_ENV_PORT": os.environ["GDPEVO_PORT"], "PORT": os.environ["GDPEVO_PORT"],
           "TASK_ENV_ENABLE_JUDGE": "0", "TASK_GROUP_ROOT": "/opt/gdpevo/task_group"}
    argv = shlex.split(os.environ["GDPEVO_START_CMD"])
    if not argv:
        raise ValueError("Missing GDPevo service command")
    os.execvpe(argv[0], argv, env)


def probe(port, health):
    user = account()
    if (os.getuid() in (0, user.pw_uid) or os.getgid() in (0, user.pw_gid)
            or user.pw_gid in os.getgroups()):
        raise ValueError("Role identity overlaps the private business service")
    try:
        list(Path("/opt/gdpevo/env").iterdir())
    except PermissionError:
        pass
    else:
        raise ValueError("Private business service is accessible to the role")
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = "http://127.0.0.1:" + str(int(port))
    try:
        with client.open(base + health, timeout=1) as response:
            if response.status != 200:
                return 75
    except (OSError, urllib.error.URLError):
        return 75  # Startup still pending; the host checks deadline and container exit.
    # Empty request only: no candidate answer or grading input is submitted.
    request = urllib.request.Request(base + "/api/judge", data=b"{}",
                                     headers={"Content-Type": "application/json"})
    try:
        with client.open(request, timeout=1):
            raise ValueError("Training judge must be unavailable during construction")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise ValueError(f"Training judge was not disabled: HTTP {error.code}") from error
    print(json.dumps({"ready": True, "service": "gdpevo", "judge_disabled": True,
                      "private_environment_denied": True, "uid": os.getuid(), "gid": os.getgid()}))
    return 0


if __name__ == "__main__":
    try:
        mode = sys.argv[1]
        if mode == "serve":
            serve()
        elif mode == "service":
            service()
        elif mode == "logs":
            logs()
        elif mode == "probe":
            raise SystemExit(probe(*sys.argv[2:]))
        else:
            raise ValueError("Unknown bootstrap operation")
    except Exception as error:
        print(f"GDPevo startup: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        raise SystemExit(78)

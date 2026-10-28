"""Docker boundary shared by OpenSkill role tools and executor-owned measurements.

The host is trusted. No role receives the Docker socket, host credentials, journal,
SDK state or another role's workspace. An unavailable boundary is an error.
"""

import json
import fcntl
import hashlib
import os
import selectors
import signal
import stat
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from artifacts import require


def stamp():
    return datetime.now(timezone.utc).isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def regular(root, relative):
    """Reject links (including hard links), devices and traversal before crossing roles."""
    rel = Path(relative)
    require(not rel.is_absolute() and rel.parts and ".." not in rel.parts, "Expected a relative file path")
    cursor = root
    require(not root.is_symlink(), "Linked staging root")
    for part in rel.parts:
        cursor = cursor / part
        require(not cursor.is_symlink(), f"Linked artifact: {relative}")
    info = cursor.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, f"Not an unlinked regular file: {relative}")
    require(cursor.resolve().is_relative_to(root.resolve()), "Artifact escapes its root")
    return cursor


def copy_files(source, destination, names):
    require(len(names) == len(set(names)), "Duplicate artifact paths")
    for name in names:
        origin = regular(source, name)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        require(not target.exists() and not target.is_symlink(), "Never overwrite staged evidence")
        target.write_bytes(origin.read_bytes())
        target.chmod(0o644 | (origin.stat().st_mode & 0o111))


def files(root):
    require(root.is_dir() and not root.is_symlink(), "Missing or linked artifact directory")
    found = []
    for entry in sorted(root.rglob("*")):
        require(not entry.is_symlink(), "Linked artifact directory or file")
        if not entry.is_dir():
            name = entry.relative_to(root).as_posix()
            regular(root, name)
            found.append(name)
    require(found, "Empty artifact directory")
    return found


class Interrupted(RuntimeError):
    pass


class CleanupFailed(RuntimeError):
    pass


@contextmanager
def launch_lock(control):
    """Serialize container creation with STOP's final inventory and removal."""
    control.mkdir(parents=True, exist_ok=True)
    with (control / ".launch.lock").open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def capture(argv, timeout=3, limit=65536):
    """Bound diagnostic duration and bytes, even for an arbitrarily long log line."""
    data = {"stdout": bytearray(), "stderr": bytearray()}
    clipped, timed_out = False, False
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    until = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            for key in data:
                selector.register(getattr(process, key), selectors.EVENT_READ, key)
            while selector.get_map():
                remaining = until - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                for event, _ in selector.select(min(remaining, 0.1)):
                    chunk = os.read(event.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(event.fileobj)
                        continue
                    target = data[event.data]
                    available = limit - len(target)
                    target.extend(chunk[:available])
                    if len(chunk) > available:
                        clipped = True
                if clipped:
                    break
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()
        process.stdout.close()
        process.stderr.close()
    return {**{k: bytes(v).decode("utf-8", errors="replace") for k, v in data.items()},
            "exit_code": process.returncode, "truncated": clipped, "timed_out": timed_out}


class Boundary:
    def __init__(self, config, control, work, readonly, deadline, stop, *, targets=None,
                 allow_stopped=False, stop_digest=None):
        self.config = config
        self.control = control
        self.work = work.resolve()
        self.readonly = [p.resolve() for p in readonly]
        self.targets = {Path(source).resolve(): Path(target) for source, target in (targets or {}).items()}
        # A controlled continuation may run while the original STOP is retained,
        # but it must pin that exact stop record and refuse if it is removed or
        # rewritten. Ordinary roles never set this allowance.
        self.allow_stopped = allow_stopped
        self.stop_digest = stop_digest
        sources = [self.work, *self.readonly]
        require(set(self.targets).issubset(sources), "Mount targets must refer to declared sources")
        destinations = [self.targets.get(source, source) for source in sources]
        require(all(target.is_absolute() and ".." not in target.parts and "," not in str(target)
                    for target in destinations), "Invalid container mount target")
        require(len(set(destinations)) == len(destinations), "Duplicate container mount target")
        self.cwd = self.targets.get(self.work, self.work)
        self.readonly_targets = [self.targets.get(source, source) for source in self.readonly]
        require(not any(self.cwd == target or self.cwd.is_relative_to(target)
                        for target in self.readonly_targets), "Writable mount cannot shadow a read-only mount")
        self.deadline = datetime.fromisoformat(deadline).timestamp()
        self.stop = stop
        self.name = "openskill-" + uuid.uuid4().hex
        self.docker = config["docker"]
        self.record = control / (self.name + ".json")
        self.uid = config["uid"]
        self.gid = config["gid"]
        require(type(self.uid) is int and self.uid > 0 and type(self.gid) is int and self.gid > 0,
                "Role tools must run as a non-root uid and gid")
        for path in [self.work, *self.readonly]:
            require(path.is_dir() and "," not in str(path), "Invalid container mount")
        for left in [self.work, *self.readonly]:
            for right in [self.work, *self.readonly]:
                require(left == right or not left.is_relative_to(right), "Overlapping role mounts")

    def check(self):
        if self.stop.exists():
            if not self.allow_stopped:
                raise Interrupted("Experiment STOP fence is set")
            if self.stop_digest is not None and hashlib.sha256(self.stop.read_bytes()).hexdigest() != self.stop_digest:
                raise Interrupted("Experiment STOP record changed during controlled continuation")
        elif self.allow_stopped and self.stop_digest is not None:
            raise Interrupted("Experiment STOP record was removed during controlled continuation")
        if time.time() >= self.deadline:
            raise Interrupted("Construction deadline reached")

    def docker_call(self, args):
        return subprocess.run([self.docker, *args], text=True, capture_output=True, timeout=30, check=True)

    def __enter__(self):
        self.check()
        image = self.config["image"]
        require(image.startswith("sha256:") and len(image) == 71, "Pin the local sanitized image by its sha256 id")
        inspected = json.loads(self.docker_call(["image", "inspect", image]).stdout)[0]
        self.check()
        require(inspected["Id"] == image, "Image identity changed")
        profile = self.config.get("startup_profile")
        require(profile in (None, "gdpevo"), "Unknown startup_profile")
        env = dict(item.split("=", 1) for item in inspected["Config"].get("Env", []) if "=" in item)
        if profile == "gdpevo":
            require(not self.config.get("entrypoint") and not self.config.get("command"),
                    "gdpevo startup owns entrypoint and command")
            require(env.get("GDPEVO_ENV_DIR") == "/opt/gdpevo/env" and env.get("GDPEVO_START_CMD"),
                    "The gdpevo profile requires a reviewed GDPevo image")
            port, health = env.get("GDPEVO_PORT", ""), env.get("GDPEVO_HEALTH_PATH", "")
            require(port.isdigit() and 1024 <= int(port) <= 65535 and health.startswith("/")
                    and not health.startswith("//") and not any(c.isspace() for c in health), "Invalid service endpoint")
        elif "GDPEVO_ENV_DIR" in env and not self.config.get("entrypoint"):
            raise ValueError("GDPevo images require startup_profile: gdpevo")
        timeout = self.config.get("startup_timeout_seconds", 120)
        require(type(timeout) in (int, float) and 0 < timeout <= 300, "Invalid startup timeout")
        record = {"container": self.name, "status": "starting", "image": image,
                           "work": str(self.work), "readonly": list(map(str, self.readonly)),
                           "mount_targets": {str(source): str(self.targets.get(source, source))
                                             for source in [self.work, *self.readonly]},
                           "startup_profile": profile, "started_at": stamp()}
        args = ["run", "--detach", "--name", self.name, "--label", "openskill.control=" + str(self.control),
                "--network", "none", "--ipc", "private", "--cap-drop", "ALL",
                "--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID",
                "--security-opt", "no-new-privileges", "--pids-limit", "256",
                "--memory", self.config.get("memory", "4g"), "--cpus", str(self.config.get("cpus", 2)),
                "--mount", f"type=bind,src={self.work},dst={self.cwd}"]
        for path in self.readonly:
            args += ["--mount", f"type=bind,src={path},dst={self.targets.get(path, path)},readonly"]
        node = Path(self.config["node"]).resolve()
        require(node.is_file() and "," not in str(node), "Missing Node executable")
        args += ["--mount", f"type=bind,src={node},dst=/opt/openskill-node,readonly"]
        if profile == "gdpevo":
            bootstrap = Path(__file__).with_name("gdpevo_start.py").resolve()
            args += ["--mount", f"type=bind,src={bootstrap},dst=/opt/openskill-startup.py,readonly",
                     "--entrypoint", "/usr/local/bin/python3", image, "/opt/openskill-startup.py", "serve"]
            record["bootstrap_sha256"] = hashlib.sha256(bootstrap.read_bytes()).hexdigest()
        elif self.config.get("entrypoint"):
            args += ["--entrypoint", self.config["entrypoint"]]
        if profile != "gdpevo":
            args += [image, *self.config.get("command", [])]
        try:
            with launch_lock(self.control):
                self.check()
                # STOP cannot finish its inventory between this record and creation.
                save(self.record, record)
                self.docker_call(args)
            # Verify the real SDK worker identity, effective privileges and mount permissions.
            check = ("const fs=require('fs');const p=require('path');"
                     f"if(process.getuid()!=={self.uid}||process.getgid()!=={self.gid})throw Error('Role identity changed');"
                     "const status=fs.readFileSync('/proc/self/status','utf8');"
                     "if(!/^CapEff:\\s+0+$/m.test(status)||!/^NoNewPrivs:\\s+1$/m.test(status))throw Error('Role privileges');"
                     "const f=p.join(process.cwd(),'.openskill-probe-'+require('crypto').randomUUID());"
                     "fs.writeFileSync(f,'probe',{flag:'wx'});fs.unlinkSync(f);"
                     f"for(const root of {json.dumps(list(map(str, self.readonly_targets)))}){{"
                     "let writable=true;try{fs.accessSync(root,fs.constants.W_OK)}catch{writable=false}"
                     "if(writable)throw Error('Writable input mount');}process.stdout.write('ready');")
            probe = self.docker_call(self.exec_argv([
                "/opt/openskill-node", "-e", check])[1:])
            require(probe.stdout == "ready", "Non-root file worker preflight failed")
            if profile == "gdpevo":
                until = min(time.time() + timeout, self.deadline)
                while True:
                    self.check()
                    state = json.loads(self.docker_call(["inspect", "--format", "{{json .State}}", self.name]).stdout)
                    require(state["Running"], f"Business service exited before readiness: {state}")
                    probe = subprocess.run(self.exec_argv(["python3", "/opt/openskill-startup.py", "probe", port, health]),
                                           capture_output=True, text=True, timeout=min(5, max(0.01, until - time.time())))
                    if probe.returncode == 0:
                        break
                    require(probe.returncode == 75, "Business isolation probe failed: " + probe.stderr[-4000:])
                    require(time.time() < until, "Business service readiness deadline reached")
                    time.sleep(min(0.1, max(0, until - time.time())))
                record = json.loads(self.record.read_text())
                record["service_probe"] = json.loads(probe.stdout)
                save(self.record, record)
            self.check()
            record = json.loads(self.record.read_text())
            record.update(status="ready", ready_at=stamp())
            save(self.record, record)
            return self
        except BaseException as error:
            try:
                record = json.loads(self.record.read_text()) if self.record.exists() else record
                record["startup_error"] = {"type": type(error).__name__, "message": str(error)[-4000:],
                    "stderr": str(getattr(error, "stderr", "") or "")[-65536:]}
                save(self.record, record)
            finally:
                self.close()
            raise

    def exec_argv(self, argv, cwd=None):
        return [self.docker, "exec", "-i", "--user", f"{self.uid}:{self.gid}",
                "--workdir", str(cwd or self.cwd), self.name, "/usr/bin/env", "-i",
                "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8",
                "PYTHONDONTWRITEBYTECODE=1", "PYTEST_DISABLE_PLUGIN_AUTOLOAD=1", *argv]

    def run(self, argv, log, cwd=None):
        """Capture a real process result; cancellation kills all container descendants."""
        self.check()
        started = stamp()
        status, code = "interrupted", None
        log.parent.mkdir(parents=True, exist_ok=True)
        process = None
        try:
            with log.open("wb") as output:
                output.write((json.dumps({"argv": argv, "started_at": started}) + "\n").encode())
                output.flush()
                process = subprocess.Popen(self.exec_argv(argv, cwd), stdout=output, stderr=subprocess.STDOUT,
                                           start_new_session=True)
                while process.poll() is None:
                    self.check()
                    try:
                        process.wait(timeout=0.2)
                    except subprocess.TimeoutExpired:
                        pass
                self.check()
                code, status = process.returncode, "completed"
        finally:
            if process and process.poll() is None:
                self.close()
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass  # docker exec can exit while container removal completes.
                process.wait()
            save(log.with_suffix(".process.json"), {"argv": argv, "started_at": started,
                 "finished_at": stamp(), "execution_status": status, "exit_code": code})
        return json.loads(log.with_suffix(".process.json").read_text())

    def close(self):
        # Only our random, labelled container can be removed; no daemon-wide cleanup.
        try:
            stop_container(self.docker, self.control, self.name)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            self.stop.write_text("Container cleanup is unconfirmed; do not continue.\n")
            raise CleanupFailed(f"Could not confirm shutdown of {self.name}") from exc
        if self.record.exists():
            record = json.loads(self.record.read_text())
            record.update(status="stopped", stopped_at=stamp())
            save(self.record, record)

    def __exit__(self, *_):
        self.close()


@contextmanager
def finish_cleanup_before_signal():
    """Defer CLI cancellation across the whole cleanup transaction, then deliver it."""
    pending, previous = [], {}
    if threading.current_thread() is threading.main_thread():
        for sig in (signal.SIGTERM, signal.SIGINT):
            handler = signal.getsignal(sig)
            if handler != signal.SIG_IGN:
                previous[sig] = handler
                signal.signal(sig, lambda number, frame: pending.append((number, frame)))
    completed = False
    try:
        yield
        completed = True
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        # Preserve a cleanup failure rather than masking it with cancellation.
        if pending and completed:
            number, frame = pending[0]
            handler = previous[number]
            if callable(handler):
                handler(number, frame)
            else:
                os.kill(os.getpid(), number)


def stop_container(docker, control, name):
    require(name.startswith("openskill-") and len(name) == 42, "Invalid owned container name")
    control.mkdir(parents=True, exist_ok=True)
    with finish_cleanup_before_signal():
        with (control / (name + ".stop.lock")).open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            _stop_container(docker, control, name)


def _stop_container(docker, control, name):
    result = subprocess.run([docker, "inspect", name], text=True, capture_output=True, timeout=30)
    if result.returncode:
        # A missing container is fine; an unavailable daemon is not a confirmed stop.
        subprocess.run([docker, "info", "--format", "{{.ID}}"], capture_output=True, timeout=30, check=True)
        return
    info = json.loads(result.stdout)[0]
    require(info["Config"].get("Labels", {}).get("openskill.control") == str(control),
            "Refusing to stop an unowned container")
    # Serialize evidence capture with removal, including STOP racing worker cleanup.
    # Never persist Config.Env, which may contain credentials in a misconfigured image.
    diagnostics = control / "diagnostics" / (name + ".json")
    cancellation = None
    try:
        if not diagnostics.exists():
            evidence = {"captured_at": stamp(), "state": info["State"],
                        "container_logs": capture([docker, "logs", "--tail", "100", name])}
            record = json.loads((control / (name + ".json")).read_text())
            if record.get("startup_profile") == "gdpevo" and info["State"]["Running"]:
                evidence["service_log"] = capture([docker, "exec", "--user", "taskenv", name,
                                                   "python3", "/opt/openskill-startup.py", "logs"])
                if evidence["service_log"]["exit_code"] != 0:
                    # The service can exit after the first snapshot. Its supervisor
                    # then relays the private log to Docker; collect that final stream.
                    evidence["state_recheck"] = capture([docker, "inspect", "--format", "{{json .State}}", name])
                    evidence["container_logs_recheck"] = capture([docker, "logs", "--tail", "100", name])
            save(diagnostics, evidence)
    except Exception:
        pass  # Diagnostic failures must never block mandatory container removal.
    except BaseException as error:
        # SIGTERM/KeyboardInterrupt must still remove the container, then propagate
        # cancellation so a cancelled operation cannot be registered as completed.
        cancellation = error
    removed = subprocess.run([docker, "rm", "--force", "--volumes", name], capture_output=True, timeout=30)
    if removed.returncode:
        # STOP and a worker's finally can remove the same container concurrently.
        absent = subprocess.run([docker, "inspect", name], capture_output=True, timeout=30)
        if absent.returncode:
            subprocess.run([docker, "info", "--format", "{{.ID}}"], capture_output=True, timeout=30, check=True)
        else:
            removed.check_returncode()
    record_path = control / (name + ".json")
    if record_path.exists():
        record = json.loads(record_path.read_text())
        record.update(status="stopped", stopped_at=stamp())
        save(record_path, record)
    if cancellation is not None:
        raise cancellation

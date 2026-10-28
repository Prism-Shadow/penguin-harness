"""Execute OpenSkill construction through isolated roles; never launch target scoring.

Usage: executor.py preflight|init|event|creator|verifier-plan|verifier OUT REQUEST.json
       executor.py resume-delivery|resume-verifier OUT REQUEST.json
       executor.py status|next|stop|recover OUT
The trusted controller owns retrieval, semantic review and final deployment. Workers
cannot mutate this journal. One executor operation owns OUT at a time.
"""

import argparse
import fcntl
import hashlib
import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Installed Skill bytes are versioned artifacts; do not add Python cache files there.
sys.dont_write_bytecode = True

import experiment
import oracle
import recovery
from artifacts import digest, identifier, read_json, require, strings, tree
from isolation import Boundary, CleanupFailed, Interrupted, copy_files, files, launch_lock, regular, save, stamp, stop_container
from runtime import check_runtime

HERE = Path(__file__).resolve().parent
MODE = "isolated-v1"


class RoleFailed(ValueError):
    def __init__(self, result, record):
        super().__init__(f"Role did not finish ({result.get('error_code', 'unknown')}); inspect {record / 'launcher.log'}")
        self.code = result.get("error_code", "unknown")


class DeliveryFailed(ValueError):
    pass


class ResearchIntegrityFailed(ValueError):
    pass


@contextmanager
def lock(out):
    out.mkdir(parents=True, exist_ok=True)
    with (out / ".executor.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("Another executor owns this experiment; use stop to cancel it") from exc
        yield


def event(out, action, **fields):
    return experiment.run("event", out, {"action": action, **fields}, executor=True)


def settings(state):
    require(state["config"].get("execution_mode") == MODE,
            "This executor requires a new isolated-v1 experiment; do not migrate an older run")
    return state["config"]["executor"]


def relative(out, path):
    return path.relative_to(out).as_posix()


def stage(out, mapping, dest):
    require(isinstance(mapping, dict), "An explicit destination-to-source file map is required")
    for name, source in mapping.items():
        # Validate destination independently of source; never copy a directory wholesale.
        rel = Path(name)
        require(rel.parts and not rel.is_absolute() and ".." not in rel.parts, "Invalid staged name")
        target = dest / rel
        require(not target.exists(), "Duplicate staged input")
        target.parent.mkdir(parents=True, exist_ok=True)
        origin = regular(out, source)
        target.write_bytes(origin.read_bytes())
        target.chmod(0o644 | (origin.stat().st_mode & 0o111))


def practice_handoff(operation, skills_root, inputs_root, output_root, outputs):
    """Describe only transferred files; creator scratch never becomes a practice input."""
    skills, view = operation / "skills", operation / "view"
    manifest = view / "practice-context.json"
    require(not manifest.exists(), "Reserved practice context already exists")
    skill_files, input_files = tree(skills), tree(view)
    save(manifest, {"schema_version": 1, "phase": "official_practice",
        "skills_root": str(skills_root), "inputs_root": str(inputs_root), "output_root": str(output_root),
        "skill_files": skill_files, "input_files": input_files, "outputs": outputs,
        "author_scratch_available": False, "previous_outputs_available": False,
        "integrity_owner": "executor", "integrity_checks": ["before_practice", "after_practice"]})
    # Include the handoff itself in the host's integrity check; it cannot hash itself.
    return {"skills": digest(skill_files), "inputs": digest(tree(view))}


def stopped_diagnosis(practice, result):
    """Describe the fenced role from its own process record, never as success."""
    text = f"{result.get('error_code', 'role_failed')}: {result.get('error', 'Role did not complete')}"
    trace = practice / "execution/messages.jsonl"
    if trace.is_file():
        for line in reversed(trace.read_text(encoding="utf-8", errors="replace").splitlines()):
            try:
                payload = json.loads(line).get("payload", {})
            except ValueError:
                continue
            if payload.get("type") == "tool_call_output" and payload.get("stop_reason") in ("fatal", "aborted"):
                output = str(payload.get("output", ""))[-2000:]
                return f"{text}\nLast fenced tool output: {output}"
    return text


def check_practice_inputs(operation, expected, stage):
    """Check actual bytes outside the model before launch and before importing outputs."""
    record = {"at": stamp(), "stage": stage, "expected": expected, "actual": {}, "status": "failed"}
    try:
        for name, directory in (("skills", "skills"), ("inputs", "view")):
            record["actual"][name] = digest(tree(operation / directory))
        require(record["actual"] == expected, "Practice inputs changed")
        record["status"] = "passed"
    except (OSError, ValueError) as error:
        record["error"] = str(error)
        raise ValueError(f"Practice inputs changed ({stage}); no outputs may be imported") from error
    finally:
        save(operation / f"integrity-{stage}.json", record)


def launch(config, sandbox, work, view, identity, prompt, runtime, deadline, record, on_ready):
    record.mkdir(parents=True, exist_ok=False)
    setup = {**config, "container": sandbox.name, "work": str(work), "writable": str(sandbox.cwd),
             "readonly": list(map(str, sandbox.readonly_targets)),
             **identity, "runtime": runtime, "deadline": deadline, "prompt": prompt,
             "messages": str(record / "messages.jsonl"), "result": str(record / "result.json")}
    save(record / "launch.json", setup)
    process = None
    started, completed, handshaken = stamp(), False, False
    argv = [config["node"], str(HERE / "launch.mjs"), str(record / "launch.json")]
    with (record / "launcher.log").open("wb") as log:
        try:
            sandbox.check()
            process = subprocess.Popen(argv,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, start_new_session=True)
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while not selector.select(timeout=0.2):
                    sandbox.check()
                    require(process.poll() is None, "Role launcher failed before identity handshake")
                line = process.stdout.readline()
                require(line, f"Role launcher failed before identity handshake; inspect {record / 'launcher.log'}")
                ready = json.loads(line)
            sandbox.check()
            identity["session_id"] = ready["session_id"]
            handshaken = True
            on_ready(identity)
            process.stdin.write(b"go\n")
            process.stdin.flush()
            process.stdin.close()
            while process.poll() is None:
                sandbox.check()
                try:
                    process.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    pass
            sandbox.check()
            result = read_json(record / "result.json")
            if process.returncode != 0 or not result.get("completed"):
                raise RoleFailed(result, record)
            completed = True
        finally:
            if process:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                process.stdin.close()
                process.stdout.close()
            receipt = {"argv": argv, "started_at": started, "finished_at": stamp(),
                       "execution_status": "completed" if completed else ("interrupted" if handshaken else "not_started"),
                       "exit_code": process.returncode if process else None}
            save(record / "launcher.process.json", receipt)
    return receipt


def verifier_scratch(config, identity):
    folder = Path(config["penguin_home"]) / config["project_id"] / "agents" / identity["agent_id"] / "scratchpad"
    folder.mkdir(parents=True, exist_ok=True)
    return folder.resolve()


def draft_verifier(config, runtime, deadline, stop_file, control, operation, identity):
    """The same bounded planning stage is used by construction and development replay."""
    work, view = operation / "author-work", operation / "plan-view"
    work.mkdir(parents=True)
    with Boundary(config, control, work, [view, verifier_scratch(config, identity)], deadline, stop_file,
                  targets={view: work / "inputs"}) as sandbox:
        launch(config, sandbox, work, view, identity, oracle.plan_prompt(work), runtime, deadline,
               operation / "planner", lambda actual: save(operation / "identity.json", actual))
    plan = read_json(regular(work, "verification-plan.json"))
    seal = oracle.validate_plan(plan, view)
    save(operation / "oracle/plan.json", plan)
    save(operation / "oracle/seal.json", seal)
    return seal


def measure_verifier(config, runtime, deadline, stop_file, control, operation, folder, maximum):
    """Author against reviewed expectations, then measure once in a fresh container."""
    identity = read_json(operation / "identity.json")
    expected_identity = dict(identity)
    work, writable, view = operation / "author-work", operation / "suite-work", operation / "view"
    writable.mkdir()
    reviewed = operation / "oracle"
    save(reviewed / "coverage-template.json", oracle.coverage_template(read_json(reviewed / "plan.json"),
         read_json(reviewed / "seal.json"), read_json(reviewed / "review.json")))
    with Boundary(config, control, writable, [view, reviewed, verifier_scratch(config, identity)], deadline, stop_file,
                  targets={writable: work, view: work / "inputs", reviewed: work / "oracle"}) as sandbox:
        launch(config, sandbox, work, view, identity, oracle.suite_prompt(work, maximum), runtime, deadline,
               operation / "author", lambda actual: require(actual == expected_identity, "Verifier session changed after plan review"))
    suite = operation / "suite"
    copy_files(writable, suite, ["suite.py", "coverage.json"])
    # Refuse unsupported promotions before running generated test code.
    oracle.validate_coverage(read_json(reviewed / "plan.json"), read_json(reviewed / "seal.json"),
                             read_json(reviewed / "review.json"), read_json(suite / "coverage.json"))
    copy_files(suite, folder, ["suite.py", "coverage.json"])
    copy_files(reviewed, folder / "oracle", ["plan.json", "seal.json", "review.json", "coverage-template.json"])
    results, guard = operation / "results", operation / "guard"
    results.mkdir()
    guard.mkdir()
    # This category exists even without a successful targeted search. Keep its
    # root distinct from public inputs; absence of evidence is never a fallback.
    (view / "additional-research").mkdir(exist_ok=True)
    (guard / "openskill_limit.py").write_text(
        "import pytest\ndef pytest_collection_finish(session):\n"
        f"    if len(session.items) > {maximum}:\n"
        "        pytest.exit('OpenSkill virtual test budget exceeded before execution', returncode=4)\n")
    command = ["/usr/bin/env", "OPENSKILL_INPUTS=" + str(view / "public"),
               "OPENSKILL_RESEARCH=" + str(view / "research"),
               "OPENSKILL_ADDITIONAL_RESEARCH=" + str(view / "additional-research"),
               "OPENSKILL_OUTPUTS=" + str(view / "outputs"), "OPENSKILL_ORACLE=" + str(reviewed),
               "PYTHONPATH=" + str(guard), "python3", "-m", "pytest", "-q", "-p", "no:cacheprovider",
               "-p", "openskill_limit", "--rootdir=" + str(suite), str(suite / "suite.py"),
               "--junitxml=" + str(results / "report.xml")]
    with Boundary(config, control, results, [suite, view, guard, reviewed], deadline, stop_file) as sandbox:
        receipt = sandbox.run(command, folder / "pytest.log")
    if (results / "report.xml").exists():
        copy_files(results, folder, ["report.xml"])
    return receipt


class Executor:
    def __init__(self, out, case_id, *, allow_stopped=False):
        self.out = out
        self.state = experiment.run("status", out)
        self.config = settings(self.state)
        self.cid = identifier(case_id)
        self.config = {**self.config, "image": self.config.get("case_images", {}).get(self.cid, self.config["image"])}
        self.case = self.state["cases"][self.cid]
        self.guidance = experiment.run("next", out)["cases"][self.cid]
        self.deadline = self.guidance["deadline_at"]
        self.root = experiment.case_root(out, self.cid)
        self.private = out / ".executor" / self.cid
        self.control = out / ".executor" / "containers"
        self.stop = out / "STOP"
        self.allow_stopped = allow_stopped
        self.stop_digest = hashlib.sha256(self.stop.read_bytes()).hexdigest() if self.stop.exists() else None
        require(self.state["phase"] == "construction" and not self.case.get("finished"), "Construction is closed")
        require((allow_stopped or not self.stop.exists()) and self.guidance["remaining_seconds"] > 0,
                "Experiment stopped or expired")
        self.runtime = self.state["config"]["runtime"]["construction"]

    def boundary(self, work, readonly, *, targets=None):
        return Boundary(self.config, self.control, work, readonly, self.deadline, self.stop, targets=targets,
                        allow_stopped=self.allow_stopped, stop_digest=self.stop_digest)

    def identity(self, role):
        return {"role": role, "agent_id": "openskill_" + uuid.uuid4().hex}

    def scratch(self, identity):
        folder = Path(self.config["penguin_home"]) / self.config["project_id"] / "agents" / identity["agent_id"] / "scratchpad"
        folder.mkdir(parents=True, exist_ok=True)
        return folder.resolve()

    def prepare(self, request):
        plan = self.private / "plan.json"
        if plan.exists():
            result = read_json(plan)
            require(digest(tree(self.private / "inputs")) == result["inputs_sha256"], "Pinned inputs changed")
            return result
        require(self.guidance["next_action"] == "research_and_plan", "Initial plan is no longer allowed")
        names = request["skills"]
        strings(names, "planned skills")
        require(1 <= len(names) <= 4, "Plan must contain 1–4 skills")
        for name in names:
            identifier(name)
        strings(request["outputs"], "public result allowlist")
        for name in request["outputs"]:
            require(not Path(name).is_absolute() and ".." not in Path(name).parts, "Invalid result path")
        inputs = self.private / "inputs"
        for role in ("public", "knowledge", "anchors"):
            require(request.get(role), f"Missing independently reviewed {role} inputs")
            allowed = self.root / "inputs" / role
            require(all(regular(self.out, source).resolve().is_relative_to(allowed.resolve())
                        for source in request[role].values()), f"{role} files must come from {allowed}")
            stage(self.out, request[role], inputs / role)
        # The portable skill contract is part of the creator's input, never the verifier's.
        contract = inputs / "knowledge" / "openskill-contract.md"
        require(not contract.exists(), "Reserved contract filename")
        contract.write_bytes((HERE.parent / "references/skill-contract.md").read_bytes())
        result = {"skills": names, "outputs": request["outputs"], "inputs_sha256": digest(tree(inputs)),
                  "creator": self.identity("creator")}
        save(plan, result)
        return result

    def research_files(self, request):
        """Validate controller selection without writing or spending a role attempt."""
        extra = request.get("research_files", {})
        require(isinstance(extra, dict), "research_files must be a destination-to-source file map")
        registered = {}
        for search in self.case["searches"]:
            if search.get("result", {}).get("outcome") == "retrieved":
                registered.update(search["result"]["evidence"])
        destinations = set()
        for name, source in extra.items():
            require(isinstance(name, str) and "\x00" not in name, "Invalid research destination")
            rel = Path(name)
            require(rel.parts and not rel.is_absolute() and ".." not in rel.parts,
                    "Research destination must be a relative file path")
            require(all(rel != other and rel not in other.parents and other not in rel.parents
                        for other in destinations), "Duplicate or overlapping research destinations")
            destinations.add(rel)
            require(isinstance(source, str) and source in registered,
                    "Additional research requires sealed evidence from a retrieved search-result; unavailable results are diagnostics")
            source_path = Path(source)
            require(not source_path.is_absolute() and ".." not in source_path.parts and
                    source_path.is_relative_to((self.root / "research").relative_to(self.out)),
                    "Additional research must belong to this Case's research directory")
        return extra

    def check_research(self, extra):
        # A valid selection whose sealed bytes changed is an integrity failure,
        # not a correctable controller request. Recheck at staging as well.
        if extra:
            try:
                registered = {source: sha for search in self.case["searches"]
                              if search.get("result", {}).get("outcome") == "retrieved"
                              for source, sha in search["result"]["evidence"].items()}
                for source in extra.values():
                    require(regular(self.out, source).resolve().is_relative_to((self.root / "research").resolve()),
                            "Research evidence escapes its Case directory")
                experiment.verify_evidence(self.out, {source: registered[source] for source in extra.values()})
            except (OSError, ValueError) as error:
                raise ResearchIntegrityFailed(f"Sealed research integrity failed: {error}") from error

    def view(self, role, destination, request, plan, include_outputs=True):
        extra = self.research_files(request)
        self.check_research(extra)
        inputs = self.private / "inputs"
        copy_files(inputs / "public", destination / "public", files(inputs / "public"))
        source = inputs / ("knowledge" if role == "creator" else "anchors")
        copy_files(source, destination / "research", files(source))
        # Newly retrieved gap evidence is explicitly selected, never controller history.
        stage(self.out, extra, destination / "additional-research")
        review = experiment.skill_review.latest(self.case)
        if role == "creator" and review:
            # Only controller-reviewed, explicitly selected public diagnostics transfer.
            experiment.verify_evidence(self.out, review["evidence"])
            save(destination / "skill-review.json", review)
            stage(self.out, review.get("feedback_files", {}), destination / "finding-evidence")
        if self.case.get("attempts"):
            latest = self.case["attempts"][-1]
            if latest.get("feedback"):
                save(destination / "feedback.json", latest["feedback"])
                if latest.get("research_fallback"):
                    save(destination / "research-fallback.json", latest["research_fallback"])
                previous = Path(latest["directory"])
                require(tree(previous, allow_empty=True) == latest["evidence"], "Previous verifier evidence changed")
                names = [name for name in ("suite.py", "coverage.json", "report.xml", "pytest.log", "failure.txt",
                                           "oracle/plan.json", "oracle/seal.json", "oracle/review.json")
                         if name in latest["evidence"]]
                copy_files(previous, destination / "previous-verification", names)
        if role == "verifier" and include_outputs:
            outputs = self.root / "practice" / f"revision-{len(self.case['revisions']) - 1}"
            copy_files(outputs, destination / "outputs", plan["outputs"])

    def creator(self, request):
        require(self.guidance["next_action"] in ("research_and_plan", "initial_practice", "revise_skill", "repeat_practice", "repair_execution"),
                "Creator is not the next allowed action")
        repair = None
        if self.guidance["next_action"] == "repair_execution":
            repair = request["execution_recovery"]
            self.case = event(self.out, "begin-execution-repair", case_id=self.cid, decision=repair)["cases"][self.cid]
        plan = self.prepare(request)
        number = len(self.case["revisions"])
        suffix = f"-recovery-{len(self.case['execution_repairs'])}" if repair else ""
        operation = self.private / f"practice-{number}{suffix}"
        require(not operation.exists(), "Uncollected practice exists; inspect it, do not silently rerun")
        work = self.private / "creator-work"
        work.mkdir(parents=True, exist_ok=True)
        view = operation / "view"
        self.view("creator", view, request, plan)
        if repair:
            failure = self.case["execution_failures"][self.case["execution_pending"]]
            save(view / "execution-feedback.json", {"failure": failure["diagnosis"], "decision": repair,
                                                   "failed_skills_sha256": failure["skills_sha256"]})
        identity = plan["creator"]
        identity_file = self.private / "creator.json"
        if identity_file.exists():
            identity = read_json(identity_file)
        elif "creator_session_id" in self.case:
            raise ValueError("Persistent creator identity is missing; never replace it with a fresh session")
        public_view = work / "inputs"
        prompt = (f"Public task and research: {public_view}. Fixed skill names: {json.dumps(plan['skills'])}. "
            f"Write reusable skills and contracts to {work}/skills. Follow research/openskill-contract.md. "
            f"Contract ids are {self.cid}/<skill-name>. Each SKILL.md version must use YYYY.MM.DD.N, "
            "for example 2026.10.19.1; a hyphenated date is invalid. "
            f"Hypothesis: {request['hypothesis']}. The executor will freeze your skills for practice in a fresh "
            "environment and collect actual results. Only skills/ and the approved inputs transfer. "
            "Author reports, scratch files and exploratory outputs do not transfer, even though this "
            "conversation continues. Keep every reusable dependency inside its declared skill resources. "
            "The executor owns skill/input hash checks; do not require an author deployment report during practice. "
            "No target grading or network is available. ")
        mode = self.config.get("practice_mode", "agent")
        if mode == "command":
            prompt += (f"Write {work}/practice.json with an argv string array. "
                "Use ${SKILLS}, ${INPUTS} and ${OUTPUTS}; the executor substitutes absolute paths. "
                "At least one argument must name a real file under ${SKILLS}/. "
                f"Execute the skills to produce these paths under ${{OUTPUTS}}: {json.dumps(plan['outputs'])}.")
        else:
            prompt += "Prepare skills only in this turn. The executor will resume you to apply them with read-only skills."

        def ready(actual):
            if "creator_session_id" not in self.case:
                self.case = event(self.out, "plan", case_id=self.cid, skills=plan["skills"],
                                  creator_session_id=actual["session_id"])["cases"][self.cid]
            else:
                require(actual["session_id"] == self.case["creator_session_id"], "Creator identity changed")
            save(identity_file, actual)

        if repair:
            prompt += f" Repair the recorded execution failure in {public_view}/execution-feedback.json."
        if number:
            prompt += (f" Read {public_view}/feedback.json and previous-verification before editing. "
                "Correct the observed reusable-skill defect and regenerate outputs; do not edit only answers "
                "or make cosmetic changes to manufacture a revision. If research-fallback.json exists, "
                "read its unresolved gaps and validation plan. Retrieval supplied no new rule: repair the "
                "documented bug or evidence-handling behavior using available knowledge, keep assumptions "
                "explicit, and never claim missing policy was retrieved or independently verified.")
            if experiment.skill_review.findings(self.case):
                prompt += (f" Read {public_view}/skill-review.json and its selected files under finding-evidence/. "
                    "Prioritize the listed findings and change affected reusable resources. Keep unresolved "
                    "findings explicit; partial progress can receive another budgeted round. Exercise the documented "
                    "counterexample and preserve working inputs. Do not remove supported interface behavior "
                    "to hide the defect. Then apply the changed skills in fresh practice; the controller and "
                    "independent verifier, not your own completion claim, decide whether the findings are resolved.")
        if not repair or repair["action"] == "revise_skill":
            with self.boundary(work, [view, self.scratch(identity)], targets={view: public_view}) as sandbox:
                launch(self.config, sandbox, work, view, identity, prompt, self.runtime, self.deadline,
                       operation / "author", ready)
        # No author process survives to modify these inputs during the measured execution.
        skills = operation / "skills"
        copy_files(work / "skills", skills, files(work / "skills"))
        if repair:
            require((digest(tree(skills)) != failure["skills_sha256"]) == (repair["action"] == "revise_skill"),
                    "Execution skill repair must change skills; repeat_practice must keep the frozen bytes")
        outputs = operation / "outputs"
        outputs.mkdir()
        expected = practice_handoff(operation,
            skills if mode == "command" else work / "skills",
            view if mode == "command" else public_view,
            outputs if mode == "command" else work, plan["outputs"])
        check_practice_inputs(operation, expected, "before")
        try:
            receipt, command, evidence = self.practice(operation, work, view, public_view, identity, ready, plan, mode, expected)
        except (RoleFailed, DeliveryFailed) as error:
            limits = recovery.policy(self.state["config"])
            repairable = {"SKILL_EXECUTION_FAILED", "PRACTICE_RECOVERY_UNRESOLVED"}
            if limits and limits["version"] == 2:
                repairable.update(("RECOVERY_BUDGET_EXHAUSTED", "RECOVERY_TIME_EXHAUSTED"))
            if limits is None or (isinstance(error, RoleFailed) and error.code not in repairable):
                raise
            check_practice_inputs(operation, expected, "after-failure")
            evidence = [operation / "integrity-before.json", operation / "integrity-after-failure.json"]
            evidence += [p for p in (operation / "practice.log", operation / "practice.process.json",
                         operation / "execution/result.json", operation / "execution/messages.jsonl",
                         operation / "execution/recovery.json") if p.exists()]
            diagnosis = str(error)
            trace = operation / "execution/messages.jsonl"
            if trace.exists():
                for line in trace.read_text().splitlines():
                    payload = json.loads(line).get("payload", {})
                    if payload.get("type") == "tool_call_output" and payload.get("stop_reason") == "fatal":
                        diagnosis = str(payload.get("output", ""))[-6000:]
            elif (operation / "practice.log").exists():
                diagnosis += "\n" + (operation / "practice.log").read_text()[-6000:]
            report = operation / "failure.json"
            save(report, {"category": "skill_execution" if isinstance(error, RoleFailed) and error.code == "SKILL_EXECUTION_FAILED" else "delivery",
                          "error_code": error.code if isinstance(error, RoleFailed) else "MISSING_DELIVERY",
                          "revision": number, "diagnosis": diagnosis, "skills_sha256": digest(tree(skills)),
                          "evidence": [relative(self.out, p) for p in evidence]})
            state = event(self.out, "execution-failure", case_id=self.cid, record=relative(self.out, report))
            require(recovery.remaining(state["cases"][self.cid], state["config"])["execution_repairs"] > 0,
                    "Execution repair budget exhausted")
            return state
        # Import only after a completed role, unchanged inputs and complete delivery.
        target = self.root / "practice" / f"revision-{number}"
        copy_files(outputs, target, plan["outputs"])
        live = self.root / "skills"
        if live.exists():
            require(digest(tree(live)) == self.case["revisions"][-1]["skills_sha256"], "Live skill bytes changed outside executor")
            shutil.rmtree(live)
        copy_files(skills, live, files(skills))
        log = self.root / "executions" / f"run-{number}.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_bytes((operation / "practice.log").read_bytes())
        receipt_path = log.with_suffix(".json")
        author_trace = operation / "author/messages.jsonl"
        save(receipt_path, {"creator_session_id": identity["session_id"], "skills_sha256": digest(tree(live)),
             "output_directory": relative(self.out, target), "commands": [json.dumps(command)],
             "exit_code": receipt["exit_code"], "started_at": receipt["started_at"], "finished_at": receipt["finished_at"],
             "isolation": MODE, "practice_mode": mode,
             "evidence": [relative(self.out, log), *[relative(self.out, path) for path in evidence],
                          *([relative(self.out, author_trace)] if author_trace.exists() else [])]})
        return event(self.out, "revision", case_id=self.cid, creator_session_id=identity["session_id"],
                     hypothesis=request["hypothesis"], execution_record=relative(self.out, receipt_path))

    def practice(self, operation, work, view, public_view, identity, ready, plan, mode, expected):
        skills, outputs = operation / "skills", operation / "outputs"
        limits = recovery.policy(self.state["config"])
        if mode == "command":
            command = read_json(regular(work, "practice.json"))["argv"]
            require(isinstance(command, list) and command and
                    all(isinstance(arg, str) and "\0" not in arg for arg in command) and command[0],
                    "Practice argv must be a nonempty string array")
            referenced = [arg[len("${SKILLS}/"):] for arg in command if arg.startswith("${SKILLS}/")]
            require(referenced, "Command practice must reference a frozen skill file")
            for source in referenced:
                regular(skills, source)
            substitutions = {"${SKILLS}": str(skills), "${INPUTS}": str(view / "public"), "${OUTPUTS}": str(outputs)}
            for key, value in substitutions.items():
                command = [arg.replace(key, value) for arg in command]
            with self.boundary(outputs, [skills, view]) as sandbox:
                receipt = sandbox.run(command, operation / "practice.log")
            if limits and receipt["execution_status"] == "completed" and receipt["exit_code"] != 0:
                diagnostic = (operation / "practice.log").read_text().lower()
                require(type(receipt["exit_code"]) is int and 0 < receipt["exit_code"] < 125 and
                        not any(marker in diagnostic for marker in (
                            "error response from daemon", "oci runtime", "permission denied",
                            "permissionerror", "read-only file system", "operation not permitted")),
                        "Practice command infrastructure, signal or permission failure; no recovery")
                raise RoleFailed({"error_code": "SKILL_EXECUTION_FAILED"}, operation)
            if self.state["config"].get("stop_on_recurrence"):
                require(receipt["execution_status"] == "completed" and receipt["exit_code"] == 0,
                        "Official practice command failed; stop_on_recurrence is enabled")
            evidence = [operation / "practice.process.json", operation / "practice.log"]
        else:
            prompt = (f"Apply the frozen skills under {work}/skills to the public task at {public_view}/public. "
                      f"Read their SKILL.md files and use their procedures. Write {json.dumps(plan['outputs'])} "
                      f"under {work}. This is the official practice execution. Skills and research are read-only; "
                      "do not revise them or patch results from an earlier run. "
                      "PHASE TRANSITION: your conversation continues, but the Workspace now contains fresh outputs "
                      "and only the transferred read-only skills and inputs. Author reports, scratch files and "
                      "previous outputs remembered from earlier turns are absent. "
                      f"Read {public_view}/practice-context.json for the current paths, file inventory and outputs. "
                      "Use these current files, never a remembered author-only report such as reports/deployment-check.md. "
                      "The executor checks skill and input hashes before and after execution. Do not reproduce that "
                      "check or recreate an author deployment report. Apply the skills, validate the required answers, "
                      "then finish and report output paths and limitations honestly.")
            if "execution_pending" in self.case:
                prompt += (f" Read {public_view}/execution-feedback.json before retrying. Correct its recorded "
                           "execution or delivery problem using the current files; old partial outputs do not transfer.")
            if limits:
                prompt += (f" Local command errors have a Case-wide budget: {json.dumps(limits)}. "
                           "Correct invocation or temporary self-check errors promptly; a successful command is required "
                           "before ending a correction. Never patch the answers to satisfy a self-check or modify frozen skills. "
                           "A frozen skill defect must return to authoring. Independent verification judges correctness.")
                if limits["version"] == 2:
                    prompt += (" Same-family failures from one model response share one recovery allowance. "
                               "Read the error, correct the invocation in your next response and complete a command; "
                               "another command already planned in the failed response does not demonstrate correction. "
                               "Inspect JSON types before indexing. Prioritize delivering every declared output; avoid "
                               "repeating optional diagnostic commands after their cause is understood. If a check "
                               "reveals a reusable skill defect, report it for authoring repair and independent retesting.")
            with self.boundary(outputs, [skills, view, self.scratch(identity)],
                               targets={outputs: work, skills: work / "skills", view: public_view}) as sandbox:
                config = {**self.config, "stop_on_tool_failure": self.state["config"].get("stop_on_recurrence", False)}
                if limits:
                    config.update(recovery_policy=limits, tool_recovery=recovery.tool_usage(self.case))
                try:
                    receipt = launch(config, sandbox, work, view, identity, prompt, self.runtime, self.deadline,
                                     operation / "execution", ready)
                finally:
                    report = operation / "execution/recovery.json"
                    if limits and report.exists():
                        self.case = event(self.out, "tool-recovery", case_id=self.cid,
                                          record=relative(self.out, report))["cases"][self.cid]
            command = receipt["argv"]
            evidence = [operation / "execution/launcher.process.json", operation / "execution/messages.jsonl"]
            (operation / "practice.log").write_bytes((operation / "execution/messages.jsonl").read_bytes())
        check_practice_inputs(operation, expected, "after")
        evidence += [view / "practice-context.json", operation / "integrity-before.json", operation / "integrity-after.json"]
        # Validate every path before copying any output; missing delivery is not a
        # correct answer, and linked/escaping artifacts are never recoverable.
        for name in plan["outputs"]:
            try:
                regular(outputs, name)
            except FileNotFoundError as error:
                raise DeliveryFailed(f"Missing declared output: {name}") from error
        return receipt, command, evidence

    def verifier_plan(self, request):
        require(self.guidance["next_action"] in ("begin_verification", "repair_verifier"),
                "Verifier is not the next allowed action")
        plan = self.prepare(request)
        # Controller selections have passed dispatch preflight. Reserve before
        # staging/launch so an actual failed execution still spends its attempt.
        reserved = event(self.out, "begin-verification", case_id=self.cid)
        attempt = reserved["cases"][self.cid]["attempts"][-1]
        folder = Path(attempt["directory"])
        folder.mkdir(parents=True)
        operation = self.private / f"verify-{attempt['number']}"
        identity = self.identity("verifier")
        try:
            self.view("verifier", operation / "plan-view", request, plan, include_outputs=False)
            draft_verifier(self.config, self.runtime, self.deadline, self.stop, self.control, operation, identity)
            paths = [operation / "oracle/plan.json", operation / "oracle/seal.json", operation / "identity.json"]
            paths += [operation / "plan-view" / name for name in files(operation / "plan-view")]
            return event(self.out, "record-verification-plan", case_id=self.cid,
                         verifier_session_id=identity["session_id"], operation=relative(self.out, operation),
                         evidence=[relative(self.out, p) for p in paths])
        except (CleanupFailed, Interrupted, RoleFailed, ResearchIntegrityFailed, subprocess.SubprocessError):
            raise
        except (Exception, KeyboardInterrupt) as exc:
            self.raise_boundary_failure()
            return self.verification_failure(folder, identity, exc)

    def raise_boundary_failure(self):
        # A failed service/permission probe must never become a repairable suite
        # defect. Boundary records are host-owned, outside every role mount.
        for record in self.control.glob("openskill-*.json"):
            value = read_json(record)
            if value.get("startup_error"):
                raise RuntimeError("Recorded boundary startup failure; experiment must stop")

    def verification_failure(self, folder, identity, error):
        failure = f"{type(error).__name__}: {error}"
        (folder / "failure.txt").write_text(failure + "\n", encoding="utf-8")
        save(folder / "executor.json", {"isolation": MODE, "execution_status": "not_started",
             "pytest_exit_code": None, "verifier_session_id": identity.get("session_id"), "failure": failure})
        return event(self.out, "finish-verification", case_id=self.cid, execution_status="not_started",
                     verifier_session_id=identity.get("session_id", "dispatch-" + identity["agent_id"]))

    def review_verifier(self, request):
        require(self.guidance["next_action"] == "review_verification_plan", "Draft and review the verification plan first")
        attempt = self.case["attempts"][-1]
        operation = self.out / attempt["planning"]["operation"]
        experiment.verify_evidence(self.out, attempt["planning"]["evidence"])
        review_path = regular(self.out, request["review"])
        require(review_path.resolve().is_relative_to((self.root / "review").resolve()),
                "Controller evidence review must be under this Case's review directory")
        _, _, review = oracle.load_review(operation, review_path)
        require(not (operation / "oracle/review.json").exists(), "Verification was already dispatched; collect or recover it")
        return attempt, operation, review

    def verifier(self, request):
        attempt, operation, review = self.review_verifier(request)
        save(operation / "oracle/review.json", review)
        event(self.out, "record-verification-review", case_id=self.cid,
              evidence=[relative(self.out, operation / "oracle/review.json")])
        folder = Path(attempt["directory"])
        identity = read_json(operation / "identity.json")
        outcome, code, failure = "not_started", None, None
        try:
            copy_files(operation / "plan-view", operation / "view", files(operation / "plan-view"))
            source = self.root / "practice" / f"revision-{attempt['revision']}"
            require(digest(tree(source)) == self.case["revisions"][attempt["revision"]]["outputs_sha256"],
                    "Practice outputs changed before verification")
            copy_files(source, operation / "view/outputs", files(source))
            receipt = measure_verifier(self.config, self.runtime, self.deadline, self.stop, self.control,
                                       operation, folder, self.state["config"]["max_virtual_tests"])
            outcome, code = receipt["execution_status"], receipt["exit_code"]
        except (CleanupFailed, Interrupted, RoleFailed, subprocess.SubprocessError):
            raise  # Never seal evidence while a worker might still be writing it.
        except (Exception, KeyboardInterrupt) as exc:
            self.raise_boundary_failure()
            failure = f"{type(exc).__name__}: {exc}"
            if (folder / "pytest.process.json").exists():
                outcome = "interrupted"
            (folder / "failure.txt").write_text(failure + "\n", encoding="utf-8")
        save(folder / "executor.json", {"isolation": MODE, "execution_status": outcome,
             "pytest_exit_code": code, "verifier_session_id": identity.get("session_id"), "failure": failure})
        result = event(self.out, "finish-verification", case_id=self.cid, execution_status=outcome,
                       pytest_exit_code=code, verifier_session_id=identity.get("session_id", "dispatch-" + identity["agent_id"]))
        return result

    def continuation_context(self, request):
        """Check the fenced practice and frozen bytes before any repair import."""
        require(self.allow_stopped and self.stop.exists(), "A controlled continuation requires the original STOP")
        require(not self.case.get("continuations"), "One controlled delivery continuation is allowed")
        require(not self.case.get("pending"), "Finish the active verification before continuing")
        practice = experiment.continuation_practice(self.out, self.cid, request["practice"])
        result_path = practice / "execution/result.json"
        require(result_path.is_file(), "Stopped practice has no process result")
        result = read_json(result_path)
        require(result.get("completed") is False, "Continuation requires a role that did not complete")
        require(result.get("error_code") in ("PRACTICE_HARD_FAILURE", "RECOVERY_BUDGET_EXHAUSTED",
                "PRACTICE_RECOVERY_UNRESOLVED", "SKILL_EXECUTION_FAILED"),
                "Unsupported stopped-practice error")
        before_path = practice / "integrity-before.json"
        require(before_path.is_file(), "Stopped practice has no integrity record")
        before = read_json(before_path)
        require(before.get("status") == "passed" and before.get("actual") == before.get("expected"),
                "Stopped practice did not pass its input integrity check")
        require(digest(tree(practice / "skills")) == before["expected"]["skills"],
                "Stopped practice skills changed")
        require(digest(tree(practice / "view")) == before["expected"]["inputs"],
                "Stopped practice inputs changed")
        require(digest(tree(self.root / "skills")) == self.case["revisions"][-1]["skills_sha256"],
                "Live skills changed outside the registered revision")
        for name in read_json(self.private / "plan.json")["outputs"]:
            regular(practice / "outputs", name)
        return practice, result, before, tree(practice / "outputs")

    def resume_delivery(self, request):
        """Repair only the delivery diagnostics, then register the fenced revision."""
        practice, result, before, stopped_outputs = self.continuation_context(request)
        plan = read_json(self.private / "plan.json")
        answers = request.get("answers")
        strings(answers, "preserved answers")
        require(set(answers).issubset(plan["outputs"]), "A preserved answer is not a declared output")
        for name in answers:
            regular(practice / "outputs", name)
        original_answers = {name: stopped_outputs[name] for name in answers}
        repair = request.get("repair")
        require(isinstance(repair, dict), "A bounded repair record is required")
        allowed = repair.get("allowed_paths")
        strings(allowed, "allowed repair paths")
        for name in allowed:
            rel = Path(name)
            require(rel.parts and rel.parts[0] == "work" and name not in plan["outputs"],
                    "Only non-output work files may be repaired")
        source = regular(self.out, repair["source"])
        require(source.resolve().is_relative_to((self.root / "review").resolve()),
                "Repair source belongs under Case review")
        operation = self.private / "continuation-1"
        require(not operation.exists(), "A controlled continuation already exists")
        work = operation / "work"
        work.mkdir(parents=True)
        skills, inputs = operation / "skills", operation / "inputs"
        copy_files(practice / "skills", skills, files(practice / "skills"))
        copy_files(practice / "view", inputs, files(practice / "view"))
        delivered = [name for name in files(practice / "outputs")
                     if name.startswith("answers/") or (name.startswith("work/") and name != "work/run_probes.py")]
        copy_files(practice / "outputs", work, delivered)
        stage(self.out, {"work/run_probes.py": repair["source"]}, work)
        before_work = tree(work)
        require({name: before_work.get(name) for name in answers} == original_answers,
                "A preserved answer changed before the repair")
        with self.boundary(work, [skills, inputs],
                           targets={work: work, skills: work / "skills", inputs: work / "inputs"}) as sandbox:
            receipt = sandbox.run(["python3", "work/run_probes.py"], operation / "probe.log")
        require(receipt["execution_status"] == "completed" and receipt["exit_code"] == 0,
                "The probe repair did not complete successfully")
        after_work = tree(work)
        require({name: after_work.get(name) for name in answers} == original_answers,
                "The repair changed a preserved answer")
        require(digest(tree(skills)) == before["expected"]["skills"], "The repair changed frozen skills")
        require(digest(tree(inputs)) == before["expected"]["inputs"], "The repair changed public inputs")
        probes_path = work / "skill-behavior-probes.json"
        require(probes_path.is_file(), "The repair did not produce skill-behavior-probes.json")
        payload = read_json(probes_path)
        require(payload.get("schema") == "skill-behavior-probes/1", "Invalid probe report schema")
        if repair.get("expected_probe_count") is not None:
            require(payload.get("probe_count") == repair["expected_probe_count"], "Probe count changed")
        statuses = {row.get("id"): row.get("status") for row in payload.get("probes", [])}
        for probe in repair.get("required_probes", []):
            require(statuses.get(probe) == "pass", f"Required probe did not pass: {probe}")
        require(payload.get("status_counts", {}).get("fail") == 0, "The repair left failed probes")
        target = self.root / "practice" / f"revision-{len(self.case['revisions'])}"
        require(not target.exists(), "The practice revision already exists")
        target.mkdir(parents=True)
        for name in plan["outputs"]:
            origin = regular(work, name)
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(origin.read_bytes())
        outputs = tree(target)
        changed = sorted(name for name, sha in after_work.items() if stopped_outputs.get(name) != sha)
        require(not any(name.startswith("answers/") for name in changed), "A preserved answer changed")
        skills_sha = before["expected"]["skills"]
        live_sha = digest(tree(self.root / "skills"))
        import_skills = live_sha != skills_sha
        record = {
            "schema_version": 1, "case_id": self.cid, "revision": len(self.case["revisions"]),
            "practice": request["practice"],
            "stop": {"sha256": self.stop_digest, "text": self.stop.read_text(encoding="utf-8")},
            "stopped_role": {"completed": False, "error_code": result["error_code"],
                             "diagnosis": stopped_diagnosis(practice, result),
                             "evidence": [relative(self.out, practice / name) for name in (
                                 "execution/result.json", "execution/launcher.process.json",
                                 "execution/messages.jsonl", "execution/recovery.json",
                                 "integrity-before.json")]},
            "integrity": {"status": "passed",
                          "skills_expected": before["expected"]["skills"],
                          "skills_actual": digest(tree(skills)),
                          "inputs_expected": before["expected"]["inputs"],
                          "inputs_actual": digest(tree(inputs))},
            "inputs_sha256": before["expected"]["inputs"],
            "skills_sha256": skills_sha,
            "skills_source": {
                "source": request["practice"] + "/skills",
                "reason": "fenced practice revision" if import_skills else "unchanged live revision",
                "previous_sha256": live_sha,
                "sha256": skills_sha,
                "imported": import_skills,
            },
            "outputs_sha256": digest(outputs),
            "answers": {name: outputs[name] for name in answers},
            "outputs": outputs,
            "repair": {"actor": "controller", "action": "delivery-repair",
                       "source": repair["source"], "allowed_paths": allowed,
                       "required_probes": repair.get("required_probes", []),
                       "expected_probe_count": repair.get("expected_probe_count"),
                       "probe_status": statuses, "status_counts": payload.get("status_counts"),
                       "command": ["python3", "work/run_probes.py"],
                       "exit_code": receipt["exit_code"], "answer_files_preserved": True,
                       "changed_paths": changed,
                       "original_probe_sha256": stopped_outputs.get("work/run_probes.py"),
                       "repaired_probe_sha256": after_work.get("work/run_probes.py")},
            "role_success_claimed": False,
            "evidence": [relative(self.out, path) for path in (
                operation / "probe.log", operation / "probe.process.json",
                practice / "execution/result.json", practice / "execution/launcher.process.json",
                practice / "execution/messages.jsonl", practice / "execution/recovery.json",
                practice / "integrity-before.json")],
        }
        record_path = self.root / "review" / "continuation-1" / "continuation.json"
        save(record_path, record)
        return experiment.run("event", self.out, {
            "action": "continuation-delivery", "case_id": self.cid,
            "record": relative(self.out, record_path), "practice": request["practice"],
            "hypothesis": request["hypothesis"]}, executor=True)

    def resume_verifier(self, request):
        """Replay the sealed independent suite against the continued revision."""
        require(self.allow_stopped and self.stop.exists(), "A controlled replay requires the original STOP")
        require(self.case.get("continuations"), "No controlled continuation to verify")
        require(not self.case.get("pending"), "A verification is already active")
        revision = self.case["revisions"][-1]
        require(revision.get("delivery_kind") == "continuation", "The latest revision is not a continuation")
        require(not any(a.get("revision") == revision["revision"] for a in self.case["attempts"]),
                "The continuation revision was already measured")
        number = request.get("source_attempt")
        require(type(number) is int and 1 <= number <= len(self.case["attempts"]),
                "source_attempt is not a recorded attempt")
        source = self.case["attempts"][number - 1]
        require(source.get("finished") and source.get("result", {}).get("status") == "ok",
                "The source attempt is not a completed measurement")
        source_dir = Path(source["directory"])
        require(source_dir.is_dir(), "The source attempt directory is missing")
        require((source_dir / "oracle/review.json").is_file(), "The source oracle review is missing")
        source_operation = self.out / source["planning"]["operation"]
        require((source_operation / "plan-view").is_dir(), "The source plan view is missing")
        require(digest(tree(self.root / "skills")) == revision["skills_sha256"], "Skills changed")
        target = self.root / "practice" / f"revision-{revision['revision']}"
        require(digest(tree(target)) == revision["outputs_sha256"], "Outputs changed")
        operation = self.private / f"verify-{len(self.case['attempts']) + 1}"
        require(not operation.exists(), "Verification operation already exists")
        for name in ("plan.json", "seal.json", "review.json", "coverage-template.json"):
            copy_files(source_dir / "oracle", operation / "oracle", [name])
        copy_files(source_operation / "plan-view", operation / "plan-view",
                   files(source_operation / "plan-view"))
        copy_files(source_dir, operation / "suite", ["suite.py", "coverage.json"])
        identity = {"role": "verifier", "agent_id": "continuation",
                    "session_id": source.get("verifier_session_id") or "continuation-verifier"}
        save(operation / "identity.json", identity)
        state = event(self.out, "begin-verification", case_id=self.cid,
                      verifier_session_id=identity["session_id"])
        attempt = state["cases"][self.cid]["attempts"][-1]
        folder = Path(attempt["directory"])
        folder.mkdir(parents=True)
        evidence = [operation / "oracle/plan.json", operation / "oracle/seal.json",
                    operation / "identity.json"]
        evidence += [operation / "plan-view" / name for name in files(operation / "plan-view")]
        event(self.out, "record-verification-plan", case_id=self.cid,
              verifier_session_id=identity["session_id"], operation=relative(self.out, operation),
              evidence=[relative(self.out, path) for path in evidence])
        event(self.out, "record-verification-review", case_id=self.cid,
              evidence=[relative(self.out, operation / "oracle/review.json")])
        view = operation / "view"
        copy_files(operation / "plan-view", view, files(operation / "plan-view"))
        copy_files(target, view / "outputs", files(target))
        results, guard = operation / "results", operation / "guard"
        results.mkdir()
        guard.mkdir()
        (view / "additional-research").mkdir(exist_ok=True)
        (guard / "openskill_limit.py").write_text(
            "import pytest\ndef pytest_collection_finish(session):\n"
            f"    if len(session.items) > {self.state['config']['max_virtual_tests']}:\n"
            "        pytest.exit('OpenSkill virtual test budget exceeded before execution', returncode=4)\n")
        command = ["/usr/bin/env", "OPENSKILL_INPUTS=" + str(view / "public"),
                   "OPENSKILL_RESEARCH=" + str(view / "research"),
                   "OPENSKILL_ADDITIONAL_RESEARCH=" + str(view / "additional-research"),
                   "OPENSKILL_OUTPUTS=" + str(view / "outputs"),
                   "OPENSKILL_ORACLE=" + str(operation / "oracle"),
                   "PYTHONPATH=" + str(guard), "python3", "-m", "pytest", "-q", "-p", "no:cacheprovider",
                   "-p", "openskill_limit", "--rootdir=" + str(operation / "suite"),
                   str(operation / "suite" / "suite.py"), "--junitxml=" + str(results / "report.xml")]
        with self.boundary(results, [operation / "suite", view, guard, operation / "oracle"]) as sandbox:
            receipt = sandbox.run(command, folder / "pytest.log")
        require(receipt["execution_status"] == "completed", "The independent replay did not complete")
        if (results / "report.xml").exists():
            copy_files(results, folder, ["report.xml"])
        copy_files(operation / "suite", folder, ["suite.py", "coverage.json"])
        for name in ("plan.json", "seal.json", "review.json", "coverage-template.json"):
            copy_files(operation / "oracle", folder / "oracle", [name])
        return event(self.out, "finish-verification", case_id=self.cid,
                     execution_status=receipt["execution_status"],
                     pytest_exit_code=receipt["exit_code"],
                     verifier_session_id=identity["session_id"])


def stop(out, state):
    config = settings(state)
    (out / "STOP").write_text(stamp() + "\n")
    control = out / ".executor" / "containers"
    with launch_lock(control):
        for record in control.glob("openskill-*.json"):
            data = read_json(record)
            stop_container(config["docker"], control, data["container"])
    return {"stopped": True, "fence": str(out / "STOP")}


def preflight(out, request, full=False):
    """Check every declared construction image without a journal, role or model call."""
    config = settings({"config": request})
    require(config.get("sanitized_image") is True, "Review and attest the construction images first")
    require(not (out / "STOP").exists() and not (out / "journal").exists(),
            "Preflight requires a fresh directory, not an existing or stopped experiment")
    report = out / "preflight.json"
    require(not report.exists(), "Never overwrite a preflight; use a fresh directory")
    strings(request["case_ids"], "construction cases")
    result = {"started_at": stamp(), "status": "running", "docker": config["docker"],
              "cases": [], "model_requests": 0, "scope": "runtime_and_environments" if full else "environments"}
    save(report, result)
    try:
        if full:
            result["runtime"] = check_runtime(out, request, session=True)
            if config.get("runtime_manifest"):
                manifest = read_json(Path(config["runtime_manifest"]))
                require(manifest["runtime_fingerprint"] == result["runtime"]["fingerprint"],
                        "Prepared runtime manifest does not match the configured SDK")
            save(report, result)
        for case_id in request["case_ids"]:
            identifier(case_id)
            case_config = {**config, "image": config.get("case_images", {}).get(case_id, config["image"])}
            work = out / ".executor" / "preflight" / case_id
            work.mkdir(parents=True, exist_ok=False)
            deadline = (datetime.now(timezone.utc) + timedelta(seconds=330)).isoformat()
            boundary = Boundary(case_config, out / ".executor/containers", work, [], deadline, out / "STOP")
            row = {"case_id": case_id, "image": case_config["image"], "status": "checking",
                   "container_record": relative(out, boundary.record)}
            result["cases"].append(row)
            save(report, result)
            with boundary:
                row["status"] = "ready"
            row["cleanup_confirmed"] = True
            save(report, result)
        result["status"] = "ready"
    except BaseException as error:
        result.update(status="failed", error=f"{type(error).__name__}: {error}")
        if result["cases"]:
            result["cases"][-1]["status"] = "failed"
        (out / "STOP").write_text("Environment preflight failed; no construction may start.\n")
        raise
    finally:
        result["finished_at"] = stamp()
        save(report, result)
    return result


def fail_experiment(out, state, error):
    """Preserve the first failure and fence the entire experiment before cleanup."""
    record = out / ".executor" / "failure.json"
    if not record.exists():
        save(record, {"at": stamp(), "error_type": type(error).__name__, "error": str(error)})
    return stop(out, state)


def run(command, out, request=None):
    out = Path(out).resolve()
    if command in ("status", "next"):
        result = experiment.run(command, out)
        result["stopped"] = (out / "STOP").exists()
        if result["stopped"] and command == "next":
            result["next_action"] = "stopped"
            for case in result["cases"].values():
                case["next_action"] = "stopped"
        return result
    if command == "stop":
        state = (experiment.run("status", out) if (out / "journal").exists() else
                 {"config": {"execution_mode": MODE, "executor": {"docker": read_json(out / "preflight.json")["docker"]}}})
        return stop(out, state)
    with lock(out):
        if command == "preflight":
            return preflight(out, request)
        if command == "init":
            request = {**request, "process_review_required": True, "verification_plan_required": True,
                       "feedback_policy": request.get("feedback_policy", "bounded-evidence-v2")}
            experiment.validate_feedback_policy(request)
            if recovery.policy(request) is not None:
                request["recovery_policy"] = recovery.policy(request)
            require(request.get("execution_mode") == MODE, "Set execution_mode to isolated-v1")
            config = settings({"config": request})
            for name in ("docker", "node", "sdk", "penguin_home"):
                require(Path(config[name]).is_absolute() and Path(config[name]).exists(), f"Invalid {name} path")
            identifier(config["project_id"])
            require((Path(config["penguin_home"]) / config["project_id"] / ".project_config.toml").is_file(),
                    "Configure the construction model in the existing Penguin Project first")
            require(config.get("sanitized_image") is True, "Review and attest the image contains no graders, solutions or prior skills")
            require(config.get("practice_mode", "agent") in ("agent", "command"), "Invalid practice_mode")
            require(not (out / "STOP").exists(), "Never reuse a stopped experiment")
            require(type(request.get("stop_on_recurrence", False)) is bool, "stop_on_recurrence must be boolean")
            preflight(out, request, full=True)
            return experiment.run("init", out, request, executor=True)
        state = experiment.run("status", out)
        settings(state)
        if command == "recover":
            stop(out, state)
            for cid, case in state["cases"].items():
                if case.get("pending"):
                    folder = Path(case["attempts"][-1]["directory"])
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "recovery.txt").write_text("Host interruption; workers stopped. No completed measurement inferred.\n")
                    state = event(out, "finish-verification", case_id=cid, execution_status="interrupted",
                                  verifier_session_id=case["attempts"][-1].get("verifier_session_id") or "host-interruption")
            return state
        if command == "event":
            require(request["action"] not in ("plan", "revision", "begin-verification", "finish-verification",
                    "record-verification-plan", "record-verification-review", "tool-recovery",
                    "execution-failure", "begin-execution-repair"),
                    "Role transitions are owned by the executor")
            if (out / "STOP").exists():
                allowed = {"feedback", "finish-case", "search-result"}
                controlled = any(c.get("continuations") for c in state["cases"].values())
                lifecycle = ("skill-review", "freeze", "begin-evaluation", "finish-evaluation")
                if controlled and request["action"] in lifecycle:
                    if request["action"] in ("freeze", "begin-evaluation", "finish-evaluation"):
                        require(all(c.get("finished") and c.get("deployable")
                                    for c in state["cases"].values()),
                                "Freeze and evaluation require every Case closed")
                    allowed.add(request["action"])
                require(request["action"] in allowed, "Stopped experiment cannot restart")
            return event(out, **request)
        if command in ("creator", "verifier-plan", "verifier"):
            require(not (out / "STOP").exists(), "Stopped experiment cannot restart")
            require(state["config"].get("verification_plan_required"),
                    "Resume historical runs with their recorded Skill; do not migrate their verification protocol")
            try:
                experiment.verify_history(out, experiment.case_root(out, request["case_id"]),
                                          state["cases"][request["case_id"]])
                worker = Executor(out, request["case_id"])
            except BaseException as error:
                fail_experiment(out, state, error)
                raise
            # Invalid controller input is refused before runtime probes, staging,
            # role identities or budget events. It must not fence a healthy run.
            selected = worker.research_files(request) if command in ("creator", "verifier-plan") else {}
            if command == "verifier":
                worker.review_verifier(request)
            try:
                worker.check_research(selected)
                ready = read_json(out / "preflight.json")
                require(ready.get("runtime", {}).get("fingerprint"),
                        "This executor requires a runtime-checked init; resume old runs with their recorded Skill")
                check_runtime(out, state["config"], expected=ready["runtime"]["fingerprint"])
            except BaseException as error:
                fail_experiment(out, state, error)
                raise
            try:
                result = getattr(worker, command.replace("-", "_"))(request)
                if command.startswith("verifier") and recovery.policy(state["config"]):
                    case = result["cases"][request["case_id"]]
                    attempt = case["attempts"][-1]
                    if attempt.get("finished") and experiment.workflow.verifier_failed(attempt):
                        require(recovery.remaining(case, state["config"])["verifier_repairs"] > 0 and
                                len(case["attempts"]) < state["config"]["max_refinement_retries"],
                                "Verifier repair budget exhausted")
                if command.startswith("verifier") and state["config"].get("stop_on_recurrence"):
                    attempt = result["cases"][request["case_id"]]["attempts"][-1]
                    require(not attempt.get("finished") or experiment.workflow.measured(attempt),
                            "Verification produced no valid measurement; stop_on_recurrence is enabled")
                    require(not attempt.get("finished") or not experiment.workflow.verifier_failed(attempt),
                            "Verification protocol failed; stop_on_recurrence is enabled: " + str(attempt.get("coverage_error")))
                return result
            except BaseException as error:
                if state["config"].get("stop_on_recurrence") or recovery.policy(state["config"]):
                    fail_experiment(out, state, error)
                raise
        if command in ("resume-delivery", "resume-verifier"):
            require((out / "STOP").exists(), "No stopped experiment to continue")
            require(request.get("case_id") in state["cases"], "Case is not in the construction set")
            experiment.verify_history(out, experiment.case_root(out, request["case_id"]),
                                      state["cases"][request["case_id"]])
            worker = Executor(out, request["case_id"], allow_stopped=True)
            return getattr(worker, command.replace("-", "_"))(request)
        raise ValueError("Unknown executor operation")


def main():
    def cancelled(_signum, _frame):
        raise KeyboardInterrupt("Executor received a termination signal")
    signal.signal(signal.SIGTERM, cancelled)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["preflight", "init", "event", "creator", "verifier-plan", "verifier",
                                            "resume-delivery", "resume-verifier", "status", "next", "stop", "recover"])
    parser.add_argument("out", type=Path)
    parser.add_argument("request", nargs="?", type=Path)
    args = parser.parse_args()
    try:
        result = run(args.command, args.out, read_json(args.request) if args.request else None)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"OpenSkill executor: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()

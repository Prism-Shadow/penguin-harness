"""Bind OpenSkill to a published Project Benchmark without reading scoring material.

inspect reads manifests and construction statements; held-out statements stay closed.
stage copies public inputs from an already pinned checkout into a fresh scratch directory.
Neither command launches Harbor, builds an image, reads a rubric, or calls a model.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys
import tomllib
from urllib.parse import urlsplit

sys.dont_write_bytecode = True


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]+", value), "Invalid identifier")
    return value


def relative(value):
    path = PurePosixPath(value)
    require(value and not path.is_absolute() and ".." not in path.parts
            and "\\" not in value and not any(ord(c) < 32 for c in value), "Unsafe relative path")
    return path


def inside(root, name):
    root = Path(root).resolve(strict=True)
    path = root
    for part in relative(name).parts:
        path = path / part
        require(not path.is_symlink(), "Symlinks are not public benchmark inputs")
    require(path.resolve().is_relative_to(root), "Path escapes its declared root")
    return path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(project, benchmark_id):
    root = inside(project, "benchmarks/" + identifier(benchmark_id))
    manifest = inside(root, "benchmark_config.toml")
    raw = manifest.read_bytes()
    config = tomllib.loads(raw.decode())
    require(config.get("id", benchmark_id) == benchmark_id, "Benchmark id differs from its directory")
    require(config.get("status") not in ("draft", "failed"), "Benchmark is not published")
    cases = sorted(p.name for p in root.iterdir() if p.name.startswith("CASE-") and p.is_dir())
    require(cases, "Benchmark has no Cases")
    for case in cases:
        identifier(case)
        inside(root, case)  # Refuse links even for held-out metadata, without opening its files.
    runs = config.get("runs", 1)
    if type(runs) is not int or runs < 1:
        runs = 1
    return {"id": benchmark_id, "title": config.get("title", benchmark_id),
            "directory": str(root), "manifest_sha256": digest(raw),
            "version": config.get("version"), "runs": runs, "case_ids": cases}


def harbor_case(statement, case_id):
    """Parse values, never execute a statement's shell text or guess a task from its Case id."""
    if "## How this case is run" not in statement or "harbor run" not in statement:
        return None
    blocks = re.findall(r"```(?:bash|sh)?\s*\n(.*?)```", statement, re.S)
    launches = [b for b in blocks if "harbor run" in b]
    require(len(launches) == 1, "Expected exactly one Harbor launch")
    words = shlex.split(launches[0].replace("\\\n", " "))
    def option(name):
        require(words.count(name) == 1 and words.index(name) + 1 < len(words), "Missing/duplicate " + name)
        return words[words.index(name) + 1]
    task_path, task = option("-p"), identifier(option("-i"))
    relative(task_path)
    require(re.sub(r"^CASE-\d+-", "", case_id) == task, "Case id and Harbor task disagree")
    require(not ("--allow-agent-host" in words and "--extra-docker-compose" in words),
            "A no-network task cannot use the shared-network overlay")
    link = re.search(r"^- Task:.*?(https://\S+)", statement, re.M)
    require(link is not None, "Missing task source link")
    url = link[1].rstrip(").,`")
    parsed = urlsplit(url)
    require(parsed.scheme == "https" and parsed.hostname == "github.com" and not parsed.query
            and not parsed.fragment and not parsed.username, "Expected a GitHub task tree link")
    parts = parsed.path.strip("/").split("/")
    require(len(parts) > 4 and parts[2] == "tree", "Expected a repository tree link")
    suffix = "/" + str(PurePosixPath(task_path) / task)
    tail = "/".join(parts[3:])
    require(tail.endswith(suffix), "Task link and launch directory disagree")
    ref = tail[:-len(suffix)]
    require(ref and not ref.startswith("-") and ".." not in ref.split("/"), "Invalid source revision")
    harbor_version = re.search(r"\bharbor==([0-9]+\.[0-9]+\.[0-9]+)\b", launches[0])
    require(harbor_version is not None, "Harbor version must be pinned")
    return {"repository": f"https://github.com/{parts[0]}/{parts[1]}", "ref": ref,
            "task_path": task_path, "task": task, "harbor_version": harbor_version[1],
            "agent": option("-a"), "no_network": "--allow-agent-host" in words,
            "shared_network": "--extra-docker-compose" in words}


def inspect(project, benchmark_id, test_benchmark_id=None, case_ids=None, runs=None, test_case_ids=None):
    project = Path(project).resolve(strict=True)
    construction = package(project, benchmark_id)
    require(not (benchmark_id.startswith("penguinharness-benchmark-gdpevo-") and benchmark_id.endswith("-test")),
            "Use the paired GDPevo Train package for construction, or evaluate an already frozen library")
    selected = construction["case_ids"] if case_ids is None else case_ids
    require(selected and len(set(selected)) == len(selected)
            and set(selected) <= set(construction["case_ids"]), "Invalid construction Case selection")
    cases = []
    for case_id in selected:
        path = inside(construction["directory"], case_id + "/statement/README.md")
        raw = path.read_bytes()
        cases.append({"case_id": case_id, "statement_sha256": digest(raw),
                      "harbor": harbor_case(raw.decode(), case_id)})
    grouped = any(c["harbor"] and c["harbor"]["task"] == "train_tasks" for c in cases)
    if grouped and test_benchmark_id is None:
        require(benchmark_id.startswith("penguinharness-benchmark-gdpevo-")
                and benchmark_id.endswith("-train"), "Select an explicit held-out Benchmark for grouped training")
        test_benchmark_id = benchmark_id[:-len("-train")] + "-test"
    if test_benchmark_id is not None:
        require(test_benchmark_id != benchmark_id, "Held-out Benchmark must differ from construction")
        evaluation = package(project, test_benchmark_id)  # Deliberately no Test statement or rubric access.
        if test_case_ids is not None:
            require(test_case_ids and len(set(test_case_ids)) == len(test_case_ids)
                    and set(test_case_ids) <= set(evaluation["case_ids"]), "Invalid held-out Case selection")
            evaluation = {**evaluation, "case_ids": test_case_ids}
    else:
        require(test_case_ids is None, "Held-out Case selection requires a Test Benchmark")
        evaluation = {**construction, "case_ids": selected}
    # Repetitions measure one frozen State; manifest runs remain provenance, not
    # an instruction to retrain or silently reduce the controller's test plan.
    runs = 3 if runs is None else runs
    require(type(runs) is int and runs > 0, "runs must be a positive integer")
    return {"schema_version": 1, "project": str(project), "construction": construction,
            "cases": cases, "evaluation": evaluation, "runs": runs,
            "protocol": "held-out" if test_benchmark_id else "same-task",
            "grouped_training": grouped,
            "config": {"benchmark_id": benchmark_id, "case_ids": selected, "runs": runs,
                       **({"test_benchmark_id": test_benchmark_id,
                           "test_case_ids": evaluation["case_ids"]} if test_benchmark_id else {})}}


def verify_checkout(checkout, revision):
    require(re.fullmatch(r"[0-9a-f]{40}", revision) is not None, "Pin a full source commit")
    checkout = Path(checkout).resolve(strict=True)
    if (checkout / ".git").exists():
        head = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
        require(head == revision, "Checkout is at a different commit")
        dirty = subprocess.check_output(["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"], text=True)
        require(not dirty.strip(), "Pinned checkout has modified tracked files")
    else:
        # Matches the host's archive-checkout protocol in agent-evaluation/reference/harbor.md.
        require(checkout.name.endswith("-" + revision) and inside(checkout, ".penguin-ready").is_file(),
                "Archive checkout needs its commit-qualified name and .penguin-ready marker")
    return checkout


def public_tree(root):
    """Only called on a selected public subtree, never on a task/checkout root."""
    files = {}
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "Symlink in public inputs")
        if path.is_dir():
            continue
        require(path.is_file() and path.stat().st_nlink == 1, "Unsafe public input")
        rel = path.relative_to(root)
        require(not any(p.lower() in {"tests", "solution", "solutions", "rubric", "skills", "research",
                                      "scoreboard.yaml", ".jobs"} or p.startswith(".") for p in rel.parts),
                "Private material in a declared public subtree; review it before staging")
        files[rel.as_posix()] = path
    return files


def validate_binding(config):
    """A native group cannot silently turn into a supervised Train evaluation."""
    binding = config.get("benchmark_binding")
    if binding is None:
        return  # Existing journals keep their original contract.
    require(isinstance(binding, dict) and binding.get("schema_version") == 1, "Invalid benchmark binding")
    declared = binding["config"]
    for field in ("benchmark_id", "case_ids", "test_benchmark_id", "test_case_ids", "runs"):
        require(config.get(field) == declared.get(field), f"Benchmark binding differs: {field}")
    require([c["case_id"] for c in binding["cases"]] == config["case_ids"], "Construction binding is incomplete")
    if binding["grouped_training"]:
        require(config.get("test_benchmark_id") and binding["protocol"] == "held-out",
                "Grouped GDPevo training must evaluate its held-out package after freeze")
    require(all(c.get("public_sha256") and c.get("public_directory") for c in binding["cases"]),
            "Stage and review public inputs before initializing a native experiment")
    verify(binding)


def verify(binding):
    """Recheck frozen package/public bytes without opening any held-out question."""
    config = binding["config"]
    current = inspect(binding["project"], config["benchmark_id"],
                      test_benchmark_id=config.get("test_benchmark_id"),
                      case_ids=config["case_ids"], runs=config["runs"],
                      test_case_ids=config.get("test_case_ids"))
    for section in ("construction", "evaluation"):
        for key in ("id", "directory", "manifest_sha256", "case_ids"):
            require(current[section][key] == binding[section][key], "Benchmark package changed: " + section)
    for before, after in zip(binding["cases"], current["cases"], strict=True):
        require(before["case_id"] == after["case_id"]
                and before["statement_sha256"] == after["statement_sha256"], "Construction statement changed")
        root = Path(before["public_directory"])
        require(not root.is_symlink(), "Linked public staging directory")
        actual = {rel: digest(path.read_bytes()) for rel, path in public_tree(root).items()}
        require(actual == before["public_sha256"], "Staged public inputs changed")
    return {"verified": True, "benchmark_id": config["benchmark_id"],
            "evaluation_benchmark_id": current["evaluation"]["id"]}


def task_inputs(checkout, case):
    source = case["harbor"]
    task = inside(checkout, source["task_path"] + "/" + source["task"])
    config_path = inside(task, "task.toml")
    config = tomllib.loads(config_path.read_text())
    metadata = config.get("metadata", {})
    files = {}
    grouped = source["task"] == "train_tasks"
    if grouped:
        require(metadata.get("split") == "train" and metadata.get("task_group"),
                "Grouped training needs explicit Train/task-group metadata")
        training = inside(task, "environment/workspace/train_tasks")
        questions = sorted(p.name for p in training.iterdir() if p.is_dir())
        require(questions and all(re.fullmatch(r"train_\d+", p) for p in questions), "Unexpected training input layout")
        for question in questions:
            root = inside(training, question)
            files[f"train_tasks/{question}/instruction.md"] = inside(root, "instruction.md")
            for rel, path in public_tree(inside(root, "input")).items():
                files[f"train_tasks/{question}/input/{rel}"] = path
        # The group wrapper advertises the real training judge. Roles get individual public
        # questions plus an OpenSkill submission contract, never that launch/feedback recipe.
        prompt = ("Complete the public training questions listed below using reusable skills and independent "
                  "virtual verification. Real training scores and /api/judge are unavailable. "
                  "For each question, follow its own instruction and answer template.\n\n" +
                  "\n".join(f"- train_tasks/{q}/instruction.md -> answers/{q}.json" for q in questions) + "\n")
        outputs = [f"answers/{q}.json" for q in questions]
    else:
        prompt = inside(task, "instruction.md").read_text()
        inputs = inside(task, "environment/workspace/input")
        if inputs.is_dir():
            files.update({"input/" + rel: p for rel, p in public_tree(inputs).items()})
        outputs = None  # Controller derives exact deliverables from this task's public instruction.
    env = inside(task, "environment")
    shared = inside(checkout, source["task_path"] + "/env")
    return {"task": task, "prompt": prompt, "files": files, "outputs": outputs,
            "grouped_training": grouped, "question_count": len(outputs) if outputs else None,
            "environment": {"directory": str(env), "shared_env": str(shared) if shared.is_dir() else None,
                            "startup_profile": "gdpevo" if metadata.get("task_group") else None,
                            "review_required": True},
            "task_config_sha256": digest(config_path.read_bytes())}


def stage(project, benchmark_id, checkout, revision, out, **options):
    plan = inspect(project, benchmark_id, **options)
    has_harbor = any(c["harbor"] for c in plan["cases"])
    if has_harbor:
        require(checkout is not None and revision is not None, "Harbor needs a pinned checkout")
        checkout = verify_checkout(checkout, revision)
    out = Path(out).absolute()
    require(not out.exists() and not out.is_symlink(), "Use a fresh binding directory; never overwrite evidence")
    # Runtime writes belong to the controller's scratchpad, not the Benchmark, Target or checkout.
    project = Path(plan["project"])
    parent = out.parent.resolve(strict=True)
    relative_parent = parent.relative_to(project / "agents")
    require(len(relative_parent.parts) >= 3 and relative_parent.parts[1] == "scratchpad",
            "Binding output must be under an Agent Session scratchpad")
    require(not has_harbor or not parent.is_relative_to(checkout), "Do not write into the pinned checkout")
    prepared = []
    repos = set()
    for case in plan["cases"]:
        source = case["harbor"]
        if source:
            repos.add(source["repository"])
            if re.fullmatch(r"[0-9a-f]{40}", source["ref"]):
                require(source["ref"] == revision, "Statement pins another commit")
            item = task_inputs(checkout, case)
        else:
            root = inside(plan["construction"]["directory"], case["case_id"] + "/statement")
            item = {"prompt": (root / "README.md").read_text(), "files": public_tree(root),
                    "outputs": None, "grouped_training": False, "environment": {"review_required": True}}
        # Materialize in memory first so invalid input cannot leave a plausible partial binding.
        for path in item["files"].values():
            require(path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1,
                    "Unsafe public file")
        require(not source or "task.md" not in item["files"], "Public inputs collide with the staged task contract")
        item["bytes"] = {rel: path.read_bytes() for rel, path in item["files"].items()}
        prepared.append((case, item))
    require(len(repos) <= 1, "Use separate bindings for different source repositories")
    refs = {c["harbor"]["ref"] for c in plan["cases"] if c["harbor"]}
    require(len(refs) <= 1, "Resolve differing source refs in separate bindings")
    out.mkdir()
    plan["source_pin"] = ({"repository": next(iter(repos), None), "commit": revision,
                           "checkout": str(checkout)} if has_harbor else None)
    for case, item in prepared:
        public = out / case["case_id"] / "public"
        public.mkdir(parents=True)
        data = ({"task.md": item["prompt"].encode(), **item["bytes"]}
                if case["harbor"] else item["bytes"])
        manifest = {}
        for rel, content in data.items():
            dest = public / relative(rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
            manifest[rel] = digest(content)
        case.update(public_directory=str(public), public_sha256=manifest,
                    instruction="task.md" if case["harbor"] else "README.md", outputs=item["outputs"],
                    environment=item["environment"], grouped_training=item["grouped_training"],
                    question_count=item.get("question_count"), task_config_sha256=item.get("task_config_sha256"))
    (out / "binding.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    checker = sub.add_parser("verify")
    checker.add_argument("binding", type=Path)
    for name in ("inspect", "stage"):
        p = sub.add_parser(name)
        p.add_argument("project", type=Path)
        p.add_argument("benchmark")
        p.add_argument("--test-benchmark")
        p.add_argument("--case", dest="case_ids", action="append")
        p.add_argument("--test-case", dest="test_case_ids", action="append")
        p.add_argument("--runs", type=int)
        if name == "stage":
            p.add_argument("--checkout", type=Path)
            p.add_argument("--revision")
            p.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "verify":
        print(json.dumps(verify(json.loads(args.binding.read_text())), indent=2))
        return
    options = dict(test_benchmark_id=args.test_benchmark, case_ids=args.case_ids,
                   test_case_ids=args.test_case_ids, runs=args.runs)
    if args.command == "inspect":
        result = inspect(args.project, args.benchmark, **options)
    else:
        result = stage(args.project, args.benchmark, args.checkout, args.revision, args.out, **options)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"OpenSkill benchmark binding: {error}", file=sys.stderr)
        raise SystemExit(2)

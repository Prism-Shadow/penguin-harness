#!/usr/bin/env python3
"""Check portable skill artifacts and usage records without executing learned code."""

import argparse
import hashlib
import json
import re
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=unique)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False).encode()).hexdigest()


def tree(root, allow_empty=False):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), f"Expected a real directory: {root}")
    result = {}
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), f"Symlink in artifact: {path}")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            require(path.is_dir(), f"Special file in artifact: {path}")
    require(result or allow_empty, f"Empty artifact: {root}")
    return result


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value)
            and value not in (".", ".."), "Invalid identifier")
    return value


def strings(values, label, allow_empty=False):
    require(isinstance(values, list) and (values or allow_empty), f"Expected {label} list")
    require(all(isinstance(x, str) and x.strip() for x in values), f"Invalid {label}")
    require(len(values) == len(set(values)), f"Duplicate {label}")


def local_file(root, relative):
    require(isinstance(relative, str) and relative, "Missing resource path")
    path = Path(relative)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in relative,
            "Resource must be a relative path inside its skill")
    target = root / path
    require(target.resolve().is_relative_to(root.resolve()) and target.is_file()
            and not target.is_symlink(), f"Missing or escaping resource: {relative}")
    return target


def check_case(root, case_id, names, forbidden_prefixes=()):
    root = Path(root)
    identifier(case_id)
    strings(names, "planned skills")
    require(1 <= len(names) <= 4, "A plan must contain 1–4 skills")
    files = tree(root)
    require({p.parts[0] for p in map(Path, files)} == set(names), "Skill directories differ from plan")
    for name in names:
        require(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name), "Invalid skill name")
        skill = root / name
        text = (skill / "SKILL.md").read_text(encoding="utf-8")
        front = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
        require(front is not None, f"Missing frontmatter: {name}")
        for key in ("name", "description", "version"):
            values = re.findall(rf"^{key}:\s*([^\n]+)$", front.group(1), re.M)
            require(len(values) == 1 and values[0].strip(), f"Invalid {key}: {name}")
            if key == "name":
                require(values[0].strip().strip("\"'") == name, "Skill name differs from directory")
            if key == "version":
                require(re.fullmatch(r"\d{4}\.\d{2}\.\d{2}\.\d+", values[0].strip().strip("\"'")),
                        "Skill version must be dated")
        contract = read_json(skill / "contract.json")
        require(isinstance(contract, dict) and contract.get("id") == f"{case_id}/{name}",
                "Contract id differs from planned skill")
        require(isinstance(contract.get("applies_when"), str) and contract["applies_when"].strip(),
                "Missing public applicability")
        parameters = contract.get("parameters")
        require(isinstance(parameters, dict) and all(isinstance(k, str) and k and
                isinstance(v, str) and v.strip() for k, v in parameters.items()), "Invalid parameters")
        for field in ("outputs", "checks", "limitations", "resources"):
            strings(contract.get(field), field, allow_empty=field in ("limitations", "resources"))
        for resource in contract["resources"]:
            local_file(skill, resource)
        payload = {p[len(name) + 1:] for p in files if p.startswith(name + "/")}
        resources = payload - {"SKILL.md", "contract.json"}
        require(resources == set(contract["resources"]), "Declare every deployed resource in contract.json")
        require(all(Path(p).parts[0] in ("scripts", "references", "assets")
                    and "__pycache__" not in Path(p).parts and not p.endswith(".pyc") for p in resources),
                "Only declared scripts, references and assets belong in the skill")
    # Reject known practice roots, not legitimate absolute paths such as /usr/bin/python3.
    for relative in files:
        path = root / relative
        if path.suffix in (".md", ".json", ".py", ".sh", ".yaml", ".yml", ".toml", ".txt"):
            content = path.read_text(encoding="utf-8")
            require(not any(prefix in content for prefix in forbidden_prefixes),
                    f"Practice path embedded in skill: {relative}")
    return {"sha256": digest(files), "files": files,
            "skill_ids": [f"{case_id}/{name}" for name in names]}


def check_library(root, plans, forbidden_prefixes=()):
    root = Path(root)
    files = tree(root)
    require((root / "SKILL.md").is_file() and (root / "index.md").is_file(), "Missing library reader/index")
    require(set(p.name for p in root.iterdir()) == {"SKILL.md", "index.md", "tasks"},
            "Only reader, index and tasks may enter library")
    require(set(p.name for p in (root / "tasks").iterdir()) == set(plans), "Library cases differ from plan")
    index = (root / "index.md").read_text(encoding="utf-8")
    cases = {}
    for case_id, names in plans.items():
        cases[case_id] = check_case(root / "tasks" / case_id, case_id, names, forbidden_prefixes)
        for name in names:
            require(f"tasks/{case_id}/{name}/SKILL.md" in index, f"Missing index entry: {case_id}/{name}")
    for filename in ("SKILL.md", "index.md"):
        require(not any(p in (root / filename).read_text(encoding="utf-8") for p in forbidden_prefixes),
                "Practice path embedded in reader/index")
    return {"sha256": digest(files), "files": files, "cases": cases}


def check_usage(library, usage):
    """Validate self-report structure only; trace evidence still needs an independent reader."""
    files = tree(library)
    require(usage.get("library_sha256") == digest(files), "Usage refers to another library")
    ids = {read_json(Path(library) / p)["id"] for p in files if p.endswith("/contract.json")}
    entries = usage.get("skills")
    require(isinstance(entries, list), "Missing usage entries")
    seen = set()
    for entry in entries:
        skill_id = entry.get("id")
        require(skill_id in ids and skill_id not in seen, "Unknown or duplicate usage id")
        seen.add(skill_id)
        require(entry.get("status") in ("selected", "read", "applied"), "Invalid usage status")
        strings(entry.get("evidence"), "trace evidence", allow_empty=entry["status"] == "selected")
    if not entries:
        require(isinstance(usage.get("reason"), str) and usage["reason"].strip(), "Explain an empty usage record")
    return {"status": "ok", "evidence_level": "self_report_only", "skills": entries,
            "library_sha256": usage["library_sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check")
    check.add_argument("library", type=Path)
    check.add_argument("plan", type=Path, help="JSON object mapping Case ids to planned skill names")
    check.add_argument("--forbid-prefix", action="append", default=["/opt/openskill-skills"])
    usage = sub.add_parser("usage")
    usage.add_argument("library", type=Path)
    usage.add_argument("record", type=Path)
    args = parser.parse_args()
    try:
        result = (check_library(args.library, read_json(args.plan), args.forbid_prefix)
                  if args.command == "check" else check_usage(args.library, read_json(args.record)))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print(json.dumps({"status": "failed", "message": str(exc)}, ensure_ascii=False))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Run the actual configured host SDK, before any construction clock or model turn."""
import shutil
import uuid
from pathlib import Path
from artifacts import require, read_json
from isolation import capture, save

HERE = Path(__file__).resolve().parent


def check_runtime(out, request, *, session=False, expected=None):
    folder = out / ".executor" / "runtime" / uuid.uuid4().hex
    folder.mkdir(parents=True)
    agent_id = "openskill_probe_" + folder.name
    agent_path = (Path(request["executor"]["penguin_home"]) / request["executor"]["project_id"] /
                  "agents" / agent_id) if session else None
    if agent_path:
        require(not agent_path.exists(), "Probe identity already exists")
    save(folder / "request.json", {"executor": request["executor"], "runtime": request.get("runtime"),
                                   "check_session": session, "probe_agent_id": agent_id})
    try:
        result = capture([request["executor"]["node"], str(HERE / "runtime.mjs"),
                          str(folder / "request.json"), str(folder / "report.json")], timeout=60)
    finally:
        # capture kills and reaps the probe process group, including on timeout/cancellation.
        if agent_path and agent_path.exists():
            require(not agent_path.is_symlink(), "Linked probe Agent cannot be cleaned")
            shutil.rmtree(agent_path)
    save(folder / "process.json", result)
    report = read_json(folder / "report.json") if (folder / "report.json").is_file() else {
        "status": "failed", "stage": "probe_process", "error": "SDK probe did not produce a report"}
    require(result.get("exit_code") == 0 and report.get("status") == "ready" and report.get("cleanup_confirmed"),
            f"Runtime preflight failed ({report.get('stage')}): {report.get('error')}; inspect {folder}")
    if expected is not None:
        require(report["fingerprint"] == expected, "Runtime changed after initialization; use a new experiment")
    return {**report, "record": str(folder.relative_to(out))}

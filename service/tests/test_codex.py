"""The ChatGPT subscription through Codex: the real service on a real port, with a stand-in for the Codex client."""

import socket
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn
from conftest import TOKEN
from reading import read_all, start, workbook
from test_workflow import answer, settle, waiting

from tawreed import settings
from tawreed.ai import codex, connections
from tawreed.api.app import create_app
from tawreed.workflow.records import StepRecord

FAKE = Path(__file__).with_name("fake_codex.py")
SIGNED_IN = {"installed": True, "version": "0.153.4", "signed_in": True}


@pytest.fixture
def live(tmp_path, monkeypatch):
    """The service listening on a free port, with the stand-in as its Codex."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    app = create_app(tmp_path, TOKEN, port)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started:
        assert time.monotonic() < deadline, "the service didn't start"
        time.sleep(0.05)
    monkeypatch.setattr(codex, "executable", lambda: [sys.executable, str(FAKE)])
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with httpx.Client(base_url=f"http://127.0.0.1:{port}", headers=headers, timeout=60) as client:
        client.app = app
        yield client
    server.should_exit = True
    thread.join(timeout=15)


def until(client, project_id, condition, seconds=30.0) -> dict:
    """The project's work once the condition holds, whether or not a step is still running."""
    deadline = time.monotonic() + seconds
    while True:
        work = client.get(f"/projects/{project_id}/work").json()
        if condition(work):
            return work
        assert time.monotonic() < deadline, f"The work did not get there in time: {work}"
        time.sleep(0.1)


def use_codex(home: Path) -> None:
    connection = connections.add(home, "codex", codex.LABEL, "", None)
    connections.record_check(home, connection["id"], "gpt-5.5", True, None, False)
    settings.save(home, ai={"connection_id": connection["id"], "model": "gpt-5.5"})


def started(client) -> str:
    """A project read and allowed to go to the service, so the workflow starts."""
    project_id = read_all(client, start(client, {"Tower BOQ.xlsx": workbook()})["id"])["id"]
    work = settle(client, project_id, waiting("consent"))
    assert (work["decisions"][0]["provider"], work["decisions"][0]["host"]) == ("codex", None)
    answer(client, project_id, work, "consent", approve=True)
    return project_id


def runs(client, project_id) -> list[StepRecord]:
    with client.app.state.sessions() as session:
        return session.query(StepRecord).filter_by(project_id=project_id).order_by(StepRecord.id).all()


def test_a_step_runs_through_codex_with_only_its_own_tools(live, tmp_path):
    use_codex(tmp_path)
    project_id = started(live)

    work = until(live, project_id, lambda w: w["run"]["state"] == "paused")  # the stand-in never lays pages out
    assert work["run"]["problem"] == {"code": "no_progress", "step": "read"}
    first = runs(live, project_id)[0]
    assert (first.step, first.model, first.ended) == ("read", "codex gpt-5.5", "done")
    assert first.calls[0]["tool"] == "list_items" and "isn't part of this step" in first.calls[0]["sent_back"]
    assert first.calls[1] == {"tool": "read_sheet", "sent_back": None}
    assert (first.input_tokens, first.output_tokens) == (1200, 80)
    assert live.app.state.runs.get(None) is None  # every run's token is closed afterwards


def test_stop_ends_a_codex_run_at_once(live, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_WAIT", "60")
    use_codex(tmp_path)
    project_id = started(live)
    work = until(live, project_id, lambda w: w["run"]["state"] == "running")
    assert (work["run"]["step"], work["run"]["file"], work["run"]["total"]) == ("read", "Tower BOQ.xlsx", 3)

    stopped_at = time.monotonic()
    assert live.post(f"/projects/{project_id}/stop").status_code == 204
    until(live, project_id, lambda w: bool(runs(live, project_id)) and bool(runs(live, project_id)[-1].ended))
    assert time.monotonic() - stopped_at < 15
    assert runs(live, project_id)[-1].ended == "stopped"
    work = until(live, project_id, lambda w: w["run"]["state"] == "paused")
    assert work["run"]["problem"] == {"code": "stopped"}


def test_a_signed_out_codex_pauses_the_project_with_a_plain_reason(live, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_FAIL", "1")
    use_codex(tmp_path)
    project_id = started(live)
    work = until(live, project_id, lambda w: w["run"]["state"] == "paused")
    assert work["run"]["problem"] == {"code": "ai_failed", "problem": "codex_signed_out"}


def test_codex_is_added_once_signed_in_and_checked_through_tawreeds_tools(live, monkeypatch):
    monkeypatch.setattr(codex, "status", lambda: {**SIGNED_IN, "signed_in": False})
    refused = live.post("/ai/connections", json={"provider": "codex"})
    assert refused.status_code == 400 and refused.json()["detail"]["code"] == "codex_signed_out"

    monkeypatch.setattr(codex, "status", lambda: SIGNED_IN)
    assert live.get("/ai/codex").json() == SIGNED_IN
    added = live.post("/ai/connections", json={"provider": "codex"})
    assert added.status_code == 201
    connection = added.json()
    assert (connection["provider"], connection["label"], connection["key_hint"]) == ("codex", "ChatGPT (Codex)", "")
    assert live.post("/ai/connections", json={"provider": "codex"}).json()["id"] == connection["id"]  # only one

    checked = live.post(f"/ai/connections/{connection['id']}/checks", json={"model": "gpt-5.5"}).json()
    assert checked["checks"]["gpt-5.5"]["ok"] is True
    assert checked["checks"]["gpt-5.5"]["sees_images"] is False  # the stand-in can't read the image


def test_tawreeds_mcp_endpoint_answers_only_a_live_run(live):
    for headers in ({}, {"Authorization": "Bearer not-a-run"}, {"Authorization": f"Bearer {TOKEN}"}):
        response = httpx.post(f"{live.base_url}/mcp/", headers=headers, json={}, timeout=10)
        assert response.status_code == 401, headers  # not even the service's own token


def test_codex_runs_locked_down(tmp_path):
    argv = codex.command("gpt-5.5", tmp_path, "http://127.0.0.1:9/mcp/", [])
    joined = " ".join(argv)
    for expected in (
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--sandbox read-only",
        'web_search="disabled"',
        "mcp_servers.tawreed.required=true",
        'mcp_servers.tawreed.default_tools_approval_mode="approve"',
        'mcp_servers.tawreed.bearer_token_env_var="TAWREED_MCP_TOKEN"',
    ):
        assert expected in joined
    assert {argv[i + 1] for i, a in enumerate(argv) if a == "--disable"} == set(codex.FEATURES_OFF)
    assert argv[-1] == "-"  # the prompt goes in on standard input

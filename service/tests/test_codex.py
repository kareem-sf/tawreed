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
from test_agent import answer, settle, waiting

from tawreed import settings
from tawreed.agent.records import TurnRecord
from tawreed.ai import codex, connections
from tawreed.api.app import create_app

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
    """The project's work once the condition holds, whether or not the agent is still working."""
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
    """A project read and allowed to go to the service, so the agent starts."""
    project_id = read_all(client, start(client, {"Tower BOQ.xlsx": workbook()})["id"])["id"]
    work = settle(client, project_id, waiting("consent"))
    assert (work["decisions"][0]["provider"], work["decisions"][0]["host"]) == ("codex", None)
    answer(client, project_id, work, "consent", approve=True)
    return project_id


def turns(client, project_id) -> list[TurnRecord]:
    with client.app.state.sessions() as session:
        return session.query(TurnRecord).filter_by(project_id=project_id).order_by(TurnRecord.id).all()


def test_a_turn_runs_through_codex_with_tawreeds_tools(live, tmp_path):
    use_codex(tmp_path)
    project_id = started(live)

    work = until(live, project_id, lambda w: any(m["sender"] == "agent" for m in w["messages"]))
    until(live, project_id, lambda w: bool(turns(live, project_id)[0].ended))
    live.post(f"/projects/{project_id}/stop")  # the stand-in never lays the pages out, so the agent would go on
    assert [m["text"] for m in work["messages"] if m["sender"] == "agent"][0] == "Codex here: I read the file list."
    first = turns(live, project_id)[0]
    assert first.model == "codex gpt-5.5" and first.ended == "done"
    assert first.calls == [{"tool": "list_files", "sent_back": None}, {"tool": "message_engineer", "sent_back": None}]
    assert (first.input_tokens, first.output_tokens) == (1200, 80)
    assert live.app.state.runs.get(None) is None  # every run's token is closed afterwards


def test_stop_ends_a_codex_run_at_once(live, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_WAIT", "60")
    use_codex(tmp_path)
    project_id = started(live)
    until(live, project_id, lambda w: w["agent"] == "working")

    stopped_at = time.monotonic()
    assert live.post(f"/projects/{project_id}/stop").status_code == 204
    until(live, project_id, lambda w: bool(turns(live, project_id)) and bool(turns(live, project_id)[-1].ended))
    assert time.monotonic() - stopped_at < 15
    assert turns(live, project_id)[-1].ended == "stopped"
    work = until(live, project_id, lambda w: w["agent"] == "paused")
    assert not [m for m in work["messages"] if m["sender"] == "agent"]


def test_a_signed_out_codex_pauses_the_project_with_a_plain_reason(live, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_CODEX_FAIL", "1")
    use_codex(tmp_path)
    project_id = started(live)
    work = until(live, project_id, lambda w: w["agent"] == "paused")
    assert work["messages"][-1]["notice"] == "ai_failed"
    assert work["messages"][-1]["params"]["problem"] == "codex_signed_out"


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

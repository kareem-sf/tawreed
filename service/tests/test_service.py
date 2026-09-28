import pytest
from conftest import TOKEN
from fastapi.testclient import TestClient

from tawreed.api.app import create_app
from tawreed.core.home import data_home


def test_health_needs_no_token(tmp_path):
    with TestClient(create_app(tmp_path, TOKEN)) as c:
        assert c.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/projects", "/settings", "/about"])
@pytest.mark.parametrize("header", [None, "Bearer wrong", TOKEN])
def test_everything_else_needs_the_launch_token(tmp_path, path, header):
    headers = {"Authorization": header} if header else {}
    with TestClient(create_app(tmp_path, TOKEN)) as c:
        response = c.get(path, headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == {"code": "wrong_token"}


def test_data_home_follows_tawreed_home(monkeypatch, tmp_path):
    monkeypatch.setenv("TAWREED_HOME", str(tmp_path / "scratch"))
    assert data_home() == tmp_path / "scratch"
    monkeypatch.delenv("TAWREED_HOME")
    assert data_home().name == ".tawreed"


def test_settings_default_and_change(client, tmp_path):
    assert client.get("/settings").json() == {"language": "en", "theme": "system", "ai": None}
    assert client.patch("/settings", json={"language": "ar"}).json() == {
        "language": "ar",
        "theme": "system",
        "ai": None,
    }
    assert client.patch("/settings", json={"theme": "dark"}).json() == {"language": "ar", "theme": "dark", "ai": None}
    assert client.patch("/settings", json={"language": None}).json()["language"] == "ar"  # null leaves it as it is
    assert (tmp_path / "settings.json").exists()


@pytest.mark.parametrize("body", [{"language": "fr"}, {"theme": "blue"}])
def test_settings_refuse_unknown_values(client, body):
    assert client.patch("/settings", json=body).status_code == 422


def test_about_names_the_version_and_data_folder(client, tmp_path):
    about = client.get("/about").json()
    assert about["version"] == "0.0.1"
    assert about["data_folder"] == str(tmp_path)


def test_the_service_stops_when_the_desktop_app_lets_go_of_it(tmp_path):
    """Run as the desktop app runs it: when its standard input closes (the app exited or crashed), it stops."""
    import os
    import socket
    import subprocess
    import sys
    import time
    import urllib.request

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "TAWREED_HOME": str(tmp_path), "TAWREED_TOKEN": TOKEN}
    service = subprocess.Popen(
        [sys.executable, "-m", "tawreed", "--port", str(port), "--exit-with-stdin"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    try:
        deadline = time.monotonic() + 60
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as answer:
                    assert answer.status == 200
                    break
            except OSError:
                assert time.monotonic() < deadline, "the service didn't start"
                time.sleep(0.2)
        service.stdin.close()
        assert service.wait(timeout=15) == 0
    finally:
        if service.poll() is None:
            service.kill()

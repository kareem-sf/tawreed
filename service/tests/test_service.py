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
    assert about["version"] == "0.1.0"
    assert about["data_folder"] == str(tmp_path)

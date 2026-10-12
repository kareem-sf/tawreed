"""A saved connection is tested against each provider's own failures, recorded as the SDKs raise them:
no key, a wrong key and no internet each get a code the interface explains. No test reaches a real provider."""

import httpx
import pytest
from anthropic import APIConnectionError, AuthenticationError
from google.genai import errors as google_errors
from grpc import StatusCode
from grpc.aio import AioRpcError, Metadata
from openai import APIConnectionError as OpenAIConnectionError
from openai import AuthenticationError as OpenAIAuthenticationError

from tawreed.ai import codex, connections, providers

REQUEST = httpx.Request("GET", "https://provider.example/v1/models")


def refused_http(error_class):
    response = httpx.Response(401, request=REQUEST, json={"error": {"message": "invalid x-api-key"}})
    return error_class("invalid x-api-key", response=response, body=None)


def grpc_error(code):
    return AioRpcError(code, Metadata(), Metadata(), details="recorded")


# What each provider's SDK raises for a wrong key, and for no internet.
WRONG_KEY = {
    "anthropic": refused_http(AuthenticationError),
    "openai": refused_http(OpenAIAuthenticationError),
    "google": google_errors.ClientError(
        400,
        {
            "error": {
                "code": 400,
                "message": "API key not valid. Please pass a valid API key.",
                "status": "INVALID_ARGUMENT",
            }
        },
    ),
    "xai": grpc_error(StatusCode.UNAUTHENTICATED),
    "openai_compatible": refused_http(OpenAIAuthenticationError),
}
OFFLINE = {
    "anthropic": APIConnectionError(request=REQUEST),
    "openai": OpenAIConnectionError(request=REQUEST),
    "google": httpx.ConnectError("[Errno -2] Name or service not known"),
    "xai": grpc_error(StatusCode.UNAVAILABLE),
    "openai_compatible": OpenAIConnectionError(request=REQUEST),
}
KEYED = ["anthropic", "openai", "google", "xai", "openai_compatible"]


@pytest.fixture
def listing(monkeypatch):
    """The provider's answer to listing models; set `.error` to make it fail."""

    class Listing:
        error: Exception | None = None

    async def list_models(provider, key, base_url):
        if Listing.error:
            raise Listing.error
        return ["model-a"]

    monkeypatch.setattr(providers, "list_models", list_models)
    return Listing


def saved(client, tmp_path, provider, key="sk-test-1234abcd"):
    base_url = "https://api.example.com/v1" if provider == "openai_compatible" else None
    return connections.add(tmp_path, provider, provider, key, base_url)["id"]


def run_test(client, tmp_path, provider):
    connection_id = saved(client, tmp_path, provider)
    response = client.post(f"/ai/connections/{connection_id}/test")
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("provider", KEYED)
def test_a_working_connection_passes(client, tmp_path, listing, provider):
    assert run_test(client, tmp_path, provider) == {"ok": True, "problem": None, "params": {}}


@pytest.mark.parametrize("provider", KEYED)
def test_no_key_says_so_without_calling_the_provider(client, tmp_path, listing, provider):
    listing.error = AssertionError("the provider must not be called without a key")
    connection_id = saved(client, tmp_path, provider, key="")
    result = client.post(f"/ai/connections/{connection_id}/test").json()
    assert result == {"ok": False, "problem": "key_missing", "params": {}}


@pytest.mark.parametrize("provider", KEYED)
def test_a_wrong_key_is_refused(client, tmp_path, listing, provider):
    listing.error = WRONG_KEY[provider]
    result = run_test(client, tmp_path, provider)
    assert result["ok"] is False
    assert result["problem"] == "key_refused"


@pytest.mark.parametrize("provider", KEYED)
def test_offline_says_the_service_is_unreachable(client, tmp_path, listing, provider):
    listing.error = OFFLINE[provider]
    assert run_test(client, tmp_path, provider)["problem"] == "unreachable"


@pytest.mark.parametrize("provider", KEYED)
def test_the_answer_never_carries_the_key(client, tmp_path, listing, provider):
    listing.error = WRONG_KEY[provider]
    assert "sk-test" not in str(run_test(client, tmp_path, provider))


def test_a_compatible_service_that_does_not_list_models_still_passes(client, tmp_path, listing):
    listing.error = google_errors.ClientError(
        404, {"error": {"code": 404, "message": "no /models", "status": "NOT_FOUND"}}
    )
    assert run_test(client, tmp_path, "openai_compatible")["ok"] is True
    assert run_test(client, tmp_path, "anthropic")["problem"] == "model_missing"


@pytest.mark.parametrize(
    ("state", "problem"),
    [
        ({"installed": False, "version": None, "signed_in": False}, "codex_missing"),
        ({"installed": True, "version": "1.0.0", "signed_in": False}, "codex_signed_out"),
        ({"installed": True, "version": "1.0.0", "signed_in": True}, None),
    ],
)
def test_codex_says_whether_it_is_installed_and_signed_in(client, tmp_path, monkeypatch, state, problem):
    monkeypatch.setattr(codex, "status", lambda: state)
    connection_id = connections.add(tmp_path, "codex", codex.LABEL, "", None)["id"]
    result = client.post(f"/ai/connections/{connection_id}/test").json()
    assert (result["ok"], result["problem"]) == (problem is None, problem)


def test_testing_a_connection_that_is_gone(client):
    assert client.post("/ai/connections/nope/test").json()["detail"] == {"code": "connection_not_found"}


def test_a_first_run_has_no_key_and_says_what_to_do(client, tmp_path, monkeypatch):
    monkeypatch.setattr(codex, "executable", lambda: None)
    assert client.get("/ai/connections").json() == []
    assert client.get("/settings").json()["ai"] is None
    assert client.get("/ai/codex").json() == {"installed": False, "version": None, "signed_in": False}
    project = client.post(
        "/projects", files=[("files", ("boq.csv", b"Item,Description,Unit,Qty\n1.1,Excavation,m3,10\n"))]
    )
    assert project.status_code == 201, project.text
    work = client.get(f"/projects/{project.json()['id']}/work").json()
    assert work["run"]["state"] == "no_ai"
